// Unit tests for repository-wide search (phase 4): ranking tiers, grouping,
// exact/ci/prefix/fuzzy/regex modes, content matches with line numbers,
// module (graph node) results, invalid regex and empty queries. Run: bun test

import { describe, expect, test } from 'bun:test'
import { searchAll } from './search'
import type { FileRec, SymbolRec } from './types'

const files: FileRec[] = [
  { id: 'f:app', repoId: 'r', path: 'src/app.ts', language: 'typescript', size: 100, contentHash: 'a', text: 'import { helper } from "./util"\nexport function runApp() {\n  return helper()\n}\n' },
  { id: 'f:util', repoId: 'r', path: 'src/util.ts', language: 'typescript', size: 80, contentHash: 'b', text: 'export function helper() {\n  return 42\n}\n' },
  { id: 'f:test', repoId: 'r', path: 'test/app.test.ts', language: 'typescript', size: 60, contentHash: 'c', text: 'import { runApp } from "../src/app"\nrunApp()\n' },
]
const symbols: SymbolRec[] = [
  { id: 's:run', repoId: 'r', fileId: 'f:app', kind: 'function', name: 'runApp', startLine: 2, endLine: 4 },
  { id: 's:help', repoId: 'r', fileId: 'f:util', kind: 'function', name: 'helper', startLine: 1, endLine: 3 },
]
const modules = ['src', 'test']

describe('searchAll', () => {
  test('empty query returns nothing', () => {
    expect(searchAll('   ', files, symbols, modules).results).toHaveLength(0)
  })
  test('exact file name is tier 1 in Files', () => {
    const r = searchAll('util.ts', files, symbols, modules).results.filter((x) => x.group === 'Files')
    expect(r[0]).toMatchObject({ path: 'src/util.ts', tier: 1 })
  })
  test('case-insensitive exact name also tiers first', () => {
    const r = searchAll('UTIL.TS', files, symbols, modules).results.filter((x) => x.group === 'Files')
    expect(r[0]).toMatchObject({ path: 'src/util.ts', tier: 1 })
  })
  test('path substring is tier 2, fuzzy is tier 5', () => {
    const r = searchAll('app', files, symbols, modules).results.filter((x) => x.group === 'Files')
    const tiers = Object.fromEntries(r.map((x) => [x.path, x.tier]))
    expect(tiers['src/app.ts']).toBe(2)
    expect(tiers['test/app.test.ts']).toBe(2)
    const fuzzy = searchAll('apts', files, symbols, modules).results.filter((x) => x.group === 'Files')
    expect(fuzzy.some((x) => x.path === 'src/app.ts' && x.tier === 5)).toBe(true)
  })
  test('exact symbol name ranks before definition matches', () => {
    const r = searchAll('runApp', files, symbols, modules).results.filter((x) => x.group === 'Symbols')
    expect(r[0]).toMatchObject({ name: 'runApp', tier: 1, path: 'src/app.ts', line: 2 })
  })
  test('symbol prefix/contains is tier 3', () => {
    const r = searchAll('help', files, symbols, modules).results.filter((x) => x.group === 'Symbols')
    expect(r.some((x) => x.name === 'helper' && x.tier === 3)).toBe(true)
  })
  test('code content matches carry line numbers and previews', () => {
    const r = searchAll('return 42', files, symbols, modules).results.filter((x) => x.group === 'Code matches')
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ path: 'src/util.ts', line: 2, tier: 4 })
    expect(r[0].preview).toContain('return 42')
  })
  test('content search ignores queries under 3 chars', () => {
    const r = searchAll('im', files, symbols, modules).results.filter((x) => x.group === 'Code matches')
    expect(r).toHaveLength(0)
  })
  test('modules appear as graph nodes', () => {
    const r = searchAll('src', files, symbols, modules).results.filter((x) => x.group === 'Graph nodes')
    expect(r.some((x) => x.moduleName === 'src')).toBe(true)
  })
  test('regex mode matches content and names', () => {
    const r = searchAll('/runApp/', files, symbols, modules).results
    expect(r.some((x) => x.group === 'Code matches' && x.path === 'test/app.test.ts' && x.line === 2)).toBe(true)
    expect(r.some((x) => x.group === 'Symbols' && x.name === 'runApp')).toBe(true)
  })
  test('invalid regex reports an error instead of throwing', () => {
    const out = searchAll('/[/', files, symbols, modules)
    expect(out.error).toContain('Invalid regular expression')
    expect(out.results).toHaveLength(0)
  })
  test('groups come in spec order: Files, Symbols, Code matches, Graph nodes', () => {
    const r = searchAll('app', files, symbols, modules).results
    const order = ['Files', 'Symbols', 'Code matches', 'Graph nodes']
    let last = -1
    for (const x of r) {
      const idx = order.indexOf(x.group)
      expect(idx).toBeGreaterThanOrEqual(last)
      last = idx
    }
  })
  test('no matches returns empty without error', () => {
    const out = searchAll('zzz-no-such-thing', files, symbols, modules)
    expect(out.error).toBeUndefined()
    expect(out.results).toHaveLength(0)
  })
})
