import { describe, expect, it } from 'bun:test'
import { buildChatPrompt, parseCitations, retrieveContext, streamChat, type ChatMessageRec } from './chat'
import { DEFAULT_SETTINGS } from './settings'
import type { EdgeRec, FileRec, SymbolRec } from './types'

const file = (path: string, text: string): FileRec => ({
  id: `file:${path}`,
  repoId: 'r1',
  path,
  language: 'typescript',
  size: text.length,
  text,
})
const edge = (from: string, to: string): EdgeRec => ({
  id: `${from}->${to}`,
  repoId: 'r1',
  fromId: `file:${from}`,
  toId: `file:${to}`,
  type: 'imports',
  confidence: 'extracted',
})
const files = [
  file('src/index.ts', 'import { util } from "./util";\nexport const main = () => util();\n'),
  file('src/util.ts', 'export function util() { return 42; }\n'),
  file('src/unrelated.ts', 'export const noise = true;\n'),
]
const edges = [edge('src/index.ts', 'src/util.ts')]
const symbols: SymbolRec[] = []

describe('retrieveContext', () => {
  it('packs the named file and its graph neighbor with reasons', () => {
    const ctx = retrieveContext('what does index import?', files, symbols, edges, DEFAULT_SETTINGS)
    const paths = ctx.items.map((i) => i.path)
    expect(paths).toContain('src/index.ts')
    expect(paths).toContain('src/util.ts')
    expect(ctx.tokensEstimated).toBeGreaterThan(0)
  })

  it('respects the context budget and flags truncation', () => {
    const big = 'x'.repeat(5900)
    const many = Array.from({ length: 8 }, (_, i) => file(`src/big${i}.ts`, big))
    const ctx = retrieveContext('big0', many, symbols, [], { ...DEFAULT_SETTINGS, maxContextTokens: 3000 })
    expect(ctx.items.length).toBeLessThan(8)
    expect(ctx.truncated || ctx.tokensEstimated <= 3000 + 1600).toBe(true)
  })

  it('falls back to most-connected files when nothing resolves', () => {
    const ctx = retrieveContext('zzzz qqqq nothing', files, symbols, edges, DEFAULT_SETTINGS)
    expect(ctx.items.length).toBeGreaterThan(0)
    expect(ctx.truncated).toBe(true)
  })
})

describe('buildChatPrompt', () => {
  it('includes context files, history and the question', () => {
    const ctx = retrieveContext('index', files, symbols, edges, DEFAULT_SETTINGS)
    const history: ChatMessageRec[] = [
      { id: 'm1', conversationId: 'c1', role: 'user', text: 'earlier question', citations: [], contextPaths: [], outputTokens: null, createdAt: 1 },
    ]
    const prompt = buildChatPrompt('follow-up', history, ctx)
    expect(prompt).toContain('earlier question')
    expect(prompt).toContain('--- src/index.ts')
    expect(prompt).toContain('Question: follow-up')
  })
})

describe('parseCitations', () => {
  const ctx = retrieveContext('index', files, symbols, edges, DEFAULT_SETTINGS)

  it('keeps citations whose path was sent', () => {
    const citations = parseCitations('See src/index.ts:2 and src/util.ts:1-1 for details.', ctx)
    expect(citations).toHaveLength(2)
    expect(citations[0]).toEqual({ path: 'src/index.ts', startLine: 2, endLine: null })
    expect(citations[1]).toEqual({ path: 'src/util.ts', startLine: 1, endLine: 1 })
  })

  it('drops invented paths and clamps out-of-range lines', () => {
    const citations = parseCitations('src/ghost.ts:5 does not exist; src/util.ts:999 is clamped.', ctx)
    expect(citations).toHaveLength(1)
    expect(citations[0]!.path).toBe('src/util.ts')
    // util.ts splits to 2 lines (trailing newline), so 999 clamps to 2
    expect(citations[0]!.startLine).toBe(2)
  })

  it('dedupes repeats', () => {
    const citations = parseCitations('src/index.ts:1 and again src/index.ts:1', ctx)
    expect(citations).toHaveLength(1)
  })
})

describe('streamChat', () => {
  it('short-circuits without a configured provider', async () => {
    await expect(
      streamChat({ settings: { ...DEFAULT_SETTINGS, provider: 'none' }, question: 'q', history: [], files, symbols, edges }),
    ).rejects.toThrow('No model provider configured')
  })
})
