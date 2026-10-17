import { describe, expect, it } from 'bun:test'
import {
  buildDiagnosticsReport,
  categorize,
  clearErrorLog,
  getErrorLog,
  recordError,
  recordWarning,
  redactSensitive,
  userMessage,
  withRetry,
} from './errors'

describe('redactSensitive', () => {
  it('strips GitHub tokens, model keys and bearer credentials', () => {
    expect(redactSensitive('failed with ghp_abcdefghij1234567890 in header')).not.toContain('ghp_')
    expect(redactSensitive('key github_pat_11ABCDEFGHIJ_abcdefghijklmnop')).toContain('[redacted]')
    expect(redactSensitive('sk-proj-abcdefghijklmnop rejected')).toContain('[redacted]')
    expect(redactSensitive('Authorization: Bearer abcdef1234567890')).not.toContain('abcdef1234567890')
    expect(redactSensitive('https://x.test/api?token=secretvalue123')).toContain('[redacted]')
  })

  it('leaves ordinary messages untouched', () => {
    expect(redactSensitive('GitHub rate limit reached for anonymous requests.')).toBe(
      'GitHub rate limit reached for anonymous requests.',
    )
  })
})

describe('categorize + userMessage', () => {
  it('buckets known failure shapes', () => {
    expect(categorize('GitHub rate limit reached')).toBe('github-api')
    expect(categorize('nope', 'rate_limited')).toBe('github-api')
    expect(categorize('Failed to fetch')).toBe('network')
    expect(categorize('401 Unauthorized')).toBe('auth')
    expect(categorize('IndexedDB quota exceeded')).toBe('storage')
    expect(categorize('parse error in file')).toBe('parsing')
    expect(categorize('something odd')).toBe('indexing')
    expect(categorize('something odd', undefined, 'graph-query')).toBe('graph-query')
  })

  it('has a friendly message for every category', () => {
    for (const cat of ['network', 'github-api', 'auth', 'parsing', 'indexing', 'storage', 'graph-query', 'visualization', 'model-api'] as const) {
      expect(userMessage(cat).length).toBeGreaterThan(10)
    }
  })
})

describe('diagnostic log', () => {
  it('records errors and warnings newest-first and redacts on the way in', () => {
    clearErrorLog()
    recordError('network', 'request failed with ghp_abcdefghij1234567890')
    recordWarning('storage', 'quota nearly full')
    const items = getErrorLog()
    expect(items).toHaveLength(2)
    expect(items[0].severity).toBe('warning')
    expect(items[1].message).not.toContain('ghp_')
    clearErrorLog()
    expect(getErrorLog()).toHaveLength(0)
  })

  it('caps the log at 200 entries', () => {
    clearErrorLog()
    for (let i = 0; i < 230; i++) recordError('indexing', `error ${i}`)
    const items = getErrorLog()
    expect(items).toHaveLength(200)
    expect(items[0].message).toBe('error 229') // newest survives
    clearErrorLog()
  })
})

describe('withRetry', () => {
  it('returns the first success without retrying', async () => {
    let calls = 0
    const value = await withRetry(async () => {
      calls += 1
      return 'ok'
    })
    expect(value).toBe('ok')
    expect(calls).toBe(1)
  })

  it('retries transient failures with backoff and then succeeds', async () => {
    let calls = 0
    const value = await withRetry(
      async () => {
        calls += 1
        if (calls < 3) throw new Error('flaky')
        return 'recovered'
      },
      { attempts: 3, baseMs: 1 },
    )
    expect(value).toBe('recovered')
    expect(calls).toBe(3)
  })

  it('does not retry when shouldRetry rejects the error', async () => {
    let calls = 0
    await expect(
      withRetry(
        async () => {
          calls += 1
          throw new Error('fatal')
        },
        { attempts: 5, baseMs: 1, shouldRetry: () => false },
      ),
    ).rejects.toThrow('fatal')
    expect(calls).toBe(1)
  })

  it('throws the last error after exhausting attempts', async () => {
    let calls = 0
    await expect(
      withRetry(
        async () => {
          calls += 1
          throw new Error('always')
        },
        { attempts: 3, baseMs: 1 },
      ),
    ).rejects.toThrow('always')
    expect(calls).toBe(3)
  })

  it('honours cancellation via AbortSignal', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(withRetry(async () => 'never', { signal: controller.signal })).rejects.toThrow()
  })
})

describe('diagnostics report', () => {
  it('redacts again on export', () => {
    clearErrorLog()
    recordError('model-api', 'provider rejected sk-abcdefghijklmnop')
    const report = buildDiagnosticsReport({
      repos: 1,
      files: 10,
      symbols: 20,
      edges: 30,
      storageUsedBytes: 1024,
      storageQuotaBytes: 2048,
      indexingStatus: 'Idle',
    })
    const json = JSON.stringify(report)
    expect(json).not.toContain('sk-abcdefghijklmnop')
    expect(json).toContain('[redacted]')
    expect(report.stats.repos).toBe(1)
    clearErrorLog()
  })
})
