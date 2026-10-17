import { describe, expect, it } from 'bun:test'
import { filesPerSecond, formatMs, PERF_THRESHOLDS, shouldUsePerformanceMode, TRAVERSAL_BUDGET } from './perf'
import { buildIndex, traverse } from './graphquery'
import type { EdgeRec, FileRec, SymbolRec } from './types'

describe('shouldUsePerformanceMode', () => {
  it('stays off for small graphs', () => {
    expect(shouldUsePerformanceMode(10, 20, 50)).toBe(false)
    expect(shouldUsePerformanceMode(PERF_THRESHOLDS.moduleNodes, PERF_THRESHOLDS.moduleEdges, PERF_THRESHOLDS.files)).toBe(false)
  })

  it('turns on past any threshold', () => {
    expect(shouldUsePerformanceMode(PERF_THRESHOLDS.moduleNodes + 1, 0, 0)).toBe(true)
    expect(shouldUsePerformanceMode(0, PERF_THRESHOLDS.moduleEdges + 1, 0)).toBe(true)
    expect(shouldUsePerformanceMode(0, 0, PERF_THRESHOLDS.files + 1)).toBe(true)
  })
})

describe('formatMs', () => {
  it('formats sub-millisecond, millisecond and second ranges', () => {
    expect(formatMs(0.4)).toBe('<1 ms')
    expect(formatMs(42)).toBe('42 ms')
    expect(formatMs(2500)).toBe('2.5 s')
  })
})

describe('filesPerSecond', () => {
  it('returns null before a meaningful sample', () => {
    expect(filesPerSecond(1, 1000, 1600)).toBeNull()
    expect(filesPerSecond(10, 1000, 1100)).toBeNull()
  })

  it('computes throughput once enough work is done', () => {
    expect(filesPerSecond(20, 1000, 3000)).toBe(10)
  })
})

// A dense little graph: one hub importing 50 files.
const hubFiles: FileRec[] = [
  { id: 'f:hub', repoId: 'r', path: 'hub.ts', language: 'typescript', size: 10, contentHash: 'h', text: '' },
  ...Array.from({ length: 50 }, (_, i) => ({
    id: `f:${i}`,
    repoId: 'r',
    path: `${i}.ts`,
    language: 'typescript',
    size: 10,
    contentHash: `h${i}`,
    text: '',
  })),
]
const hubEdges: EdgeRec[] = hubFiles.slice(1).map((f, i) => ({
  id: `e${i}`,
  repoId: 'r',
  fromId: 'f:hub',
  toId: f.id,
  type: 'imports',
  confidence: 'extracted',
}))

describe('traversal budgets', () => {
  it('traverses fully when under budget', () => {
    const index = buildIndex(hubFiles, [] as SymbolRec[], hubEdges)
    const result = traverse(index, ['f:hub'], { direction: 'forward', depth: 2 })
    expect(result.truncated).toBe(false)
    expect(result.nodes.length).toBe(50)
  })

  it('stops at the visited budget and flags truncation', () => {
    const index = buildIndex(hubFiles, [] as SymbolRec[], hubEdges)
    const result = traverse(index, ['f:hub'], { direction: 'forward', depth: 2, budget: { maxVisited: 10 } })
    expect(result.truncated).toBe(true)
    expect(result.nodes.length).toBeLessThan(50)
  })

  it('stops at the edge budget and flags truncation', () => {
    const index = buildIndex(hubFiles, [] as SymbolRec[], hubEdges)
    const result = traverse(index, ['f:hub'], { direction: 'forward', depth: 2, budget: { maxEdges: 5 } })
    expect(result.truncated).toBe(true)
    expect(result.edges.length).toBeLessThanOrEqual(5)
  })

  it('defaults to the shared budget constants', () => {
    expect(TRAVERSAL_BUDGET.maxVisited).toBeGreaterThan(0)
    expect(TRAVERSAL_BUDGET.maxEdges).toBeGreaterThan(0)
  })
})
