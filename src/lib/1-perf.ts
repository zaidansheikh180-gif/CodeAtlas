// Performance mode and budgets (phase 9 part 2, spec-2 section 29, pack-1
// #28). Parsing, search and clustering already run in workers, indexing is
// incremental, lists are windowed, and the module map clusters files into
// modules; this module adds the remaining guardrails:
//   - auto-detection: graphs past the thresholds switch the map into
//     performance mode (fewer simulation ticks, no minimap, fewer labels)
//     so a large graph never freezes the tab;
//   - traversal budgets: graph queries stop expanding past a visited/edge
//     budget and report the truncation honestly;
//   - metrics helpers: files-per-second during indexing and millisecond
//     formatting for query latency.

// Module-graph size where the map switches to performance mode. Below these
// numbers the full-fidelity renderer (curved edges, minimap, all labels,
// 300 simulation ticks) is comfortably interactive on a mid-range laptop.
export const PERF_THRESHOLDS = {
  moduleNodes: 300,
  moduleEdges: 1200,
  files: 800,
} as const

export function shouldUsePerformanceMode(moduleNodes: number, moduleEdges: number, files: number): boolean {
  return (
    moduleNodes > PERF_THRESHOLDS.moduleNodes ||
    moduleEdges > PERF_THRESHOLDS.moduleEdges ||
    files > PERF_THRESHOLDS.files
  )
}

// Breadth-first graph queries stop expanding when either budget is hit.
// The answer still returns everything found so far and flags truncation.
export const TRAVERSAL_BUDGET = {
  maxVisited: 2_000,
  maxEdges: 5_000,
} as const

// Simulation ticks in performance mode (vs 300 at full fidelity). The
// layout is rougher but the map appears ~4x faster on huge graphs.
export const PERF_SIMULATION_TICKS = 80

// Labelling every module is the most expensive draw pass on huge maps; in
// performance mode only the largest groups get labels.
export const PERF_LABEL_LIMIT = 60

export function formatMs(ms: number): string {
  if (ms < 1) return '<1 ms'
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

// Indexing throughput for the progress UI. Returns null until there is a
// meaningful sample (avoids flashing absurd rates on the first tick).
export function filesPerSecond(done: number, startedAt: number, now: number): number | null {
  const elapsedSec = (now - startedAt) / 1000
  if (done < 2 || elapsedSec < 0.5) return null
  return done / elapsedSec
}
