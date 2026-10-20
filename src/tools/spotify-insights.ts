import type { SpotifyApi } from '@spotify/web-api-ts-sdk';
import * as z from 'zod/v4';
import { defineTool } from '../platform/primitives';
import { spotifyCall } from '../services/spotify';
import {
  MinimalEntityCodec,
  TrackCodec,
  toSlimArtist,
  toSlimTrack,
} from '../services/spotify-codecs';
import { describeFailure, endpoint, spotifyFor, textContent } from './shared/spotify';

const Input = z.object({
  action: z
    .enum(['profile', 'recently_played', 'top_tracks', 'top_artists'])
    .default('profile')
    .describe('Read the current profile, recent listening history, top tracks, or top artists.'),
  time_range: z
    .enum(['short_term', 'medium_term', 'long_term'])
    .default('medium_term')
    .optional()
    .describe('Top-item window: about 4 weeks, 6 months, or several years.'),
  limit: z.number().int().min(1).max(50).default(20).optional(),
  after: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('For recently_played only: Unix timestamp in milliseconds; mutually exclusive with before.'),
  before: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('For recently_played only: Unix timestamp in milliseconds; mutually exclusive with after.'),
}).superRefine((value, ctx) => {
  if (value.after !== undefined && value.before !== undefined) {
    ctx.addIssue({ code: 'custom', message: 'Use only one of after or before.', path: ['after'] });
  }
});

const Output = z.object({
  ok: z.boolean(),
  action: z.string(),
  _msg: z.string().optional(),
  data: z.unknown().optional(),
  error: z.string().optional(),
  code: z.string().optional(),
});

type InputType = z.infer<typeof Input>;
type Method = 'GET';
const call = <T = unknown>(client: SpotifyApi, method: Method, path: string) =>
  spotifyCall(() => client.makeRequest<T>(method, path));

function fail(message: string, code: string | undefined, action: string) {
  const structured = { ok: false, action, error: message, code };
  return {
    isError: true,
    content: [{ type: 'text' as const, text: message }],
    structuredContent: structured,
  };
}

function paging(value: unknown) {
  const object = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    limit: Number(object.limit ?? 0),
    offset: Number(object.offset ?? 0),
    total: Number(object.total ?? 0),
  };
}

export const spotifyInsights = defineTool(
  'spotify_insights',
  {
    title: 'Listening History and Taste',
    description:
      "Read the signed-in user's Spotify profile, recently played tracks, or top tracks and artists. Use recently_played for listening history; use top_tracks/top_artists with short_term, medium_term, or long_term to understand taste.",
    inputSchema: Input,
    outputSchema: Output,
    annotations: { title: 'Listening History and Taste', readOnlyHint: true, openWorldHint: true },
  },
  async (args, ctx, deps) => {
    try {
      const client = spotifyFor(ctx, deps);
      if (!client) return fail('Not signed in. Please authenticate.', 'unauthorized', args.action);
      const { data, message } = await run(client, args);
      const structured = { ok: true, action: args.action, _msg: message, data };
      return { content: textContent(deps, message, structured), structuredContent: structured };
    } catch (error) {
      deps.logger.warning('Spotify request failed', { tool: 'spotify_insights', error });
      const { message, code } = describeFailure(error);
      return fail(message, code, args.action);
    }
  },
);

async function run(client: SpotifyApi, args: InputType): Promise<{ data: unknown; message: string }> {
  if (args.action === 'profile') {
    const raw = await call<Record<string, unknown>>(client, 'GET', 'me');
    const images = Array.isArray(raw.images) ? raw.images : [];
    const firstImage = images.find((image) => image && typeof image === 'object') as
      | Record<string, unknown>
      | undefined;
    const data = {
      id: String(raw.id ?? ''),
      display_name: typeof raw.display_name === 'string' ? raw.display_name : undefined,
      country: typeof raw.country === 'string' ? raw.country : undefined,
      product: typeof raw.product === 'string' ? raw.product : undefined,
      uri: typeof raw.uri === 'string' ? raw.uri : undefined,
      url:
        raw.external_urls && typeof raw.external_urls === 'object'
          ? (raw.external_urls as Record<string, unknown>).spotify
          : undefined,
      image: typeof firstImage?.url === 'string' ? firstImage.url : undefined,
      followers:
        raw.followers && typeof raw.followers === 'object'
          ? Number((raw.followers as Record<string, unknown>).total ?? 0)
          : undefined,
    };
    return { data, message: `Loaded Spotify profile for ${data.display_name || data.id || 'the signed-in user'}.` };
  }

  if (args.action === 'recently_played') {
    const params = new URLSearchParams({ limit: String(args.limit ?? 20) });
    if (args.after !== undefined) params.set('after', String(args.after));
    if (args.before !== undefined) params.set('before', String(args.before));
    const raw = await call<Record<string, unknown>>(
      client,
      'GET',
      endpoint('me/player/recently-played', params),
    );
    const items = (Array.isArray(raw.items) ? raw.items : []).flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const record = item as Record<string, unknown>;
      const parsed = TrackCodec.safeParse(record.track);
      if (!parsed.success) return [];
      return [{ ...toSlimTrack(parsed.data), played_at: record.played_at }];
    });
    const cursors = raw.cursors && typeof raw.cursors === 'object' ? raw.cursors : undefined;
    const lines = items.slice(0, 10).map((item) => `- ${item.name} — ${item.played_at ?? 'unknown time'}`).join('\n');
    return {
      data: { items, cursors },
      message: items.length ? `Loaded ${items.length} recently played track(s):\n${lines}` : 'Loaded 0 recently played tracks.',
    };
  }

  const params = new URLSearchParams({
    limit: String(args.limit ?? 20),
    offset: '0',
    time_range: args.time_range ?? 'medium_term',
  });
  if (args.action === 'top_tracks') {
    const raw = await call<Record<string, unknown>>(client, 'GET', endpoint('me/top/tracks', params));
    const items = (Array.isArray(raw.items) ? raw.items : []).flatMap((item) => {
      const parsed = TrackCodec.safeParse(item);
      return parsed.success ? [toSlimTrack(parsed.data)] : [];
    });
    const lines = items.slice(0, 10).map((item, index) => `${index + 1}. ${item.name} — ${item.artists.join(', ')}`).join('\n');
    return {
      data: { ...paging(raw), time_range: args.time_range ?? 'medium_term', items },
      message: items.length ? `Loaded ${items.length} top track(s):\n${lines}` : 'Loaded 0 top tracks.',
    };
  }

  const raw = await call<Record<string, unknown>>(client, 'GET', endpoint('me/top/artists', params));
  const items = (Array.isArray(raw.items) ? raw.items : []).flatMap((item) => {
    const parsed = MinimalEntityCodec.safeParse(item);
    return parsed.success ? [toSlimArtist(parsed.data)] : [];
  });
  const lines = items.slice(0, 10).map((item, index) => `${index + 1}. ${item.name}`).join('\n');
  return {
    data: { ...paging(raw), time_range: args.time_range ?? 'medium_term', items },
    message: items.length ? `Loaded ${items.length} top artist(s):\n${lines}` : 'Loaded 0 top artists.',
  };
}
