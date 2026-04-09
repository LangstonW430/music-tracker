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
    hasRatings,
    fetch,
    loadMore,
    removeRecommendation,
  } = useRecommendations();

  const [librarySourceIds, setLibrarySourceIds] = useState<Set<string>>(new Set());

  // Keep a ref to loadMore so the observer closure never goes stale
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;

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
        if (entries[0].isIntersecting) loadMoreRef.current();
      },
      { rootMargin: '300px', threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [sentinel]); // only re-runs if the sentinel element itself changes

  const handleAdd = useCallback(async (rec: Recommendation) => {
    await addTrackToLibrary(session.user.id, rec);
    removeRecommendation(rec.source_id);
    setLibrarySourceIds((prev) => new Set([...prev, rec.source_id]));
  }, [session.user.id, removeRecommendation]);

  const contentRecs = recommendations.filter((r) => r.type === 'content');
  const communityRecs = recommendations.filter((r) => r.type === 'community');
  const trendingRecs = recommendations.filter((r) => r.type === 'trending');
  const newReleaseRecs = recommendations.filter((r) => r.type === 'new_release');

  return (
    <div className="page">
      <div className="page-title-row">
        <h2 className="page-title">Recommended</h2>
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
          <p>
            {hasRatings
              ? 'Try rating more tracks.'
              : <>Head to your <strong>Library</strong>, add some tracks and rate them.</>}
          </p>
        </div>
      ) : (
        <>
          {contentRecs.length > 0 && (
            <RecSection title="Picked for you" subtitle="Based on artists you love">
              {contentRecs.map((rec) => (
                <RecommendationCard
                  key={rec.source_id}
                  rec={rec}
                  onAdd={handleAdd}
                  isInLibrary={librarySourceIds.has(rec.source_id)}
                />
              ))}
            </RecSection>
          )}
          {communityRecs.length > 0 && (
            <RecSection title="Popular in the community" subtitle="Highly rated by users with similar taste">
              {communityRecs.map((rec) => (
                <RecommendationCard
                  key={rec.source_id}
                  rec={rec}
                  onAdd={handleAdd}
                  isInLibrary={librarySourceIds.has(rec.source_id)}
                />
              ))}
            </RecSection>
          )}
          {trendingRecs.length > 0 && (
            <RecSection title="Trending" subtitle="Most added tracks on the site">
              {trendingRecs.map((rec) => (
                <RecommendationCard
                  key={rec.source_id}
                  rec={rec}
                  onAdd={handleAdd}
                  isInLibrary={librarySourceIds.has(rec.source_id)}
                />
              ))}
            </RecSection>
          )}
          {newReleaseRecs.length > 0 && (
            <RecSection title="New releases" subtitle="Fresh from Spotify">
              {newReleaseRecs.map((rec) => (
                <RecommendationCard
                  key={rec.source_id}
                  rec={rec}
                  onAdd={handleAdd}
                  isInLibrary={librarySourceIds.has(rec.source_id)}
                />
              ))}
            </RecSection>
          )}

          {/* Sentinel div — observer fires loadMore when this scrolls into view */}
          <div ref={setSentinel} style={{ height: '1px' }} />

          {loadingMore && <LoadingSpinner message="Loading more…" />}

          {!loadingMore && !hasMore && (
            <p className="rec-end-msg">You've seen everything — refresh for new picks.</p>
          )}
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
