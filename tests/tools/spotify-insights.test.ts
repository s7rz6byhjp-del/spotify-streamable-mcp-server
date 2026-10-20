import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, connect, fakeFetch, signedIn, testDeps, testSpotify, textOf } from '../helpers';

afterEach(cleanup);

const track = {
  id: 'track-1',
  uri: 'spotify:track:track-1',
  name: 'Moon Song',
  artists: [{ name: 'Phoebe Bridgers' }],
  album: { name: 'Punisher', images: [{ url: 'https://i.scdn.co/cover', width: 300 }] },
};

async function caller() {
  const fetch = fakeFetch((request) => {
    const url = new URL(request.url);
    if (url.pathname === '/v1/me') {
      return Response.json({ id: 'moon', display_name: 'Moon', country: 'CN', product: 'premium' });
    }
    if (url.pathname === '/v1/me/player/recently-played') {
      return Response.json({ items: [{ track, played_at: '2026-10-20T05:00:00Z' }], cursors: { after: '1' } });
    }
    if (url.pathname === '/v1/me/top/tracks') return Response.json({ items: [track], limit: 20, offset: 0, total: 1 });
    if (url.pathname === '/v1/me/top/artists') {
      return Response.json({ items: [{ id: 'artist-1', name: 'Phoebe Bridgers', uri: 'spotify:artist:artist-1' }], limit: 20, offset: 0, total: 1 });
    }
    return undefined;
  });
  return connect({ deps: testDeps({ spotify: testSpotify(fetch) }), authInfo: signedIn('spotify-user') });
}

describe('spotify_insights', () => {
  test('reads profile, recent plays, top tracks, and top artists', async () => {
    const client = await caller();
    const profile = await client.callTool({ name: 'spotify_insights', arguments: { action: 'profile' } });
    expect(profile.structuredContent).toMatchObject({ ok: true, data: { id: 'moon', product: 'premium' } });

    const recent = await client.callTool({ name: 'spotify_insights', arguments: { action: 'recently_played' } });
    expect(recent.structuredContent).toMatchObject({ data: { items: [{ id: 'track-1', played_at: '2026-10-20T05:00:00Z' }] } });

    const tracks = await client.callTool({ name: 'spotify_insights', arguments: { action: 'top_tracks', time_range: 'short_term' } });
    expect(tracks.structuredContent).toMatchObject({ data: { time_range: 'short_term', items: [{ name: 'Moon Song' }] } });

    const artists = await client.callTool({ name: 'spotify_insights', arguments: { action: 'top_artists', time_range: 'long_term' } });
    expect(artists.structuredContent).toMatchObject({ data: { time_range: 'long_term', items: [{ name: 'Phoebe Bridgers' }] } });
    expect(textOf(artists)).toContain('Phoebe Bridgers');
  });

  test('requires sign-in and rejects conflicting cursors', async () => {
    const anonymous = await connect();
    const denied = await anonymous.callTool({ name: 'spotify_insights', arguments: { action: 'profile' } });
    expect(denied.isError).toBe(true);

    const client = await caller();
    await expect(client.callTool({ name: 'spotify_insights', arguments: { action: 'recently_played', after: 1, before: 2 } })).rejects.toThrow();
  });
});
