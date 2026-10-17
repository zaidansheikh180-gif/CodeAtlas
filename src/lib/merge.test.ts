import { describe, expect, test } from 'bun:test'
import { mergeReportToMarkdown, mergeViewId, planMerge, type MergeStrategy } from './merge'
import type { EdgeRec, FileRec, RepoRec, SymbolRec } from './types'
import type { RepoGraphInput } from './globalgraph'

let n = 0
function file(repoId: string, path: string, hash = `h-${repoId}-${path}`): FileRec {
  return { id: `${repoId}:file:${path}`, repoId, path, language: 'javascript', size: 3, contentHash: hash, text: 'a' }
}
function symbol(repoId: string, f: FileRec, name: string, line = 1): SymbolRec {
  return { id: `${repoId}:sym:${f.path}#${name}@${line}`, repoId, fileId: f.id, kind: 'function', name, startLine: line, endLine: line + 1 }
}
function edge(repoId: string, fromId: string, toId: string, type: EdgeRec['type'] = 'imports'): EdgeRec {
  return { id: `${repoId}:edge:${type}:${fromId}->${toId}:${n++}`, repoId, fromId, toId, type, confidence: 'extracted' }
}
function repo(id: string, fullName: string): RepoRec {
  return {
    id, url: `https://github.com/${fullName}`, fullName, commit: 'abc123', defaultBranch: 'main',
    status: 'ready', description: null, language: 'JavaScript', sizeKb: 5,
    stats: { files: 0, parsedFiles: 0, symbols: 0, edges: 0, secretsExcluded: 0 }, indexedAt: 1,
  }
}

// Repo A: index.js + lib/util.js; repo B: index.js (duplicate) + src/app.js.
function makeInputs(): RepoGraphInput[] {
  const aIndex = file('ra', 'index.js')
  const aUtil = file('ra', 'lib/util.js')
  const aSym = symbol('ra', aIndex, 'main')
  const bIndex = file('rb', 'index.js')
  const bApp = file('rb', 'src/app.js')
  const bSym = symbol('rb', bIndex, 'main')
  const bSym2 = symbol('rb', bApp, 'run')
  return [
    { repo: repo('ra', 'o/alpha'), files: [aIndex, aUtil], symbols: [aSym], edges: [edge('ra', aIndex.id, aUtil.id)] },
    { repo: repo('rb', 'o/beta'), files: [bIndex, bApp], symbols: [bSym, bSym2], edges: [edge('rb', bApp.id, bIndex.id)] },
  ]
}

describe('planMerge', () => {
  test('separate: every repo keeps its own tree, prefixed by tag', () => {
    const plan = planMerge(makeInputs(), 'separate')
    expect(plan.files.map((f) => f.path).sort()).toEqual(['alpha/index.js', 'alpha/lib/util.js', 'beta/index.js', 'beta/src/app.js'])
    expect(plan.report.duplicateFiles).toEqual(['index.js'])
    expect(plan.report.result).toEqual({ files: 4, symbols: 3, edges: 2 })
    expect(plan.files.every((f) => f.repoId === plan.viewId)).toBe(true)
  })

  test('merged: duplicate paths collapse, first repo wins, edges remap', () => {
    const plan = planMerge(makeInputs(), 'merged')
    expect(plan.files.map((f) => f.path).sort()).toEqual(['index.js', 'lib/util.js', 'src/app.js'])
    // beta's main symbol lands on the winning index.js at the same line -> dropped as duplicate
    expect(plan.symbols.map((s) => s.name).sort()).toEqual(['main', 'run'])
    expect(plan.report.duplicateSymbols).toBe(1)
    // beta's app -> index edge survives, pointing at the winner
    expect(plan.edges.some((e) => e.fromId.includes('src/app.js') && e.toId.endsWith(':file:index.js'))).toBe(true)
    expect(plan.report.duplicateFiles).toEqual(['index.js'])
  })

  test('linked: copies stay separate and gain call links between duplicates', () => {
    const plan = planMerge(makeInputs(), 'linked')
    expect(plan.files).toHaveLength(4)
    const links = plan.edges.filter((e) => e.confidence === 'inferred')
    expect(links).toHaveLength(1)
    expect(links[0].fromId).toContain('alpha/index.js')
    expect(links[0].toId).toContain('beta/index.js')
  })

  test('invalid records are skipped and counted, never guessed', () => {
    const inputs = makeInputs()
    inputs[0].files.push({} as FileRec)
    inputs[0].edges.push({ id: 'x', repoId: 'ra', fromId: 'ghost', toId: 'ghost2', type: 'imports', confidence: 'extracted' })
    inputs[1].symbols.push({ id: 'y', repoId: 'rb', fileId: 'ghost', kind: 'function', name: 'orphan', startLine: 1, endLine: 2 })
    const plan = planMerge(inputs, 'separate')
    expect(plan.report.skipped).toEqual({ files: 1, symbols: 1, edges: 1 })
    expect(plan.files).toHaveLength(4)
  })

  test('view id is stable and strategy-scoped; markdown renders counts', () => {
    const strategies: MergeStrategy[] = ['separate', 'merged', 'linked']
    const ids = new Set(strategies.map((s) => mergeViewId(['alpha', 'beta'], s)))
    expect(ids.size).toBe(3)
    const md = mergeReportToMarkdown(planMerge(makeInputs(), 'merged'))
    expect(md).toContain('| o/alpha | alpha | 2 | 1 | 1 |')
    expect(md).toContain('- index.js')
    expect(md).toContain('Duplicate strategy: merged')
  })
})
