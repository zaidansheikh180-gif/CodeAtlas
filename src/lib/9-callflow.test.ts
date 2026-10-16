import { describe, expect, test } from 'bun:test'
import { buildIndex } from './graphquery'
import { buildCallFlow, toMermaid } from './callflow'
import { fileId, symbolId, edgeId } from './db'
import type { FileRec, SymbolRec, EdgeRec } from './types'

const R = 'o/r@abc'
const file = (path: string): FileRec => ({ id: fileId(R, path), repoId: R, path, language: 'javascript', size: 1, contentHash: path, text: '' })
const sym = (path: string, name: string, line: number): SymbolRec => ({ id: symbolId(R, path, name, line), repoId: R, fileId: fileId(R, path), kind: 'function', name, startLine: line, endLine: line + 3 })
const call = (from: SymbolRec, to: SymbolRec): EdgeRec => ({ id: edgeId(R, from.id, to.id, 'calls'), repoId: R, fromId: from.id, toId: to.id, type: 'calls', confidence: 'extracted' })

// main calls render; render calls format and helper; helper calls itself (recursion); cli calls main.
const files = [file('src/main.js'), file('src/render.js'), file('src/util.js'), file('src/cli.js')]
const sMain = sym('src/main.js', 'main', 1)
const sRender = sym('src/render.js', 'render', 10)
const sFormat = sym('src/render.js', 'format', 40)
const sHelper = sym('src/util.js', 'helper', 5)
const sCli = sym('src/cli.js', 'cli', 2)
const edges = [call(sMain, sRender), call(sRender, sFormat), call(sRender, sHelper), call(sHelper, sHelper), call(sCli, sMain)]
const index = buildIndex(files, [sMain, sRender, sFormat, sHelper, sCli], edges)

describe('buildCallFlow', () => {
  test('layers callers negative, callees positive, root zero', () => {
    const flow = buildCallFlow(index, sRender.id, { depth: 2 })!
    const layer = Object.fromEntries(flow.nodes.map((n) => [n.node.name, n.layer]))
    expect(layer.render).toBe(0)
    expect(layer.main).toBe(-1)
    expect(layer.cli).toBe(-2)
    expect(layer.format).toBe(1)
    expect(layer.helper).toBe(1)
  })
  test('edges point caller to callee', () => {
    const flow = buildCallFlow(index, sRender.id, { depth: 1 })!
    expect(flow.edges).toContainEqual({ source: sMain.id, target: sRender.id })
    expect(flow.edges).toContainEqual({ source: sRender.id, target: sFormat.id })
  })
  test('recursion keeps one back-edge and one node', () => {
    const flow = buildCallFlow(index, sHelper.id, { depth: 4 })!
    expect(flow.nodes.filter((n) => n.id === sHelper.id)).toHaveLength(1)
    expect(flow.edges.filter((e) => e.source === sHelper.id && e.target === sHelper.id)).toHaveLength(1)
  })
  test('depth limit', () => {
    const flow = buildCallFlow(index, sRender.id, { depth: 1 })!
    expect(flow.nodes.map((n) => n.node.name)).not.toContain('cli')
  })
  test('direction toggles', () => {
    const outOnly = buildCallFlow(index, sRender.id, { incoming: false })!
    expect(outOnly.nodes.map((n) => n.node.name)).not.toContain('main')
    const inOnly = buildCallFlow(index, sRender.id, { outgoing: false })!
    expect(inOnly.nodes.map((n) => n.node.name)).not.toContain('format')
  })
  test('unknown start returns null', () => {
    expect(buildCallFlow(index, 'nope')).toBeNull()
  })
})

describe('toMermaid', () => {
  test('flowchart with sanitized ids and citations', () => {
    const md = toMermaid(buildCallFlow(index, sRender.id, { depth: 1 })!)
    expect(md.startsWith('flowchart LR')).toBe(true)
    expect(md).toContain('render')
    expect(md).toContain('src/render.js:10')
    expect(md).toContain('-->')
  })
})
