import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildServiceWorker, cacheVersion, collectFiles, serviceWorkerSource } from './build-sw.mjs'

let dirs: string[] = []
function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'swtest-'))
  dirs.push(dir)
  mkdirSync(join(dir, 'assets'), { recursive: true })
  mkdirSync(join(dir, 'icons'), { recursive: true })
  writeFileSync(join(dir, 'index.html'), '<html></html>')
  writeFileSync(join(dir, 'assets', 'index-abc123.js'), 'console.log(1)')
  writeFileSync(join(dir, 'assets', 'tree-sitter-qKYAACSa.wasm'), 'wasm')
  writeFileSync(join(dir, 'icons', 'icon-512.png'), 'png')
  writeFileSync(join(dir, 'sw.js'), 'stale') // never precached
  return dir
}

afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  dirs = []
})

describe('build-sw', () => {
  test('collects every dist file except sw.js, sorted, posix paths', () => {
    const files = collectFiles(fixture())
    expect(files).toEqual(['assets/index-abc123.js', 'assets/tree-sitter-qKYAACSa.wasm', 'icons/icon-512.png', 'index.html'])
  })

  test('cache version tracks the file list', () => {
    const a = cacheVersion(['a.js', 'b.js'])
    expect(cacheVersion(['a.js', 'b.js'])).toBe(a)
    expect(cacheVersion(['a.js', 'c.js'])).not.toBe(a)
    expect(a).toHaveLength(12)
  })

  test('sw source embeds version and precache, bypasses cross-origin and localhost', () => {
    const src = serviceWorkerSource('v123', ['index.html', 'assets/x.js'])
    expect(src).toContain("const VERSION = 'v123'")
    expect(src).toContain('"./index.html"')
    expect(src).toContain('"./assets/x.js"')
    expect(src).toContain("url.origin !== self.location.origin")
    expect(src).toContain("event.request.method !== 'GET'")
    expect(src).toContain("SKIP_WAITING")
  })

  test('buildServiceWorker writes dist/sw.js', () => {
    const dir = fixture()
    const { version, count } = buildServiceWorker(dir)
    expect(count).toBe(4)
    const written = readFileSync(join(dir, 'sw.js'), 'utf8')
    expect(written).toContain("'" + version + "'")
    expect(existsSync(join(dir, 'sw.js'))).toBe(true)
  })
})
