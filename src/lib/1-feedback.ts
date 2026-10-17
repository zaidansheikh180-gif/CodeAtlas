// Graph feedback memory and lessons (phase 7, spec-2 sections 17-18): local
// ratings on graph answers - useful, dead end, corrected - stored with the
// question, intent, nodes, edges and citations they rated. Feedback steers
// future answers: nodes in useful answers rank earlier, nodes in repeated
// dead ends sink, and a similar later question surfaces its correction.
// Older feedback decays; a strong promotion needs at least two corroborating
// useful ratings. Everything stays in IndexedDB unless the user exports it.
// No LLM anywhere in this path.

import type { QueryAnswer } from './graphquery'

export type FeedbackType = 'useful' | 'deadend' | 'corrected'

export interface FeedbackRec {
  id: string
  repoId: string
  question: string
  intent: string
  answerSummary: string
  startNodes: string[]
  returnedNodes: string[]
  edges: string[] // "from -> to (relation)" keys
  citations: string[] // "path:line"
  type: FeedbackType
  correction?: string
  createdAt: number
}

const CAP = 100

export function makeFeedback(repoId: string, question: string, answer: QueryAnswer, type: FeedbackType, correction: string | undefined, now: number): FeedbackRec {
  return {
    id: `fb-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    repoId,
    question,
    intent: answer.intent,
    answerSummary: answer.summary.slice(0, 500),
    startNodes: answer.result.startNodes.map((n) => n.id).slice(0, CAP),
    returnedNodes: answer.result.nodes.map((n) => n.id).slice(0, CAP),
    edges: answer.result.edges
      .slice(0, CAP)
      .map((e) => `${e.source} -> ${e.target} (${e.relation})`),
    citations: answer.result.citations.slice(0, CAP).map((c) => `${c.path}:${c.startLine}`),
    type,
    correction: type === 'corrected' ? correction?.trim() || undefined : undefined,
    createdAt: now,
  }
}

// --- Ranking -------------------------------------------------------------

const TAU_MS = 30 * 24 * 60 * 60 * 1000 // 30-day decay horizon
export const MIN_CORROBORATION = 2 // useful ratings needed for a full boost

function decay(createdAt: number, now: number): number {
  return Math.exp(-Math.max(0, now - createdAt) / TAU_MS)
}

export interface NodeAdjust {
  score: number // decayed, corroboration-capped; positive = boost
  useful: number
  deadend: number
}

// Per-node ranking adjustment from all feedback involving that node.
// Useful ratings add, dead ends subtract, both time-decayed. A positive
// score is capped until MIN_CORROBORATION useful ratings mention the node -
// one good answer never strongly promotes on its own.
export function nodeAdjustments(feedback: FeedbackRec[], now: number): Map<string, NodeAdjust> {
  const out = new Map<string, NodeAdjust>()
  for (const rec of feedback) {
    const w = decay(rec.createdAt, now)
    const delta = rec.type === 'useful' ? w : rec.type === 'deadend' ? -w : 0
    if (delta === 0) continue
    for (const id of new Set([...rec.startNodes, ...rec.returnedNodes])) {
      const adj = out.get(id) ?? { score: 0, useful: 0, deadend: 0 }
      adj.score += delta
      if (rec.type === 'useful') adj.useful++
      else adj.deadend++
      out.set(id, adj)
    }
  }
  for (const adj of out.values()) {
    if (adj.score > 0 && adj.useful < MIN_CORROBORATION) adj.score = Math.min(adj.score, 0.5)
  }
  return out
}

// Reorder an answer's nodes and citations by feedback adjustment, stable
// for unadjusted nodes. Returns the answer unchanged when nothing adjusts.
export function applyFeedbackToAnswer(answer: QueryAnswer, adjustments: Map<string, NodeAdjust>): QueryAnswer {
  if (adjustments.size === 0 || answer.result.nodes.length === 0) return answer
  const adj = (id: string) => adjustments.get(id)?.score ?? 0
  if (!answer.result.nodes.some((n) => adj(n.id) !== 0)) return answer
  const order = new Map(answer.result.nodes.map((n, i) => [n.id, i]))
  const nodes = [...answer.result.nodes].sort((a, b) => adj(b.id) - adj(a.id) || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
  const citeOrder = new Map(answer.result.citations.map((c, i) => [c.nodeId, i]))
  const citations = [...answer.result.citations].sort((a, b) => adj(b.nodeId) - adj(a.nodeId) || (citeOrder.get(a.nodeId) ?? 0) - (citeOrder.get(b.nodeId) ?? 0))
  return { ...answer, result: { ...answer.result, nodes, citations } }
}

// --- Similar questions ---------------------------------------------------

const STOPWORDS = new Set(['a', 'an', 'the', 'is', 'are', 'does', 'do', 'what', 'who', 'whom', 'which', 'if', 'in', 'on', 'of', 'to', 'from', 'by', 'for', 'and', 'or', 'it', 'this', 'that', 'breaks', 'break', 'changes', 'change'])

export function questionTokens(question: string): Set<string> {
  return new Set(
    question
      .toLowerCase()
      .split(/[^a-z0-9_./#-]+/)
      .filter((t) => t.length > 1 && !STOPWORDS.has(t)),
  )
}

export function questionSimilarity(a: string, b: string): number {
  const ta = questionTokens(a)
  const tb = questionTokens(b)
  if (ta.size === 0 || tb.size === 0) return 0
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter++
  return inter / (ta.size + tb.size - inter)
}

// Corrected feedback for questions similar to the one being asked now,
// newest first. Surfaced as a note above the fresh answer.
export function findCorrections(question: string, feedback: FeedbackRec[], threshold = 0.4): FeedbackRec[] {
  return feedback
    .filter((r) => r.type === 'corrected' && r.correction && questionSimilarity(question, r.question) >= threshold)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 3)
}

// --- Lessons -------------------------------------------------------------

export interface LessonsReport {
  markdown: string
  useful: { node: string; score: number; count: number }[]
  deadends: { node: string; score: number; count: number }[]
  corrections: FeedbackRec[]
  patterns: { intent: string; count: number }[]
  staleCount: number
}

// Aggregate all feedback into a Markdown lessons document. Frequently
// useful nodes need corroboration to be called out as such; dead ends list
// nodes repeatedly associated with failed answers; patterns summarize what
// people ask; feedback older than two decay horizons counts as stale.
export function buildLessons(feedback: FeedbackRec[], now: number): LessonsReport {
  const adjustments = nodeAdjustments(feedback, now)
  const useful = [...adjustments.entries()]
    .filter(([, a]) => a.useful > 0)
    .map(([node, a]) => ({ node, score: Math.round(a.score * 100) / 100, count: a.useful }))
    .sort((a, b) => b.score - a.score || b.count - a.count)
    .slice(0, 20)
  const deadends = [...adjustments.entries()]
    .filter(([, a]) => a.deadend > 0)
    .map(([node, a]) => ({ node, score: Math.round(a.score * 100) / 100, count: a.deadend }))
    .sort((a, b) => a.score - b.score || b.count - a.count)
    .slice(0, 20)
  const corrections = feedback.filter((r) => r.type === 'corrected').sort((a, b) => b.createdAt - a.createdAt).slice(0, 20)
  const intentCounts = new Map<string, number>()
  for (const r of feedback) intentCounts.set(r.intent, (intentCounts.get(r.intent) ?? 0) + 1)
  const patterns = [...intentCounts.entries()].map(([intent, count]) => ({ intent, count })).sort((a, b) => b.count - a.count)
  const staleCount = feedback.filter((r) => now - r.createdAt > 2 * TAU_MS).length

  const short = (id: string) => id.replace(/^.*:(?:file|sym):/, '')
  const lines: string[] = [
    `# CodeAtlas lessons`,
    '',
    `Generated ${new Date(now).toISOString()} from ${feedback.length} feedback ${feedback.length === 1 ? 'entry' : 'entries'} (${staleCount} stale). Local only - export stays in your hands.`,
    '',
    `## Frequently useful nodes`,
    '',
  ]
  if (useful.length === 0) lines.push('- None yet.')
  for (const u of useful) {
    const strong = u.count >= MIN_CORROBORATION ? ' (corroborated)' : ''
    lines.push(`- ${short(u.node)} - score ${u.score} from ${u.count} useful ${u.count === 1 ? 'rating' : 'ratings'}${strong}`)
  }
  lines.push('', `## Dead ends`, '')
  if (deadends.length === 0) lines.push('- None yet.')
  for (const d of deadends) lines.push(`- ${short(d.node)} - score ${d.score} from ${d.count} dead-end ${d.count === 1 ? 'rating' : 'ratings'}`)
  lines.push('', `## Corrections`, '')
  if (corrections.length === 0) lines.push('- None yet.')
  for (const c of corrections) lines.push(`- "${c.question}" -> ${c.correction ?? '(no correction text)'}`)
  lines.push('', `## Common query patterns`, '')
  if (patterns.length === 0) lines.push('- None yet.')
  for (const p of patterns) lines.push(`- ${p.intent}: ${p.count} ${p.count === 1 ? 'question' : 'questions'}`)
  lines.push('')
  return { markdown: lines.join('\n'), useful, deadends, corrections, patterns, staleCount }
}

// --- Export / import -----------------------------------------------------

export function exportFeedback(feedback: FeedbackRec[]): string {
  return JSON.stringify({ kind: 'codeatlas-feedback', schemaVersion: 1, exportedAt: new Date().toISOString(), feedback }, null, 2)
}

const TYPES: ReadonlySet<string> = new Set(['useful', 'deadend', 'corrected'])

// Strict import: anything that is not a well-formed feedback record is
// skipped and counted, never repaired by guessing.
export function parseFeedbackImport(text: string): { records: FeedbackRec[]; skipped: number; error?: string } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { records: [], skipped: 0, error: 'Not valid JSON.' }
  }
  const list = (raw as { kind?: string; feedback?: unknown })?.kind === 'codeatlas-feedback' ? (raw as { feedback: unknown }).feedback : raw
  if (!Array.isArray(list)) return { records: [], skipped: 0, error: 'No feedback array found in this file.' }
  const records: FeedbackRec[] = []
  let skipped = 0
  for (const item of list) {
    const r = item as FeedbackRec
    if (
      r &&
      typeof r.id === 'string' &&
      typeof r.repoId === 'string' &&
      typeof r.question === 'string' &&
      typeof r.intent === 'string' &&
      typeof r.answerSummary === 'string' &&
      Array.isArray(r.startNodes) &&
      Array.isArray(r.returnedNodes) &&
      Array.isArray(r.edges) &&
      Array.isArray(r.citations) &&
      TYPES.has(r.type) &&
      Number.isFinite(r.createdAt)
    ) {
      records.push(r)
    } else {
      skipped++
    }
  }
  return { records, skipped }
}
