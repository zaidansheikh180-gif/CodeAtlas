import { describe, expect, it } from 'bun:test'
import { shouldSkip, shouldSkipWith } from './filter'

describe('shouldSkipWith', () => {
  it('keeps the built-in skips intact', () => {
    expect(shouldSkipWith('node_modules/react/index.js', {})).toBe('vendored')
    expect(shouldSkipWith('assets/logo.png', {})).toBe('binary')
    expect(shouldSkipWith('package-lock.json', {})).toBe('generated')
    expect(shouldSkipWith('src/index.ts', {})).toBeNull()
  })

  it('excludes settings folders per path segment, case-insensitive', () => {
    const opts = { extraDirs: ['E2E', 'fixtures'] }
    expect(shouldSkipWith('e2e/login.spec.ts', opts)).toBe('excluded')
    expect(shouldSkipWith('src/Fixtures/data.ts', opts)).toBe('excluded')
    expect(shouldSkipWith('src/e2ehelpers/util.ts', opts)).toBeNull()
    expect(shouldSkipWith('src/index.ts', opts)).toBeNull()
  })

  it('matches shouldSkip when no extra dirs are given', () => {
    for (const path of ['src/a.ts', 'vendor/x.js', 'dist/b.js']) {
      const withOpts = shouldSkipWith(path, {})
      expect(withOpts === 'excluded' ? null : withOpts).toBe(shouldSkip(path))
    }
  })
})
