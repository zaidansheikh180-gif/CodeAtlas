// Unit tests for key-free Graph Query Mode: node resolution, intents, BFS
// forward/reverse, impact, shortest path, cycle prevention, relation
// filtering and citation generation. Run with: bun test

import { describe, expect, test } from 'bun:test'
import {
  answerQuestion,
  buildIndex,
  detectIntent,
  extractTargets,
  impact,
  resolveNodes,
  shortestPath,
  traverse,
} from './graphquery'
import type { EdgeRec, FileRec, SymbolRec } from './types'

// Fixture repo:
//   src/main.ts  --imports-->  src/app.ts  --imports-->  src/util.ts
//   src/util.ts  --imports-->  src/main.ts   (cycle on purpose)
//   test/app.test.ts --imports--> src/app.ts
//   src/app.ts defines class App (lines 10-40) and function loginUser (50-70)
//   src/main.ts defines function main (3-9)
//   main() --calls--> loginUser
const files: FileRec[] = [
  { id: 'f:main', repoId: 'r', path: 'src/main.ts', language: 'typescript', size: 100, contentHash: 'a', text: '' },
  { id: 'f:app', repoId: 'r', path: 'src/app.ts', language: 'typescript', size: 200, contentHash: 'b', text: '' },
  { id: 'f:util', repoId: 'r', path: 'src/util.ts', language: 'typescript', size: 80, contentHash: 'c', text: '' },
  { id: 'f:test', repoId: 'r', path: 'test/app.test.ts', language: 'typescript', size: 60, contentHash: 'd', text: '' },
]
const symbols: SymbolRec[] = [
  { id: 's:main', repoId: 'r', fileId: 'f:main', kind: 'function', name: 'main', startLine: 3, endLine: 9 },
  { id: 's:app', repoId: 'r', fileId: 'f:app', kind: 'class', name: 'App', startLine: 10, endLine: 40 },
  { id: 's:login', repoId: 'r', fileId: 'f:app', kind: 'function', name: 'loginUser', startLine: 50, endLine: 70 },
]
const edges: EdgeRec[] = [
  { id: 'e1', repoId: 'r', fromId: 'f:main', toId: 'f:app', type: 'imports', confidence: 'extracted' },
  { id: 'e2', repoId: 'r', fromId: 'f:app', toId: 'f:util', type: 'imports', confidence: 'extracted' },
  { id: 'e3', repoId: 'r', fromId: 'f:util', toId: 'f:main', type: 'imports', confidence: 'extracted' },
  { id: 'e4', repoId: 'r', fromId: 'f:test', toId: 'f:app', type: 'imports', confidence: 'extracted' },
  { id: 'e5', repoId: 'r', fromId: 'f:app', toId: 's:app', type: 'contains', confidence: 'extracted' },
  { id: 'e6', repoId: 'r', fromId: 'f:app', toId: 's:login', type: 'contains', confidence: 'extracted' },
  { id: 'e7', repoId: 'r', fromId: 'f:main', toId: 's:main', type: 'contains', confidence: 'extracted' },
  { id: 'e8', repoId: 'r', fromId: 's:main', toId: 's:login', type: 'calls', confidence: 'inferred' },
  { id: 'e8dup', repoId: 'r', fromId: 's:main', toId: 's:login', type: 'calls', confidence: 'inferred' },
]
const index = buildIndex(files, symbols, edges)

describe('buildIndex', () => {
  test('deduplicates identical edges', () => {
    expect(index.out.get('s:main')!.filter((e) => e.relation === 'calls')).toHaveLength(1)
  })
  test('maps contains to defines', () => {
    expect(index.out.get('f:app')!.some((e) => e.relation === 'defines' && e.id === 's:app')).toBe(true)
  })
})

describe('resolveNodes', () => {
  test('exact path beats everything', () => {
    expect(resolveNodes('src/app.ts', index)[0].node.id).toBe('f:app')
  })
  test('exact file name', () => {
    expect(resolveNodes('util.ts', index)[0].node.id).toBe('f:util')
  })
  test('case-insensitive name', () => {
    expect(resolveNodes('APP.TS', index)[0].node.id).toBe('f:app')
    expect(resolveNodes('loginuser', index)[0].node.id).toBe('s:login')
  })
  test('partial path', () => {
    expect(resolveNodes('app.ts', index).map((c) => c.node.id)).toContain('f:app')
  })
  test('fuzzy subsequence', () => {
    expect(resolveNodes('lgUsr', index).some((c) => c.node.id === 's:login')).toBe(true)
  })
  test('ambiguous name returns multiple candidates, exact first', () => {
    const candidates = resolveNodes('app.ts', index)
    expect(candidates.length).toBeGreaterThan(1) // src/app.ts and test/app.test.ts
    expect(candidates[0].node.id).toBe('f:app')
  })
  test('no match returns empty', () => {
    expect(resolveNodes('nonexistent-thing', index)).toHaveLength(0)
  })
})

describe('detectIntent + extractTargets', () => {
  test.each([
    ['What does App.tsx import?', 'imports'],
    ['Who imports App.tsx?', 'dependents'],
    ['Who calls loginUser?', 'callers'],
    ['What does loginUser call?', 'callees'],
    ['What is affected if I change loginUser?', 'affected'],
    ['What is the shortest path from main.tsx to InfoCards.tsx?', 'path'],
    ['Explain App.tsx.', 'explain'],
    ['Show the project file structure.', 'files'],
    ['Why is the code beautiful?', 'unknown'],
  ] as const)('%s -> %s', (q: string, intent: string) => {
    expect(detectIntent(q)).toBe(intent)
  })
  test('extracts path-like and identifier targets', () => {
    expect(extractTargets('What does App.tsx import?')).toEqual(['App.tsx'])
    expect(extractTargets('What is the shortest path from main.tsx to InfoCards.tsx?')).toEqual(['main.tsx', 'InfoCards.tsx'])
    expect(extractTargets('Who calls loginUser?')).toEqual(['loginUser'])
    expect(extractTargets('Who calls deprecate?')).toEqual(['deprecate'])
  })
})

describe('traverse', () => {
  test('forward BFS respects depth', () => {
    const d1 = traverse(index, ['f:main'], { direction: 'forward', depth: 1, relations: ['imports'] })
    expect(d1.nodes.map((n) => n.id)).toEqual(['f:app'])
    const d2 = traverse(index, ['f:main'], { direction: 'forward', depth: 2, relations: ['imports'] })
    expect(d2.nodes.map((n) => n.id).sort()).toEqual(['f:app', 'f:util'])
  })
  test('reverse BFS finds dependents', () => {
    const r = traverse(index, ['f:app'], { direction: 'reverse', depth: 1, relations: ['imports_from'] })
    expect(r.nodes.map((n) => n.id).sort()).toEqual(['f:main', 'f:test'])
  })
  test('visited set prevents infinite cycles', () => {
    // main -> app -> util -> main would loop forever without a visited set
    const r = traverse(index, ['f:main'], { direction: 'forward', depth: 10, relations: ['imports'] })
    expect(r.nodes).toHaveLength(2) // app and util, exactly once
  })
  test('relation filter excludes other edge types', () => {
    const r = traverse(index, ['f:app'], { direction: 'forward', depth: 1, relations: ['imports'] })
    expect(r.nodes.every((n) => n.type === 'file')).toBe(true) // no defines symbols
    const all = traverse(index, ['f:app'], { direction: 'forward', depth: 1 })
    expect(all.nodes.some((n) => n.type === 'class')).toBe(true)
  })
  test('citations carry file:line', () => {
    const r = traverse(index, ['f:app'], { direction: 'forward', depth: 1 })
    const appCit = r.citations.find((c) => c.nodeId === 's:app')!
    expect(appCit.path).toBe('src/app.ts')
    expect(appCit.startLine).toBe(10)
    expect(appCit.endLine).toBe(40)
  })
})

describe('impact', () => {
  test('separates direct from transitive dependents', () => {
    const { direct, transitive } = impact(index, ['f:util'], 3)
    expect(direct.map((n) => n.id)).toEqual(['f:app'])
    expect(transitive.map((n) => n.id).sort()).toEqual(['f:main', 'f:test'])
  })
})

describe('shortestPath', () => {
  test('finds the chain', () => {
    // undirected: main -> app -> test (test only connects through app)
    const r = shortestPath(index, 'f:main', 'f:test')!
    expect([...r.startNodes, ...r.nodes].map((n) => n.id)).toEqual(['f:main', 'f:app', 'f:test'])
    expect(r.edges).toHaveLength(2)
    // main -> util is one undirected hop (util imports main)
    const direct = shortestPath(index, 'f:main', 'f:util')!
    expect(direct.edges).toHaveLength(1)
  })
  test('returns null when no path exists', () => {
    const lonely = buildIndex([...files, { id: 'f:x', repoId: 'r', path: 'x.ts', language: 'typescript', size: 1, contentHash: 'x', text: '' }], symbols, edges)
    expect(shortestPath(lonely, 'f:main', 'f:x')).toBeNull()
  })
})

describe('answerQuestion', () => {
  test('imports answer names the count', () => {
    const a = answerQuestion('What does src/app.ts import?', index)
    expect(a.intent).toBe('imports')
    expect(a.summary).toContain('1 node(s) directly')
    expect(a.result.nodes.map((n) => n.id)).toEqual(['f:util'])
  })
  test('unknown intent points at the model key', () => {
    const a = answerQuestion('Why is the code beautiful?', index)
    expect(a.needsModel).toBe(true)
    expect(a.summary.toLowerCase()).toContain('model key')
  })
  test('unresolvable target says so', () => {
    const a = answerQuestion('What does zzz-no-such-file.ts import?', index)
    expect(a.summary).toContain('No graph node matches')
  })
  test('path answer prints the hop chain', () => {
    const a = answerQuestion('What is the shortest path from src/main.ts to test/app.test.ts?', index)
    expect(a.summary).toContain('2 hops')
    expect(a.highlightPaths).toEqual(['src/main.ts', 'src/app.ts', 'test/app.test.ts'])
  })
  test('explain names kind and location', () => {
    const a = answerQuestion('Explain loginUser', index)
    expect(a.summary).toContain('function')
    expect(a.summary).toContain('src/app.ts')
  })
  test('a full file path resolves to the file alone - no false ambiguity', () => {
    // Symbols inside the queried file share its path; they must not count as
    // competing matches (regression: resolver flooded by same-file symbols).
    const a = answerQuestion('What does src/app.ts import?', index)
    expect(a.summary).not.toContain('ambiguous')
  })
  test('files intent lists structure', () => {
    const a = answerQuestion('Show the project file structure.', index)
    expect(a.summary).toContain('src/')
    expect(a.summary).toContain('test/')
  })
})
