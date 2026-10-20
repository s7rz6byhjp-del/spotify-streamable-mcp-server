# Listening insights

The `spotify_insights` tool adds read-only access to the signed-in user's Spotify identity and listening taste.

## Actions

- `profile`: current user profile and account product.
- `recently_played`: latest listening history, including `played_at`; accepts `limit` and either `after` or `before` in Unix milliseconds.
- `top_tracks`: most-played tracks for `short_term`, `medium_term`, or `long_term`.
- `top_artists`: most-played artists for the same time ranges.

The OAuth proxy requests `user-read-recently-played`, `user-top-read`, and `user-read-private` in addition to the existing scopes. Existing grants must sign in again after deploying this change so Spotify can grant the new scopes.
