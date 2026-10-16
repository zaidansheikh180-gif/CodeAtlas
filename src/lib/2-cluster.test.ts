import { describe, expect, test } from 'bun:test'
import { clusterFiles, placeholderLabel } from './cluster'
import { fileId, symbolId, edgeId } from './db'
import type { FileRec, SymbolRec, EdgeRec } from './types'

const R = 'o/r@abc'
const file = (path: string, language = 'javascript'): FileRec => ({ id: fileId(R, path), repoId: R, path, language, size: 1, contentHash: path, text: '' })
const sym = (path: string, name: string): SymbolRec => ({ id: symbolId(R, path, name, 1), repoId: R, fileId: fileId(R, path), kind: 'function', name, startLine: 1, endLine: 2 })
const imp = (a: FileRec, b: FileRec): EdgeRec => ({ id: edgeId(R, a.id, b.id, 'imports'), repoId: R, fromId: a.id, toId: b.id, type: 'imports', confidence: 'extracted' })
const call = (a: SymbolRec, b: SymbolRec): EdgeRec => ({ id: edgeId(R, a.id, b.id, 'calls'), repoId: R, fromId: a.id, toId: b.id, type: 'calls', confidence: 'extracted' })

// Two tight triangles (a1-a2-a3, b1-b2-b3) with one weak bridge a3-b1.
const a1 = file('lib/a1.js'), a2 = file('lib/a2.js'), a3 = file('lib/a3.js')
const b1 = file('web/b1.ts', 'typescript'), b2 = file('web/b2.ts', 'typescript'), b3 = file('web/b3.ts', 'typescript')
const files = [a1, a2, a3, b1, b2, b3]
const edges = [
  imp(a1, a2), imp(a2, a3), imp(a1, a3),
  imp(b1, b2), imp(b2, b3), imp(b1, b3),
  imp(a3, b1),
]

describe('clusterFiles', () => {
  test('finds the two triangles as communities', () => {
    const { assign, communities } = clusterFiles(files, [], edges)
    const byPath = (id: string) => files.find((f) => f.id === id)!.path
    const groups = new Map<string, string[]>()
    for (const [fid, cid] of assign) {
      if (!groups.has(cid)) groups.set(cid, [])
      groups.get(cid)!.push(byPath(fid))
    }
    const sets = [...groups.values()].map((g) => g.sort().join(',')).sort()
    expect(sets).toEqual(['lib/a1.js,lib/a2.js,lib/a3.js', 'web/b1.ts,web/b2.ts,web/b3.ts'])
    expect(communities).toHaveLength(2)
  })
  test('deterministic across runs and community id is the smallest member id', () => {
    const r1 = clusterFiles(files, [], edges)
    const r2 = clusterFiles(files, [], edges)
    expect([...r1.assign.entries()].sort()).toEqual([...r2.assign.entries()].sort())
    for (const c of r1.communities) expect(c.id).toBe(c.fileIds[0])
  })
  test('stats: internal/external edges, language, hubs, top paths', () => {
    const { communities } = clusterFiles(files, [], edges)
    const lib = communities.find((c) => c.topPaths.includes('lib'))!
    expect(lib.internalEdges).toBe(3)
    expect(lib.externalEdges).toBe(1)
    expect(lib.mainLanguage).toBe('javascript')
    expect(lib.hubs.length).toBeGreaterThan(0)
    const web = communities.find((c) => c.topPaths.includes('web'))!
    expect(web.mainLanguage).toBe('typescript')
  })
  test('calls edges resolve through symbols to files', () => {
    const sA = sym('lib/a1.js', 'fa')
    const sX = sym('web/b1.js', 'fx')
    const xa = file('web/b1.js')
    const { assign } = clusterFiles([a1, xa], [sA, sX], [call(sA, sX)])
    expect(assign.get(a1.id)).toBe(assign.get(xa.id))
  })
  test('isolated files form singleton communities', () => {
    const solo = file('solo/alone.js')
    const { communities } = clusterFiles([...files, solo], [], edges)
    const single = communities.find((c) => c.fileIds.includes(solo.id))!
    expect(single.fileCount).toBe(1)
    expect(single.internalEdges).toBe(0)
  })
  test('placeholder labels follow size rank', () => {
    const { communities } = clusterFiles(files, [], edges)
    expect(placeholderLabel(communities[0])).toBe('Community 1')
    expect(communities[0].index).toBe(1)
  })
})
