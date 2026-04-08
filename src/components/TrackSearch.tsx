/**
 * TrackSearch — search Last.fm for tracks and add them to the library.
 *
 * Debounces the search input by 400 ms so we don't hit the API on every
 * keystroke. Results appear in a dropdown; clicking one adds the track
 * to the user's library and closes the dropdown.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { searchTracks } from '../services/spotify-search';
import type { NormalisedTrack } from '../types';

interface TrackSearchProps {
  userId: string;
  onAdded: (track: NormalisedTrack) => Promise<void>;
}

export function TrackSearch({ userId, onAdded }: TrackSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<NormalisedTrack[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState<string | null>(null); // source_id being added
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await searchTracks(query);
        setResults(data);
        setOpen(true);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    }, 400);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleAdd = useCallback(
    async (track: NormalisedTrack) => {
      setAdding(track.source_id);
      try {
        await onAdded(track);
        setQuery('');
        setResults([]);
        setOpen(false);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setAdding(null);
      }
    },
    [userId, onAdded]
  );

  return (
    <div className="track-search" ref={wrapperRef}>
      <div className="track-search-input-wrap">
        <input
          className="input track-search-input"
          type="text"
          placeholder="Search for a song or artist…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
        />
        {loading && <span className="track-search-spinner" aria-label="Searching" />}
      </div>

      {error && <p className="form-error">{error}</p>}

      {open && results.length > 0 && (
        <ul className="search-dropdown" role="listbox">
          {results.map((track) => (
            <li
              key={track.source_id}
              className="search-result"
              role="option"
              aria-selected={false}
            >
              {track.image_url && (
                <img
                  className="search-result-art"
                  src={track.image_url}
                  alt={track.name}
                  loading="lazy"
                />
              )}
              <div className="search-result-info">
                <span className="search-result-name">{track.name}</span>
                <span className="search-result-artist">{track.artist}</span>
              </div>
              <button
                className="btn-primary search-result-add"
                onClick={() => handleAdd(track)}
                disabled={adding === track.source_id}
                type="button"
              >
                {adding === track.source_id ? '…' : '+ Add'}
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && !loading && query.trim() && results.length === 0 && (
        <div className="search-empty">No results for "{query}"</div>
      )}
    </div>
  );
}
