import { describe, expect, test } from 'bun:test'
import { buildModules } from './modules'
import { fileId, symbolId, edgeId } from './db'
import type { FileRec, SymbolRec, EdgeRec } from './types'

const R = 'o/r@abc'
const file = (path: string): FileRec => ({ id: fileId(R, path), repoId: R, path, language: 'javascript', size: 1, contentHash: path, text: '' })
const sym = (path: string, name: string): SymbolRec => ({ id: symbolId(R, path, name, 1), repoId: R, fileId: fileId(R, path), kind: 'function', name, startLine: 1, endLine: 2 })
const imp = (a: FileRec, b: FileRec): EdgeRec => ({ id: edgeId(R, a.id, b.id, 'imports'), repoId: R, fromId: a.id, toId: b.id, type: 'imports', confidence: 'extracted' })
const call = (a: SymbolRec, b: SymbolRec): EdgeRec => ({ id: edgeId(R, a.id, b.id, 'calls'), repoId: R, fromId: a.id, toId: b.id, type: 'calls', confidence: 'extracted' })

// lib has 3 files, test has 3 files: neither folds into Other.
const files = [file('lib/a.js'), file('lib/b.js'), file('lib/c.js'), file('test/x.js'), file('test/y.js'), file('test/z.js')]
const sA = sym('lib/a.js', 'fa')
const sX = sym('test/x.js', 'fx')

describe('buildModules edge kinds', () => {
  test('imports and calls aggregate separately with their kind', () => {
    const edges = [imp(files[0], files[3]), imp(files[1], files[3]), call(sA, sX)]
    const { moduleEdges } = buildModules(files, [sA, sX], edges)
    const imports = moduleEdges.find((e) => e.kind === 'imports')
    const calls = moduleEdges.find((e) => e.kind === 'calls')
    expect(imports).toMatchObject({ from: 'lib', to: 'test', count: 2 })
    expect(calls).toMatchObject({ from: 'lib', to: 'test', count: 1 })
  })
  test('symbol-level calls resolve through their file to the module', () => {
    const { moduleEdges } = buildModules(files, [sA, sX], [call(sX, sA)])
    expect(moduleEdges).toHaveLength(1)
    expect(moduleEdges[0]).toMatchObject({ from: 'test', to: 'lib', kind: 'calls' })
  })
  test('intra-module edges are dropped for both kinds', () => {
    const sB = sym('lib/b.js', 'fb')
    const { moduleEdges } = buildModules(files, [sA, sB], [imp(files[0], files[1]), call(sA, sB)])
    expect(moduleEdges).toHaveLength(0)
  })
  test('other edge types do not appear on the map', () => {
    const def: EdgeRec = { id: edgeId(R, files[0].id, sA.id, 'defines'), repoId: R, fromId: files[0].id, toId: sA.id, type: 'defines', confidence: 'extracted' }
    const { moduleEdges } = buildModules(files, [sA], [def])
    expect(moduleEdges).toHaveLength(0)
  })
})
