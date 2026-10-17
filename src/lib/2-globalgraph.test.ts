import { describe, expect, test } from 'bun:test'
import { buildGlobalGraph, repoShortName, type RepoGraphInput } from './globalgraph'
import type { EdgeRec, FileRec, RepoRec } from './types'

let n = 0
function file(repoId: string, path: string): FileRec {
  return { id: `${repoId}:file:${path}`, repoId, path, language: 'javascript', size: 3, contentHash: `h-${path}`, text: 'a' }
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
function input(id: string, fullName: string, folders: string[]): RepoGraphInput {
  const files = folders.flatMap((f) => [0, 1, 2].map((i) => file(id, `${f}/f${i}.js`)))
  const edges: EdgeRec[] = []
  for (let i = 0; i + 1 < folders.length; i++) {
    edges.push(edge(id, `${id}:file:${folders[i]}/f0.js`, `${id}:file:${folders[i + 1]}/f0.js`))
  }
  return { repo: repo(id, fullName), files, symbols: [], edges }
}

const isGraph = input('r1', 'sindresorhus/is', ['source', 'test'])
const expressGraph = input('r2', 'expressjs/express', ['source', 'lib'])

describe('buildGlobalGraph', () => {
  test('namespaces modules by repository tag, ownership colors assigned', () => {
    const g = buildGlobalGraph([isGraph, expressGraph], false)
    const names = g.modules.map((m) => m.name).sort()
    expect(names).toEqual(['express:lib', 'express:source', 'is:source', 'is:test'])
    expect(g.moduleColors.get('is:source')).toBe(g.repoColors.get('r1'))
    expect(g.moduleColors.get('express:source')).toBe(g.repoColors.get('r2'))
    expect(g.moduleColors.get('is:source')).not.toBe(g.moduleColors.get('express:source'))
  })

  test('edges are renamed to the namespaced module names', () => {
    const g = buildGlobalGraph([isGraph, expressGraph], false)
    expect(g.moduleEdges.some((e) => e.from === 'is:source' && e.to === 'is:test')).toBe(true)
    expect(g.moduleEdges.every((e) => e.from.includes(':'))).toBe(true)
  })

  test('shared module names link across repositories only when enabled', () => {
    const linked = buildGlobalGraph([isGraph, expressGraph], true)
    expect(linked.moduleEdges.some((e) => e.from === 'is:source' && e.to === 'express:source' && e.kind === 'calls')).toBe(true)
    const plain = buildGlobalGraph([isGraph, expressGraph], false)
    expect(plain.moduleEdges.some((e) => e.from === 'is:source' && e.to === 'express:source')).toBe(false)
  })

  test('duplicate short names fall back to the full repository name', () => {
    const fork = input('r3', 'other/is', ['lib'])
    const g = buildGlobalGraph([isGraph, fork], false)
    const names = g.modules.map((m) => m.name)
    expect(names).toContain('is:source')
    expect(names).toContain('other/is:lib')
  })

  test('stats total every included repository', () => {
    const g = buildGlobalGraph([isGraph, expressGraph], false)
    expect(g.stats).toEqual({ repos: 2, files: 12, symbols: 0, edges: 2, modules: 4 })
  })

  test('repoShortName takes the last path segment', () => {
    expect(repoShortName('sindresorhus/is')).toBe('is')
    expect(repoShortName('is')).toBe('is')
  })
})
