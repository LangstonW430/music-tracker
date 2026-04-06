/**
 * Spotify API client.
 *
 * Responsibilities:
 *  - Wraps fetch calls to the Spotify Web API.
 *  - Detects expired access tokens (HTTP 401) and refreshes them via the
 *    Supabase Edge Function `refresh-spotify-token`, which keeps the
 *    client_secret server-side.
 *  - Handles paginated responses transparently via `getAllSavedTracks`.
 */

import { supabase } from '../lib/supabase';
import type { SpotifyPage, SpotifySavedTrack } from '../types';

const SPOTIFY_API = 'https://api.spotify.com/v1';
const TRACKS_PAGE_SIZE = 50; // Spotify max per page

// ─── Low-level fetch wrapper ──────────────────────────────────────────────────

async function spotifyFetch<T>(
  endpoint: string,
  accessToken: string,
  attempt = 0
): Promise<T> {
  const res = await fetch(`${SPOTIFY_API}${endpoint}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.status === 401 && attempt === 0) {
    // Token expired — refresh via Edge Function and retry once
    const newToken = await refreshAccessToken();
    return spotifyFetch<T>(endpoint, newToken, 1);
  }

  if (!res.ok) {
    throw new Error(`Spotify API error ${res.status}: ${await res.text()}`);
  }

  return res.json() as Promise<T>;
}

// ─── Token refresh (calls Supabase Edge Function) ────────────────────────────

/**
 * Calls the `refresh-spotify-token` Edge Function which uses SPOTIFY_CLIENT_SECRET
 * to obtain a new access token and persists it in the `users` table.
 * Returns the fresh access token.
 */
async function refreshAccessToken(): Promise<string> {
  const { data, error } = await supabase.functions.invoke<{
    access_token: string;
    expires_at: string;
  }>('refresh-spotify-token');

  if (error || !data?.access_token) {
    throw new Error('Failed to refresh Spotify token. Please log in again.');
  }

  return data.access_token;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetches a single page of the user's saved tracks.
 * Exported for progress-aware callers that want page-by-page control.
 */
export async function getSavedTracksPage(
  accessToken: string,
  offset: number
): Promise<SpotifyPage<SpotifySavedTrack>> {
  return spotifyFetch<SpotifyPage<SpotifySavedTrack>>(
    `/me/tracks?limit=${TRACKS_PAGE_SIZE}&offset=${offset}`,
    accessToken
  );
}

/**
 * Fetches ALL of the user's saved tracks, following pagination automatically.
 * Yields one page at a time so callers can show incremental progress.
 */
export async function* streamAllSavedTracks(
  accessToken: string
): AsyncGenerator<SpotifySavedTrack[]> {
  let offset = 0;
  let total = Infinity;

  while (offset < total) {
    const page = await getSavedTracksPage(accessToken, offset);
    total = page.total;
    yield page.items;
    offset += page.items.length;

    // Stop if Spotify says there's no next page (belt-and-suspenders)
    if (!page.next) break;
  }
}
