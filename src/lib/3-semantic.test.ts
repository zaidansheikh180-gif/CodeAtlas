import { describe, expect, it } from 'bun:test'
import {
  buildBatches,
  buildExtractionPrompt,
  parseSemanticResponse,
  runSemanticExtraction,
  semanticEdgeId,
} from './semantic'
import { DEFAULT_SETTINGS } from './settings'

const f = (path: string, chars = 100) => ({ path, text: `${path} content `.repeat(Math.ceil(chars / 16)).slice(0, chars) })

describe('buildBatches', () => {
  it('respects the token budget and keeps order', () => {
    const files = [f('a.ts', 8000), f('b.ts', 8000), f('c.ts', 400)]
    const batches = buildBatches(files, 1000)
    expect(batches.length).toBe(3)
    expect(batches[0]!.files[0]!.path).toBe('a.ts')
    // A single capped file may exceed the budget alone; multi-file batches never do.
    for (const batch of batches) {
      if (batch.files.length > 1) expect(batch.tokens).toBeLessThanOrEqual(1000 + 220)
    }
  })

  it('caps very long files per batch instead of dropping them', () => {
    const batches = buildBatches([f('huge.ts', 50000)], 2000)
    expect(batches).toHaveLength(1)
    expect(batches[0]!.files[0]!.text.length).toBeLessThanOrEqual(6000)
  })
})

describe('buildExtractionPrompt', () => {
  it('includes paths and marks truncation', () => {
    const prompt = buildExtractionPrompt({ files: [{ path: 'big.ts', text: 'x'.repeat(6000) }], tokens: 1 })
    expect(prompt).toContain('--- big.ts (truncated) ---')
  })
})

describe('parseSemanticResponse', () => {
  const valid = new Set(['src/a.ts', 'src/b.ts'])

  it('parses clean JSON lines', () => {
    const text = [
      '{"from": "src/a.ts", "to": "src/b.ts", "kind": "dependency", "label": "config flow", "evidence": "a reads b\'s constants"}',
      '{"from": "src/a.ts", "to": null, "kind": "theme", "label": "entry point", "evidence": "wires the app"}',
    ].join('\n')
    const findings = parseSemanticResponse(text, valid)
    expect(findings).toHaveLength(2)
    expect(findings[0]!.kind).toBe('dependency')
    expect(findings[1]!.toPath).toBeNull()
  })

  it('skips fences, prose, hallucinated paths and bad kinds', () => {
    const text = [
      '```json',
      '{"from": "src/a.ts", "to": "src/b.ts", "kind": "dependency", "label": "ok", "evidence": "real"}',
      '{"from": "src/ghost.ts", "to": "src/b.ts", "kind": "dependency", "label": "fake", "evidence": "invented"}',
      '{"from": "src/a.ts", "to": "src/b.ts", "kind": "imports", "label": "wrong kind", "evidence": "static"}',
      'Here is my analysis of the code:',
      '{not json}',
      '```',
    ].join('\n')
    const findings = parseSemanticResponse(text, valid)
    expect(findings).toHaveLength(1)
    expect(findings[0]!.label).toBe('ok')
  })

  it('returns nothing for an empty answer', () => {
    expect(parseSemanticResponse('', valid)).toHaveLength(0)
    expect(parseSemanticResponse('No meaningful relationships.', valid)).toHaveLength(0)
  })
})

describe('runSemanticExtraction', () => {
  it('requires a configured provider before touching the network', async () => {
    const result = await runSemanticExtraction({
      settings: { ...DEFAULT_SETTINGS, provider: 'none' },
      files: [f('src/a.ts')],
      concurrency: 2,
    })
    expect(result.findings).toHaveLength(0)
    expect(result.failedBatches).toBe(1)
    expect(result.errors[0]).toContain('No model provider configured')
  })

  it('produces stable, inferred-only edge ids', () => {
    const id = semanticEdgeId('run1', { fromPath: 'a.ts', toPath: 'b.ts', kind: 'theme', label: 'x', evidence: '' })
    expect(id).toContain('run1')
    expect(id).toContain('a.ts->b.ts')
  })
})
