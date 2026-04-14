/**
 * Lightweight performance monitoring — dev-only, zero overhead in production.
 *
 * Usage:
 *   const start = perfStart();
 *   await doWork();
 *   perfEnd('my-label', start);
 *
 *   // React.Profiler:
 *   <Profiler id="track-grid" onRender={profilerLog}>...</Profiler>
 */

const DEV = import.meta.env.DEV;

/** Returns a high-resolution start timestamp. Returns 0 in production. */
export function perfStart(): number {
  return DEV ? performance.now() : 0;
}

/** Logs elapsed milliseconds since perfStart(). No-op when start === 0. */
export function perfEnd(label: string, start: number): void {
  if (DEV && start > 0) {
    console.debug(`[perf] ${label}: ${(performance.now() - start).toFixed(1)} ms`);
  }
}

/** onRender callback for React.Profiler — logs mount/update render times in dev. */
export function profilerLog(
  id: string,
  phase: 'mount' | 'update' | 'nested-update',
  actualDuration: number,
): void {
  if (DEV) {
    console.debug(`[perf] <${id}> ${phase}: ${actualDuration.toFixed(1)} ms`);
  }
}
