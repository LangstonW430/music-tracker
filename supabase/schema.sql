-- ─────────────────────────────────────────────────────────────────────────────
-- MusicTracker — Supabase schema
--
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- Safe to re-run: all statements use IF NOT EXISTS / OR REPLACE.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── Tables ──────────────────────────────────────────────────────────────────

-- Global track catalogue. source_id is the unique key (e.g. "lastfm:artist:name").
CREATE TABLE IF NOT EXISTS public.tracks (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id  TEXT UNIQUE NOT NULL,
  name       TEXT NOT NULL,
  artist     TEXT NOT NULL,
  album      TEXT NOT NULL DEFAULT '',
  image_url  TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Many-to-many: which tracks are in each user's library.
-- user_id references auth.users directly — no public.users table needed.
CREATE TABLE IF NOT EXISTS public.user_tracks (
  user_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  track_id UUID NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, track_id)
);

-- User ratings (1–5). One row per (user, track) pair — upserted on change.
CREATE TABLE IF NOT EXISTS public.ratings (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  track_id   UUID NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
  rating     SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, track_id)
);

-- Shared cache for Spotify API results (artist searches, genre searches).
-- Written and read only by edge functions via the service role — no user access.
-- TTL is enforced in application code (6 hours). Rows are upserted on refresh.
CREATE TABLE IF NOT EXISTS public.spotify_cache (
  cache_key  TEXT PRIMARY KEY,
  data       JSONB NOT NULL,
  cached_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.spotify_cache ENABLE ROW LEVEL SECURITY;
-- No RLS policies: only accessible via service role key in edge functions

-- ─── Indexes ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_user_tracks_user_id ON public.user_tracks (user_id);
CREATE INDEX IF NOT EXISTS idx_ratings_user_id     ON public.ratings (user_id);

-- ─── Row Level Security ───────────────────────────────────────────────────────

ALTER TABLE public.tracks      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ratings     ENABLE ROW LEVEL SECURITY;

-- tracks: readable and writable by any authenticated user (shared catalogue)
CREATE POLICY "tracks: authenticated select"
  ON public.tracks FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "tracks: authenticated insert"
  ON public.tracks FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "tracks: authenticated update"
  ON public.tracks FOR UPDATE
  USING (auth.role() = 'authenticated');

-- user_tracks: users manage only their own library rows
CREATE POLICY "user_tracks: own rows"
  ON public.user_tracks FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ratings: users manage only their own ratings
CREATE POLICY "ratings: own rows"
  ON public.ratings FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
