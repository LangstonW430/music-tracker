-- ─────────────────────────────────────────────────────────────────────────────
-- MusicTracker — Supabase schema
--
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- Safe to re-run: all statements use IF NOT EXISTS / OR REPLACE.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── Tables ──────────────────────────────────────────────────────────────────

-- Extends auth.users with the Spotify-specific fields we need.
-- id references auth.users so Supabase Auth owns the identity.
CREATE TABLE IF NOT EXISTS public.users (
  id                    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  spotify_id            TEXT UNIQUE NOT NULL,
  spotify_access_token  TEXT,
  spotify_refresh_token TEXT,
  token_expires_at      TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Global track catalogue. A track is only stored once even if multiple users
-- save it (spotify_id is the natural unique key).
CREATE TABLE IF NOT EXISTS public.tracks (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spotify_id TEXT UNIQUE NOT NULL,
  name       TEXT NOT NULL,
  artist     TEXT NOT NULL,
  album      TEXT NOT NULL,
  image_url  TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Many-to-many: which tracks are in each user's Spotify library.
-- added_at mirrors the timestamp Spotify reports for when the track was saved.
CREATE TABLE IF NOT EXISTS public.user_tracks (
  user_id  UUID NOT NULL REFERENCES public.users(id)  ON DELETE CASCADE,
  track_id UUID NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, track_id)
);

-- User ratings (1–5). One row per (user, track) pair — upserted on change.
CREATE TABLE IF NOT EXISTS public.ratings (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.users(id)  ON DELETE CASCADE,
  track_id   UUID NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
  rating     SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, track_id)
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────

-- Speed up library queries ("give me all tracks for user X")
CREATE INDEX IF NOT EXISTS idx_user_tracks_user_id
  ON public.user_tracks (user_id);

-- Speed up ratings queries ("give me all ratings for user X")
CREATE INDEX IF NOT EXISTS idx_ratings_user_id
  ON public.ratings (user_id);

-- ─── Row Level Security ───────────────────────────────────────────────────────

ALTER TABLE public.users       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracks      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ratings     ENABLE ROW LEVEL SECURITY;

-- users: each user can only read/write their own row
CREATE POLICY "users: own row select"
  ON public.users FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "users: own row insert"
  ON public.users FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "users: own row update"
  ON public.users FOR UPDATE
  USING (auth.uid() = id);

-- tracks: readable by any authenticated user (shared catalogue);
--         insertable by any authenticated user (sync writes new tracks)
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
