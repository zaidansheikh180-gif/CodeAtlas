// Unit tests for the explorer data layer (phase 4): tree building, folder
// stats, sorting modes, dependency counts, and visible-row flattening.
// Run: bun test

import { describe, expect, test } from 'bun:test'
import { buildFileTree, computeDepCounts, flattenTree, formatSize, type TreeFolder } from './explore'
import type { EdgeRec, FileRec } from './types'

const files: FileRec[] = [
  { id: 'f:a', repoId: 'r', path: 'src/app.ts', language: 'typescript', size: 100, contentHash: 'a', text: '' },
  { id: 'f:u', repoId: 'r', path: 'src/util.ts', language: 'typescript', size: 50, contentHash: 'b', text: '' },
  { id: 'f:m', repoId: 'r', path: 'src/deep/mod.ts', language: 'typescript', size: 25, contentHash: 'c', text: '' },
  { id: 'f:i', repoId: 'r', path: 'index.ts', language: 'typescript', size: 10, contentHash: 'd', text: '' },
]
const edges: EdgeRec[] = [
  { id: 'e1', repoId: 'r', fromId: 'f:a', toId: 'f:u', type: 'imports', confidence: 'extracted' },
  { id: 'e2', repoId: 'r', fromId: 'f:i', toId: 'f:a', type: 'imports', confidence: 'extracted' },
  { id: 'e3', repoId: 'r', fromId: 'f:m', toId: 'f:u', type: 'imports', confidence: 'extracted' },
  { id: 'e4', repoId: 'r', fromId: 'f:a', toId: 'f:m', type: 'contains', confidence: 'extracted' }, // not counted
]

describe('computeDepCounts', () => {
  test('counts import edges both ways, ignores other types', () => {
    const c = computeDepCounts(edges)
    expect(c.get('f:a')).toEqual({ out: 1, inn: 1 })
    expect(c.get('f:u')).toEqual({ out: 0, inn: 2 })
    expect(c.get('f:m')).toEqual({ out: 1, inn: 0 }) // contains edge ignored
  })
})

describe('buildFileTree', () => {
  const counts = computeDepCounts(edges)
  const tree = buildFileTree(files, counts)
  test('nests folders and attaches counts', () => {
    const src = tree.children.find((n) => n.name === 'src') as TreeFolder
    expect(src.kind).toBe('folder')
    expect(src.fileCount).toBe(3)
    expect(src.totalSize).toBe(175)
    const deep = src.children.find((n) => n.name === 'deep') as TreeFolder
    expect(deep.fileCount).toBe(1)
    const util = src.children.find((n) => n.name === 'util.ts')
    expect(util).toMatchObject({ kind: 'file', importsIn: 2, importsOut: 0 })
  })
  test('folders precede files; name sort is default', () => {
    const names = tree.children.map((n) => n.name)
    expect(names).toEqual(['src', 'index.ts'])
  })
  test('size sort orders files descending', () => {
    const t = buildFileTree(files, counts, 'size')
    const src = t.children[0] as TreeFolder
    const fileNames = src.children.filter((n) => n.kind === 'file').map((n) => n.name)
    expect(fileNames[0]).toBe('app.ts')
  })
  test('deps sort orders by total dependency count', () => {
    const t = buildFileTree(files, counts, 'deps')
    const src = t.children[0] as TreeFolder
    const names = src.children.filter((n) => n.kind === 'file').map((n) => n.name)
    expect(names).toEqual(['app.ts', 'util.ts']) // both 2 deps - tie falls back to name order
  })
})

describe('flattenTree', () => {
  const tree = buildFileTree(files, computeDepCounts(edges))
  test('collapsed folders hide children; expanded reveal them', () => {
    const collapsed = flattenTree(tree, new Set())
    expect(collapsed.map((r) => r.node.name)).toEqual(['src', 'index.ts'])
    const expanded = flattenTree(tree, new Set(['src', 'src/deep']))
    expect(expanded.map((r) => `${r.depth}:${r.node.name}`)).toEqual([
      '0:src', '1:deep', '2:mod.ts', '1:app.ts', '1:util.ts', '0:index.ts',
    ])
  })
})

describe('formatSize', () => {
  test('human sizes', () => {
    expect(formatSize(500)).toBe('500 B')
    expect(formatSize(2048)).toBe('2.0 KB')
    expect(formatSize(3 * 1024 * 1024)).toBe('3.00 MB')
  })
})
