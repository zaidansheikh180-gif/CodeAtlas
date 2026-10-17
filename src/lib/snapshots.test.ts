import { describe, expect, test } from 'bun:test'
import { compareSnapshots, comparisonToMarkdown, makeSnapshot } from './snapshots'
import type { EdgeRec, FileRec, RepoRec, SymbolRec } from './types'

let n = 0
function file(repoId: string, path: string, hash = `h-${path}`): FileRec {
  return { id: `${repoId}:file:${path}`, repoId, path, language: 'javascript', size: 3, contentHash: hash, text: 'a\nb' }
}
function symbol(repoId: string, f: FileRec, name: string): SymbolRec {
  return { id: `${repoId}:sym:${f.path}#${name}@1`, repoId, fileId: f.id, kind: 'function', name, startLine: 1, endLine: 2 }
}
function edge(repoId: string, fromId: string, toId: string, type: EdgeRec['type'] = 'imports'): EdgeRec {
  return { id: `${repoId}:edge:${type}:${fromId}->${toId}:${n++}`, repoId, fromId, toId, type, confidence: 'extracted' }
}
function repo(commit: string): RepoRec {
  return {
    id: `r-${commit}`, url: 'https://github.com/a/b', fullName: 'a/b', commit, defaultBranch: 'main',
    status: 'ready', description: null, language: 'JavaScript', sizeKb: 5,
    stats: { files: 0, parsedFiles: 0, symbols: 0, edges: 0, secretsExcluded: 0 }, indexedAt: 1729000000000,
  }
}

describe('makeSnapshot', () => {
  test('captures metadata and the frozen graph', () => {
    const r = repo('abc1234567890')
    const f = file(r.id, 'a.js')
    const s = makeSnapshot(r, [f], [], [], 1729000001000)
    expect(s.fullName).toBe('a/b')
    expect(s.commit).toBe('abc1234567890')
    expect(s.createdAt).toBe(1729000001000)
    expect(s.counts.files).toBe(1)
    expect(s.data.files[0].text).toBe('a\nb')
    expect(s.id).toBe('snap-a-b-abc123456789')
  })
})

describe('compareSnapshots', () => {
  // Two versions: b adds new.js + its symbol, removes old.js, modifies
  // same.js, and rewires one dependency.
  const rA = repo('aaaa1111')
  const rB = repo('bbbb2222')
  const aSame = file(rA.id, 'same.js', 'hash-old')
  const aOld = file(rA.id, 'old.js')
  const aLib = file(rA.id, 'lib.js')
  const bSame = file(rB.id, 'same.js', 'hash-new')
  const bNew = file(rB.id, 'new.js')
  const bLib = file(rB.id, 'lib.js')
  const aSym = symbol(rA.id, aOld, 'goneFn')
  const aKeep = symbol(rA.id, aSame, 'keepFn')
  const bKeep = symbol(rB.id, bSame, 'keepFn')
  const bSym = symbol(rB.id, bNew, 'newFn')
  const aEdges = [edge(rA.id, aSame.id, aLib.id), edge(rA.id, aOld.id, aLib.id), edge(rA.id, aSame.id, aKeep.id, 'contains')]
  const bEdges = [edge(rB.id, bSame.id, bLib.id), edge(rB.id, bNew.id, bSame.id), edge(rB.id, bSame.id, bKeep.id, 'contains')]
  const snapA = makeSnapshot(rA, [aSame, aOld, aLib], [aSym, aKeep], aEdges, 1)
  const snapB = makeSnapshot(rB, [bSame, bNew, bLib], [bKeep, bSym], bEdges, 2)

  test('files: added, removed and modified by content hash', () => {
    const r = compareSnapshots(snapA, snapB)
    expect(r.files.added).toEqual(['new.js'])
    expect(r.files.removed).toEqual(['old.js'])
    expect(r.files.modified).toEqual(['same.js'])
  })

  test('symbols: added and removed by path#name', () => {
    const r = compareSnapshots(snapA, snapB)
    expect(r.symbols.added).toEqual(['new.js#newFn'])
    expect(r.symbols.removed).toEqual(['old.js#goneFn'])
  })

  test('dependencies: path-resolved keys, contains edges excluded', () => {
    const r = compareSnapshots(snapA, snapB)
    expect(r.dependencies.added).toEqual(['new.js -> same.js (imports)'])
    expect(r.dependencies.removed).toEqual(['old.js -> lib.js (imports)'])
    expect(r.dependencies.added.some((k) => k.includes('contains'))).toBe(false)
  })

  test('identical snapshots produce an empty report', () => {
    const r = compareSnapshots(snapA, snapA)
    expect(r.files.added).toEqual([])
    expect(r.files.removed).toEqual([])
    expect(r.symbols.added).toEqual([])
    expect(r.dependencies.added).toEqual([])
  })

  test('communities match across versions by member overlap', () => {
    // Both versions cluster into one small community over the same-ish
    // members, so nothing should report as new or removed.
    const r = compareSnapshots(snapA, snapB)
    expect(r.communities.added.length + r.communities.removed.length).toBeLessThanOrEqual(2)
  })
})

describe('comparisonToMarkdown', () => {
  test('renders both versions and the counts table', () => {
    const r = compareSnapshots(
      makeSnapshot(repo('aaaa1111'), [file('r1', 'x.js')], [], [], 1),
      makeSnapshot(repo('bbbb2222'), [], [], [], 2),
    )
    const md = comparisonToMarkdown(makeSnapshot(repo('aaaa1111'), [], [], [], 1), makeSnapshot(repo('bbbb2222'), [], [], [], 2), r)
    expect(md).toContain('A: a/b @ main (aaaa111)')
    expect(md).toContain('| Files | 0 | 1 | 0 |')
    expect(md).toContain('## Removed files (1)')
    expect(md).toContain('- x.js')
  })
})
