import { type OAuthProvider, readStandardTokenResponse } from '../oauth/provider';

/** What the server may do in the user's Spotify account. */
export const SPOTIFY_SCOPES = [
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-public',
  'playlist-modify-private',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'user-library-read',
  'user-library-modify',
  'user-read-recently-played',
  'user-top-read',
  'user-read-private',
] as const;

/** Spotify's accounts service: sign-in, token exchange and refresh. */
export const SPOTIFY_ACCOUNTS_URL = 'https://accounts.spotify.com';

/** Spotify as the proxy's provider. */
export const spotifyOAuth: OAuthProvider = {
  name: 'Spotify',
  authorizationUrl: `${SPOTIFY_ACCOUNTS_URL}/authorize`,
  tokenUrl: `${SPOTIFY_ACCOUNTS_URL}/api/token`,
  scopes: SPOTIFY_SCOPES,
  authorizationParams: {},
  readTokens: readStandardTokenResponse,
};
