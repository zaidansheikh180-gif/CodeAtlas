// Call-flow visualization (phase 4): layered directed graph of incoming and
// outgoing calls around a selected symbol. Callers stack to the left,
// callees to the right; click any node to recenter. Mermaid export, depth
// and direction controls, map highlighting. Graph math: src/lib/callflow.ts.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { QueryIndex, GNode } from '../lib/graphquery'
import { buildCallFlow, toMermaid, type FlowNode } from '../lib/callflow'
import type { FileRec } from '../lib/types'

interface Props {
  index: QueryIndex
  files: FileRec[]
  startId: string
  onClose: () => void
  onOpenFile: (path: string, line?: number) => void
  onHighlight: (paths: string[] | null) => void
}

const NODE_W = 176
const NODE_H = 46
const COL_GAP = 64
const ROW_GAP = 14

function download(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function CallFlowPanel({ index, files, startId, onClose, onOpenFile, onHighlight }: Props) {
  const [rootId, setRootId] = useState(startId)
  const [depth, setDepth] = useState(2)
  const [incoming, setIncoming] = useState(true)
  const [outgoing, setOutgoing] = useState(true)
  const [highlightOn, setHighlightOn] = useState(false)

  const textByFileId = useMemo(() => new Map(files.map((f) => [f.id, f.text])), [files])
  const fileIdByPath = useMemo(() => new Map(files.map((f) => [f.path, f.id])), [files])

  const signatureOf = (node: GNode): string | undefined => {
    if (node.startLine == null) return undefined
    const fileId = fileIdByPath.get(node.path)
    const text = fileId ? textByFileId.get(fileId) : undefined
    if (!text) return undefined
    const line = text.split('\n')[node.startLine - 1]?.trim()
    if (!line) return undefined
    return line.length > 64 ? `${line.slice(0, 61)}…` : line
  }

  const flow = useMemo(
    () => buildCallFlow(index, rootId, { depth, incoming, outgoing }),
    [index, rootId, depth, incoming, outgoing],
  )
  // Layout: one column per layer, nodes stacked vertically, columns centered.
  const layout = useMemo(() => {
    if (!flow) return null
    const layers = new Map<number, FlowNode[]>()
    for (const node of flow.nodes) {
      const list = layers.get(node.layer) ?? []
      list.push(node)
      layers.set(node.layer, list)
    }
    const minLayer = Math.min(0, ...layers.keys())
    const maxLayer = Math.max(0, ...layers.keys())
    const columns = maxLayer - minLayer + 1
    const positions = new Map<string, { x: number; y: number }>()
    let svgH = 0
    for (let layer = minLayer; layer <= maxLayer; layer++) {
      const column = layers.get(layer) ?? []
      const colH = column.length * (NODE_H + ROW_GAP) - ROW_GAP
      svgH = Math.max(svgH, colH)
    }
    svgH += 24
    for (let layer = minLayer; layer <= maxLayer; layer++) {
      const column = layers.get(layer) ?? []
      const colH = column.length * (NODE_H + ROW_GAP) - ROW_GAP
      const offsetY = (svgH - colH) / 2
      column.forEach((node, i) => {
        positions.set(node.id, {
          x: 12 + (layer - minLayer) * (NODE_W + COL_GAP),
          y: offsetY + i * (NODE_H + ROW_GAP),
        })
      })
    }
    const svgW = 24 + columns * NODE_W + (columns - 1) * COL_GAP
    return { positions, svgW, svgH }
  }, [flow])

  const scrollRef = useRef<HTMLDivElement>(null)
  // Keep the root node in view: wide flows (many callers) would otherwise
  // open scrolled to the far-left caller column with the root off-screen.
  useEffect(() => {
    if (!flow || !layout) return
    const el = scrollRef.current
    const pos = layout.positions.get(flow.root.id)
    if (!el || !pos) return
    el.scrollTo({
      left: Math.max(0, pos.x + NODE_W / 2 - el.clientWidth / 2),
      top: Math.max(0, pos.y + NODE_H / 2 - el.clientHeight / 2),
    })
  }, [flow, layout])

  if (!flow || !layout) return null
  const { positions, svgW, svgH } = layout

  const edgePath = (source: string, target: string): string => {
    const a = positions.get(source)!
    const b = positions.get(target)!
    const x1 = a.x + NODE_W
    const y1 = a.y + NODE_H / 2
    const x2 = b.x
    const y2 = b.y + NODE_H / 2
    if (source === target) {
      // Self-loop (recursion): a small arc above the node.
      return `M ${a.x + NODE_W * 0.65} ${a.y} C ${a.x + NODE_W * 0.65} ${a.y - 26}, ${a.x + NODE_W * 0.95} ${a.y - 26}, ${a.x + NODE_W * 0.95} ${a.y}`
    }
    const mx = (x1 + x2) / 2
    return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`
  }

  const toggleHighlight = (on: boolean) => {
    setHighlightOn(on)
    onHighlight(on ? flow.nodes.map((n) => n.node.path) : null)
  }

  return (
    <div className="absolute right-4 top-4 z-10 flex max-h-[85%] w-[30rem] max-w-[calc(100%-2rem)] flex-col rounded-lg border border-line bg-surface-1 shadow-lg">
      <div className="flex items-start justify-between gap-2 border-b border-line px-3 py-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-ink">Call flow</p>
          <p className="truncate font-mono text-xs text-dragon" title={flow.root.path}>
            {flow.root.name}
            <span className="text-ink-3"> ({flow.root.type})</span>
          </p>
        </div>
        <button
          onClick={() => {
            onHighlight(null)
            onClose()
          }}
          aria-label="Close call flow"
          className="text-ink-3 hover:text-ink"
        >
          ✕
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line px-3 py-2">
        <label className="flex items-center gap-1 text-xs text-ink-2">
          Depth
          <select
            value={depth}
            onChange={(e) => setDepth(Number(e.target.value))}
            className="rounded border border-line bg-surface-2 px-1 py-0.5 font-mono text-xs text-ink"
          >
            {[1, 2, 3, 4].map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 text-xs text-ink-2">
          <input type="checkbox" checked={incoming} onChange={(e) => setIncoming(e.target.checked)} className="accent-dragon" />
          callers
        </label>
        <label className="flex items-center gap-1 text-xs text-ink-2">
          <input type="checkbox" checked={outgoing} onChange={(e) => setOutgoing(e.target.checked)} className="accent-dragon" />
          callees
        </label>
        <label className="flex items-center gap-1 text-xs text-ink-2">
          <input type="checkbox" checked={highlightOn} onChange={(e) => toggleHighlight(e.target.checked)} className="accent-dragon" />
          Highlight on map
        </label>
        <button
          onClick={() => download(`callflow-${flow.root.name}.mmd`, toMermaid(flow), 'text/plain')}
          className="rounded border border-line px-2 py-0.5 text-xs text-ink-2 hover:border-dragon hover:text-ink"
        >
          Export Mermaid
        </button>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto p-2">
        <p className="px-1 pb-1 text-[10px] text-ink-3">
          {flow.nodes.length} nodes · {flow.edges.length} calls
          {flow.truncated ? ' · truncated at 80 nodes' : ''} · click a node to recenter
        </p>
        <svg width={svgW} height={svgH} className="block" role="img" aria-label={`Call flow around ${flow.root.name}`}>
          <defs>
            <marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-ink-3, #8b84a3)" />
            </marker>
          </defs>
          {flow.edges.map((edge, i) => (
            <path key={i} d={edgePath(edge.source, edge.target)} fill="none" stroke="var(--color-line, #3a2f5a)" strokeWidth="1.5" markerEnd="url(#flow-arrow)" />
          ))}
          {flow.nodes.map(({ id, node, layer }) => {
            const pos = positions.get(id)!
            const isRoot = layer === 0
            const signature = signatureOf(node)
            return (
              <g
                key={id}
                transform={`translate(${pos.x}, ${pos.y})`}
                onClick={() => !isRoot && setRootId(id)}
                onDoubleClick={() => onOpenFile(node.path, node.startLine)}
                style={{ cursor: isRoot ? 'default' : 'pointer' }}
              >
                <rect
                  width={NODE_W}
                  height={NODE_H}
                  rx="8"
                  fill={isRoot ? 'var(--color-dragon, #FF4696)' : 'var(--color-surface-2, #2a2145)'}
                  stroke={isRoot ? 'none' : 'var(--color-line, #3a2f5a)'}
                />
                <text x="10" y="18" fontSize="11" fontFamily="ui-monospace, monospace" fill={isRoot ? 'var(--color-night, #1E1033)' : 'var(--color-ink, #efeaf7)'} fontWeight={isRoot ? 700 : 400}>
                  {node.name.length > 22 ? `${node.name.slice(0, 19)}…` : node.name}
                </text>
                <text x="10" y="34" fontSize="9" fontFamily="ui-monospace, monospace" fill={isRoot ? 'var(--color-night, #1E1033)' : 'var(--color-ink-3, #8b84a3)'}>
                  {(signature ?? `${node.path}${node.startLine ? `:${node.startLine}` : ''}`).slice(0, 30)}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}
