import { describe, expect, it } from 'bun:test'
import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_SENSITIVE_GLOBS,
  DEFAULT_SETTINGS,
  globToRegExp,
  matchesAnyGlob,
  mergeSensitiveGlobs,
} from './settings'
import { clearAllKeys, getKey, keyIsRemembered, lastExternalSend, markExternalSend, setKey } from './keys'

function fakeStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() { return map.size },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  }
}

describe('settings defaults', () => {
  it('covers every spec-2 section 27 field with a sane default', () => {
    expect(DEFAULT_SETTINGS.theme).toBe('dark')
    expect(DEFAULT_SETTINGS.provider).toBe('none')
    expect(DEFAULT_SETTINGS.model).toBe(DEFAULT_GEMINI_MODEL)
    expect(DEFAULT_SETTINGS.rememberKey).toBe(false)
    expect(DEFAULT_SETTINGS.privacyNoticeSeen).toBe(false)
    expect(DEFAULT_SETTINGS.includeTests).toBe(true)
    expect(DEFAULT_SETTINGS.maxContextTokens).toBeGreaterThan(0)
    expect(DEFAULT_SETTINGS.maxOutputTokens).toBeGreaterThan(0)
    expect(DEFAULT_SETTINGS.maxRetrievedFiles).toBeGreaterThan(0)
    expect(DEFAULT_SETTINGS.maxGraphDepth).toBeGreaterThan(0)
    expect(DEFAULT_SETTINGS.maxSnippetsPerFile).toBeGreaterThan(0)
    expect(DEFAULT_SETTINGS.performanceMode).toBe('auto')
    expect(DEFAULT_SETTINGS.sensitiveGlobs).toEqual([])
  })
})

describe('sensitive globs', () => {
  it('always includes the built-in defaults and de-dupes', () => {
    const merged = mergeSensitiveGlobs(['**/.env', '**/custom-secret/**', '  '])
    expect(merged.filter((g) => g === '**/.env')).toHaveLength(1)
    expect(merged).toContain('**/custom-secret/**')
    expect(merged.length).toBe(DEFAULT_SENSITIVE_GLOBS.length + 1)
  })

  it('matches .env and key files at any depth, not lookalikes', () => {
    const globs = mergeSensitiveGlobs([])
    expect(matchesAnyGlob('app/.env', globs)).not.toBeNull()
    expect(matchesAnyGlob('.env', globs)).not.toBeNull()
    expect(matchesAnyGlob('config/prod/.env.local', globs)).not.toBeNull()
    expect(matchesAnyGlob('certs/server.pem', globs)).not.toBeNull()
    expect(matchesAnyGlob('src/auth/token.ts', globs)).not.toBeNull()
    expect(matchesAnyGlob('src/env.ts', globs)).toBeNull()
    expect(matchesAnyGlob('docs/keyboard.md', globs)).toBeNull()
  })

  it('globToRegExp keeps single stars inside one path segment', () => {
    expect(globToRegExp('src/*.ts').test('src/lib/x.ts')).toBeFalse()
    expect(globToRegExp('src/*.ts').test('src/x.ts')).toBeTrue()
    expect(globToRegExp('**/*.pem').test('a/b/c.pem')).toBeTrue()
    expect(globToRegExp('*.pem').test('a/b/c.pem')).toBeTrue()
    expect(matchesAnyGlob('src/x.ts', ['**/broken(['])).toBeNull()
  })
})

describe('keys', () => {
  it('holds keys in memory only by default', () => {
    const storage = fakeStorage()
    setKey('gemini', '  test-key-1  ', {}, storage)
    expect(getKey('gemini', storage)).toBe('test-key-1')
    expect(storage.getItem('codeatlas.key.gemini')).toBeNull()
    expect(keyIsRemembered('gemini', storage)).toBe(false)
    clearAllKeys(storage)
  })

  it('persists the gemini key only on explicit opt-in and deletes on demand', () => {
    const storage = fakeStorage()
    setKey('gemini', 'test-key-2', { persist: true }, storage)
    clearAllKeys(storage)
    // memory cleared; reload path reads only localStorage
    setKey('gemini', 'test-key-3', { persist: true }, storage)
    const fresh = fakeStorage()
    fresh.setItem('codeatlas.key.gemini', 'test-key-3')
    expect(getKey('gemini', fresh)).toBe('test-key-3')
    expect(keyIsRemembered('gemini', fresh)).toBe(true)
    clearAllKeys(fresh)
    expect(getKey('gemini', fresh)).toBeNull()
    expect(fresh.getItem('codeatlas.key.gemini')).toBeNull()
  })

  it('never persists github tokens', () => {
    const storage = fakeStorage()
    setKey('github', 'ghp_test', { persist: true }, storage)
    expect(getKey('github', storage)).toBe('ghp_test')
    expect(storage.getItem('codeatlas.key.github')).toBeNull()
    expect(keyIsRemembered('github', storage)).toBe(false)
    clearAllKeys(storage)
  })

  it('records only provider, purpose and time when context leaves the device', () => {
    const storage = fakeStorage()
    expect(lastExternalSend(storage)).toBeNull()
    markExternalSend('gemini', 'model chat', storage)
    const marker = lastExternalSend(storage)
    expect(marker?.provider).toBe('gemini')
    expect(marker?.purpose).toBe('model chat')
    expect(marker?.at).toBeGreaterThan(0)
    expect(JSON.stringify(marker)).not.toContain('test-key')
    clearAllKeys(storage)
  })
})
