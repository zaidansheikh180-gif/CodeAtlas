import { afterEach, describe, expect, it, mock } from 'bun:test'
import { apiGet, GitHubError } from './github'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

function fakeResponse(status: number, body: unknown = {}, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers })
}

describe('apiGet token handling', () => {
  it('sends the Authorization header only when a token is present', async () => {
    const calls: { auth: string | null }[] = []
    globalThis.fetch = mock(async (_url: string, init?: RequestInit) => {
      calls.push({ auth: new Headers(init?.headers).get('authorization') })
      return fakeResponse(200, { ok: true })
    }) as unknown as typeof fetch
    await apiGet('/repos/a/b')
    await apiGet('/repos/a/b', 'ghp_test_token')
    expect(calls[0]!.auth).toBeNull()
    expect(calls[1]!.auth).toBe('Bearer ghp_test_token')
  })

  it('names a rejected token (401) as unauthorized', async () => {
    globalThis.fetch = mock(async () => fakeResponse(401)) as unknown as typeof fetch
    const err = await apiGet('/repos/a/b', 'bad-token').catch((e) => e)
    expect(err).toBeInstanceOf(GitHubError)
    expect((err as GitHubError).code).toBe('unauthorized')
    expect((err as GitHubError).message).toContain('401')
  })

  it('points anonymous 404s at the token field and token 404s at access', async () => {
    globalThis.fetch = mock(async () => fakeResponse(404)) as unknown as typeof fetch
    const anon = (await apiGet('/repos/a/b').catch((e) => e)) as GitHubError
    expect(anon.code).toBe('not_found')
    expect(anon.message).toContain('private repository')
    const withToken = (await apiGet('/repos/a/b', 'ghp_x').catch((e) => e)) as GitHubError
    expect(withToken.message).toContain('token has access')
    expect(withToken.message).not.toContain('add a GitHub token')
  })

  it('never puts the token in the thrown error', async () => {
    globalThis.fetch = mock(async () => fakeResponse(401)) as unknown as typeof fetch
    const err = (await apiGet('/repos/a/b', 'ghp_secret_value').catch((e) => e)) as GitHubError
    expect(err.message).not.toContain('ghp_secret_value')
  })
})
