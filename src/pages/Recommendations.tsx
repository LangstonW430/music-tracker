import { useEffect } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useRecommendations } from '../hooks/useRecommendations';
import { addTrackToLibrary } from '../services/tracks';
import { RecommendationCard } from '../components/RecommendationCard';
import { LoadingSpinner } from '../components/LoadingSpinner';
import type { Recommendation } from '../types';

interface RecommendationsProps {
  session: Session;
}

export function Recommendations({ session }: RecommendationsProps) {
  const { recommendations, loading, error, hasRatings, fetch } = useRecommendations();

  useEffect(() => { fetch(); }, [fetch]);

  const contentRecs = recommendations.filter((r) => r.type === 'content');
  const communityRecs = recommendations.filter((r) => r.type === 'community');
  const trendingRecs = recommendations.filter((r) => r.type === 'trending');
  const newReleaseRecs = recommendations.filter((r) => r.type === 'new_release');

  const handleAdd = (rec: Recommendation) => addTrackToLibrary(session.user.id, rec);

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
                <RecommendationCard key={rec.source_id} rec={rec} onAdd={handleAdd} />
              ))}
            </RecSection>
          )}
          {communityRecs.length > 0 && (
            <RecSection title="Popular in the community" subtitle="Highly rated by users with similar taste">
              {communityRecs.map((rec) => (
                <RecommendationCard key={rec.source_id} rec={rec} onAdd={handleAdd} />
              ))}
            </RecSection>
          )}
          {trendingRecs.length > 0 && (
            <RecSection title="Trending" subtitle="Most added tracks on the site">
              {trendingRecs.map((rec) => (
                <RecommendationCard key={rec.source_id} rec={rec} onAdd={handleAdd} />
              ))}
            </RecSection>
          )}
          {newReleaseRecs.length > 0 && (
            <RecSection title="New releases" subtitle="Fresh from Spotify">
              {newReleaseRecs.map((rec) => (
                <RecommendationCard key={rec.source_id} rec={rec} onAdd={handleAdd} />
              ))}
            </RecSection>
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
