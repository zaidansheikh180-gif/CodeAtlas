import { describe, expect, test } from 'bun:test'
import {
  applyFeedbackToAnswer, buildLessons, exportFeedback, findCorrections, makeFeedback,
  nodeAdjustments, parseFeedbackImport, questionSimilarity, MIN_CORROBORATION, type FeedbackRec,
} from './feedback'
import type { QueryAnswer } from './graphquery'

const NOW = 1_760_000_000_000
const DAY = 24 * 60 * 60 * 1000

function answer(paths: string[]): QueryAnswer {
  const nodes = paths.map((p) => ({ id: `r:file:${p}`, type: 'file' as const, name: p, path: p }))
  return {
    intent: 'imports',
    summary: `Answer about ${paths.join(', ')}`,
    result: {
      truncated: false,
      startNodes: nodes.slice(0, 1),
      nodes,
      edges: [{ source: nodes[0]?.id ?? 'a', target: nodes[1]?.id ?? 'b', relation: 'imports' as const }],
      citations: nodes.map((n) => ({ path: n.path, startLine: 1, endLine: 1, nodeId: n.id })),
    },
    highlightPaths: paths,
  }
}

function fb(type: FeedbackRec['type'], paths: string[], daysOld = 0, question = 'what does a.ts import?'): FeedbackRec {
  const a = answer(paths)
  const rec = makeFeedback('r', question, a, type, type === 'corrected' ? 'it imports b.ts, not c.ts' : undefined, NOW - daysOld * DAY)
  return rec
}

describe('makeFeedback', () => {
  test('captures question, intent, nodes, edges, citations and correction', () => {
    const rec = makeFeedback('r', 'q?', answer(['a.ts', 'b.ts']), 'corrected', ' fix ', NOW)
    expect(rec.intent).toBe('imports')
    expect(rec.returnedNodes).toEqual(['r:file:a.ts', 'r:file:b.ts'])
    expect(rec.edges).toEqual(['r:file:a.ts -> r:file:b.ts (imports)'])
    expect(rec.citations).toEqual(['a.ts:1', 'b.ts:1'])
    expect(rec.correction).toBe('fix')
    expect(rec.createdAt).toBe(NOW)
  })
})

describe('nodeAdjustments', () => {
  test('useful boosts, dead ends sink, corroboration required for full boost', () => {
    const one = nodeAdjustments([fb('useful', ['a.ts'])], NOW)
    expect(one.get('r:file:a.ts')!.score).toBeLessThanOrEqual(0.5) // single rating capped
    const two = nodeAdjustments([fb('useful', ['a.ts']), fb('useful', ['a.ts'], 1)], NOW)
    expect(two.get('r:file:a.ts')!.score).toBeGreaterThan(1.4)
    expect(two.get('r:file:a.ts')!.useful).toBe(MIN_CORROBORATION)
    const dead = nodeAdjustments([fb('deadend', ['b.ts'])], NOW)
    expect(dead.get('r:file:b.ts')!.score).toBeLessThan(0) // demotion needs no corroboration
  })

  test('older feedback decays', () => {
    const fresh = nodeAdjustments([fb('useful', ['a.ts'], 0), fb('useful', ['a.ts'], 0)], NOW)
    const old = nodeAdjustments([fb('useful', ['a.ts'], 60), fb('useful', ['a.ts'], 60)], NOW)
    expect(old.get('r:file:a.ts')!.score).toBeLessThan(fresh.get('r:file:a.ts')!.score)
  })
})

describe('applyFeedbackToAnswer', () => {
  test('boosted nodes order first, dead ends last, unadjusted keep order', () => {
    const adj = nodeAdjustments([fb('useful', ['c.ts']), fb('useful', ['c.ts']), fb('deadend', ['a.ts'])], NOW)
    const out = applyFeedbackToAnswer(answer(['a.ts', 'b.ts', 'c.ts']), adj)
    expect(out.result.nodes.map((n) => n.path)).toEqual(['c.ts', 'b.ts', 'a.ts'])
    expect(out.result.citations[0].path).toBe('c.ts')
  })

  test('no adjustments returns the same answer object', () => {
    const a = answer(['a.ts'])
    expect(applyFeedbackToAnswer(a, new Map())).toBe(a)
  })
})

describe('similar questions and corrections', () => {
  test('similarity ignores stopwords and case', () => {
    expect(questionSimilarity('What does a.ts import?', 'what does a.ts import')).toBeGreaterThan(0.9)
    expect(questionSimilarity('what does a.ts import', 'who calls z.ts')).toBeLessThan(0.4)
  })

  test('findCorrections surfaces corrected answers for similar questions only', () => {
    const corrected = fb('corrected', ['a.ts'], 0, 'what does a.ts import?')
    const other = fb('corrected', ['z.ts'], 0, 'who calls z.ts?')
    const hits = findCorrections('what does a.ts import', [corrected, other])
    expect(hits).toHaveLength(1)
    expect(hits[0].correction).toContain('b.ts')
  })
})

describe('buildLessons', () => {
  test('aggregates useful, dead ends, corrections and patterns into markdown', () => {
    const recs = [fb('useful', ['a.ts']), fb('useful', ['a.ts'], 1), fb('deadend', ['b.ts']), fb('corrected', ['c.ts'])]
    const lessons = buildLessons(recs, NOW)
    expect(lessons.useful[0].node).toBe('r:file:a.ts')
    expect(lessons.useful[0].count).toBe(2)
    expect(lessons.deadends[0].node).toBe('r:file:b.ts')
    expect(lessons.corrections).toHaveLength(1)
    expect(lessons.patterns[0]).toEqual({ intent: 'imports', count: 4 })
    expect(lessons.markdown).toContain('# CodeAtlas lessons')
    expect(lessons.markdown).toContain('(corroborated)')
    expect(lessons.markdown).toContain('it imports b.ts, not c.ts')
  })
})

describe('export and import', () => {
  test('round trip preserves records', () => {
    const recs = [fb('useful', ['a.ts']), fb('corrected', ['b.ts'])]
    const parsed = parseFeedbackImport(exportFeedback(recs))
    expect(parsed.error).toBeUndefined()
    expect(parsed.records).toHaveLength(2)
    expect(parsed.skipped).toBe(0)
  })

  test('invalid records skip, bad JSON errors', () => {
    const parsed = parseFeedbackImport(JSON.stringify({ kind: 'codeatlas-feedback', feedback: [{ id: 1 }, fb('useful', ['a.ts'])] }))
    expect(parsed.records).toHaveLength(1)
    expect(parsed.skipped).toBe(1)
    expect(parseFeedbackImport('not json').error).toBe('Not valid JSON.')
    expect(parseFeedbackImport('{"a":1}').error).toBe('No feedback array found in this file.')
  })
})
