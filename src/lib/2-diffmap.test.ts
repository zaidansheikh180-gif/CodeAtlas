import { describe, expect, test } from 'bun:test'
import { buildDiffMap, diffEdgeKey, STATUS_COLORS } from './diffmap'
import { compareSnapshots, makeSnapshot } from './snapshots'
import type { EdgeRec, FileRec, RepoRec, SymbolRec } from './types'

let n = 0
function file(repoId: string, path: string, hash = `h-${path}`): FileRec {
  return { id: `${repoId}:file:${path}`, repoId, path, language: 'javascript', size: 3, contentHash: hash, text: 'a\nb' }
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
// Three files per folder so no module folds into "Other".
function folder(repoId: string, name: string, count = 3): FileRec[] {
  return Array.from({ length: count }, (_, i) => file(repoId, `${name}/f${i}.js`))
}

const rA = repo('aaaa1111')
const rB = repo('bbbb2222')
// A: web (3), api (3), old (3). B: web (3, one modified), api (3, same hashes), new (3).
const aWeb = folder(rA.id, 'web')
const aApi = folder(rA.id, 'api')
const aOld = folder(rA.id, 'old')
const bWeb = [file(rB.id, 'web/f0.js', 'changed'), file(rB.id, 'web/f1.js'), file(rB.id, 'web/f2.js')]
const bApi = folder(rB.id, 'api')
const bNew = folder(rB.id, 'new')
const aEdges = [
  edge(rA.id, aWeb[0].id, aApi[0].id),
  edge(rA.id, aOld[0].id, aApi[0].id),
  edge(rA.id, aApi[0].id, aOld[0].id, 'calls'),
]
const bEdges = [
  edge(rB.id, bWeb[0].id, bApi[0].id),
  edge(rB.id, bNew[0].id, bApi[0].id),
]
const snapA = makeSnapshot(rA, [...aWeb, ...aApi, ...aOld], [] as SymbolRec[], aEdges, 1)
const snapB = makeSnapshot(rB, [...bWeb, ...bApi, ...bNew], [] as SymbolRec[], bEdges, 2)
const report = compareSnapshots(snapA, snapB)
const diff = buildDiffMap(snapA, snapB, report)

describe('buildDiffMap', () => {
  test('module status: added, removed, modified, unchanged', () => {
    expect(diff.moduleStatus.get('new')).toBe('added')
    expect(diff.moduleStatus.get('old')).toBe('removed')
    expect(diff.moduleStatus.get('web')).toBe('modified')
    expect(diff.moduleStatus.get('api')).toBe('unchanged')
    expect(diff.modules.map((m) => m.name).sort()).toEqual(['api', 'new', 'old', 'web'])
  })

  test('edge status: added in B, removed from A, shared edges unmarked', () => {
    expect(diff.edgeStatus.get(diffEdgeKey('new', 'api', 'imports'))).toBe('added')
    expect(diff.edgeStatus.get(diffEdgeKey('old', 'api', 'imports'))).toBe('removed')
    expect(diff.edgeStatus.get(diffEdgeKey('api', 'old', 'calls'))).toBe('removed')
    expect(diff.edgeStatus.has(diffEdgeKey('web', 'api', 'imports'))).toBe(false)
    // Removed edges stay in the list so the map can draw them.
    expect(diff.moduleEdges.some((e) => e.from === 'old' && e.to === 'api')) .toBe(true)
    expect(diff.moduleEdges).toHaveLength(4)
  })

  test('identical snapshots: every module unchanged, no edge status', () => {
    const same = buildDiffMap(snapA, snapA, compareSnapshots(snapA, snapA))
    expect([...same.moduleStatus.values()].every((s) => s === 'unchanged')).toBe(true)
    expect(same.edgeStatus.size).toBe(0)
  })

  test('status colors cover every status', () => {
    expect(Object.keys(STATUS_COLORS).sort()).toEqual(['added', 'modified', 'removed', 'unchanged'])
  })
})
