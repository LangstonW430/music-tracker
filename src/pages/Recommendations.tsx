import { useEffect, useRef, useState, useCallback } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useRecommendations } from '../hooks/useRecommendations';
import { addTrackToLibrary, getUserTracks } from '../services/tracks';
import { RecommendationCard } from '../components/RecommendationCard';
import { LoadingSpinner } from '../components/LoadingSpinner';
import type { Recommendation } from '../types';

interface RecommendationsProps {
  session: Session;
}

export function Recommendations({ session }: RecommendationsProps) {
  const {
    recommendations,
    loading,
    loadingMore,
    hasMore,
    error,
    fetch,
    loadMore,
    removeRecommendation,
    popularRecs,
    loadingPopular,
    fetchPopular,
  } = useRecommendations();

  const [librarySourceIds, setLibrarySourceIds] = useState<Set<string>>(new Set());

  // Sentinel callback: drain personalized content first, then load popular
  const sentinelCallbackRef = useRef<() => void>(() => {});
  sentinelCallbackRef.current = () => {
    if (hasMore) loadMore();
    else fetchPopular();
  };

  useEffect(() => { fetch(); }, [fetch]);

  // Fetch library source_ids so we can flag already-added tracks
  useEffect(() => {
    getUserTracks(session.user.id).then((tracks) => {
      setLibrarySourceIds(new Set(tracks.map((t) => t.source_id)));
    }).catch(() => { /* non-critical */ });
  }, [session.user.id]);

  // Sentinel via state ref — observer is set up once when the element mounts
  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) sentinelCallbackRef.current();
      },
      { rootMargin: '300px', threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [sentinel]);

  const handleAdd = useCallback(async (rec: Recommendation) => {
    await addTrackToLibrary(session.user.id, rec);
    removeRecommendation(rec.source_id);
    setLibrarySourceIds((prev) => new Set([...prev, rec.source_id]));
  }, [session.user.id, removeRecommendation]);

  const forYouRecs = recommendations.filter((r) => r.type === 'content');
  const communityTrendingRecs = recommendations.filter((r) => r.type !== 'content');

  return (
    <div className="page">
      <div className="page-title-row">
        <h2 className="page-title">Discover</h2>
        <button className="btn-ghost" onClick={fetch} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <LoadingSpinner message="Finding recommendations…" />
      ) : recommendations.length === 0 ? (
        <div className="empty-state">
          <p>No recommendations yet.</p>
          <p>Head to your <strong>Library</strong> and add some tracks to get started.</p>
        </div>
      ) : (
        <>
          {forYouRecs.length > 0 && (
            <RecSection title="For You" subtitle="Based on your library and similar artists">
              {forYouRecs.map((rec) => (
                <RecommendationCard
                  key={rec.source_id}
                  rec={rec}
                  onAdd={handleAdd}
                  isInLibrary={librarySourceIds.has(rec.source_id)}
                />
              ))}
            </RecSection>
          )}

          {[...communityTrendingRecs, ...popularRecs].length > 0 && (
            <RecSection title="Popular & New" subtitle="Trending tracks and new releases on Spotify">
              {[...communityTrendingRecs, ...popularRecs].map((rec) => (
                <RecommendationCard
                  key={rec.source_id}
                  rec={rec}
                  onAdd={handleAdd}
                  isInLibrary={librarySourceIds.has(rec.source_id)}
                />
              ))}
            </RecSection>
          )}

          {/* Sentinel — loads more personalized content, then popular once personalized is exhausted */}
          <div ref={setSentinel} style={{ height: '1px' }} />

          {(loadingMore || loadingPopular) && <LoadingSpinner message="Loading more…" />}
        </>
      )}
    </div>
  );
}

function RecSection({ title, subtitle, children }: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rec-section">
      <h3 className="rec-section-title">{title}</h3>
      <p className="rec-section-subtitle">{subtitle}</p>
      <div className="rec-grid">{children}</div>
    </section>
  );
}
