// Size caps for one browser tab. Values are recorded in ARCHITECTURE.md and
// refined from real measurements (see PROGRESS.md). Nothing here is a promise
// about repos beyond the caps - they get an honest "too large" state.

export const CAPS = {
  /** Total source text kept for parsing after filtering. */
  maxSourceBytes: 25 * 1024 * 1024,
  /** Files kept for parsing after filtering. */
  maxFiles: 4000,
  /** Single file size limit. */
  maxFileBytes: 1024 * 1024,
} as const

export interface CostEstimate {
  downloadKb: number
  note: string
}

export function estimateCost(sizeKb: number): CostEstimate {
  const mb = sizeKb / 1024
  return {
    downloadKb: sizeKb,
    note: `Downloads about ${mb < 1 ? '<1' : mb.toFixed(1)} MB from GitHub as one archive. Parsing runs in your browser; nothing is uploaded.`,
  }
}
