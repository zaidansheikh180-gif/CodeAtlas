// Call-flow model (phase 4): incoming and outgoing call paths around a
// selected symbol or file, as a layered directed graph. Pure functions over
// the graph query index - recursion-safe, depth- and node-capped, with a
// Mermaid export. Unit tested directly.

import type { QueryIndex, GNode } from './graphquery'

export interface FlowOptions {
  depth?: number // traversal depth each way, default 2
  incoming?: boolean // default true
  outgoing?: boolean // default true
}

export interface FlowNode {
  id: string
  node: GNode
  // Negative depths are callers (incoming), positive are callees (outgoing);
  // the root is 0.
  layer: number
  signature?: string
}

export interface FlowEdge {
  source: string
  target: string
}

export interface CallFlow {
  root: GNode
  nodes: FlowNode[]
  edges: FlowEdge[]
  truncated: boolean
}

const NODE_CAP = 80

// Breadth-first over 'calls' edges in both directions. The visited set is
// shared, so recursive calls and diamond shapes terminate and each node
// appears once, at its shallowest layer. `placed` tracks the ids that
// actually became nodes: nodes skipped at the node cap are visited without
// being placed, and back-edges to them must be dropped so every emitted
// edge has both endpoints in the flow.
export function buildCallFlow(index: QueryIndex, startId: string, options: FlowOptions = {}): CallFlow | null {
  const root = index.nodes.get(startId)
  if (!root) return null
  const depthLimit = Math.max(1, Math.min(options.depth ?? 2, 6))
  const wantIn = options.incoming ?? true
  const wantOut = options.outgoing ?? true
  const visited = new Set<string>([startId])
  const placed = new Set<string>([startId])
  const nodes: FlowNode[] = [{ id: startId, node: root, layer: 0 }]
  const edges: FlowEdge[] = []
  let truncated = false

  const walk = (direction: 'in' | 'out') => {
    const adjacency = direction === 'out' ? index.out : index.inn
    let frontier = [startId]
    for (let depth = 1; depth <= depthLimit && frontier.length > 0; depth++) {
      const next: string[] = []
      for (const id of frontier) {
        for (const entry of (adjacency.get(id) ?? []).filter((e) => e.relation === 'calls')) {
          const source = direction === 'out' ? id : entry.id
          const target = direction === 'out' ? entry.id : id
          if (visited.has(entry.id)) {
            // Back-edge (recursion) or cross-edge: keep it only when the
            // endpoint is a placed node in this flow.
            if (placed.has(entry.id) && !edges.some((e) => e.source === source && e.target === target)) {
              edges.push({ source, target })
            }
            continue
          }
          visited.add(entry.id)
          const node = index.nodes.get(entry.id)
          if (!node) continue
          if (nodes.length >= NODE_CAP) {
            truncated = true
            continue
          }
          nodes.push({ id: entry.id, node, layer: direction === 'out' ? depth : -depth })
          placed.add(entry.id)
          edges.push({ source, target })
          next.push(entry.id)
        }
      }
      frontier = next
    }
  }

  if (wantIn) walk('in')
  if (wantOut) walk('out')
  return { root, nodes, edges, truncated }
}

// Mermaid flowchart, callers on the left flowing into the root, callees on
// the right. Ids are sanitized; labels carry name plus file:line.
export function toMermaid(flow: CallFlow): string {
  const safe = (id: string) => `n${id.replace(/[^a-zA-Z0-9]/g, '_')}`
  const label = (node: GNode) => {
    const cite = node.startLine ? `${node.path}:${node.startLine}` : node.path
    return `${node.name}\\n${cite}`
  }
  const lines = ['flowchart LR']
  for (const { node } of flow.nodes) {
    const shape = node.id === flow.root.id ? `[["${label(node)}"]]` : `["${label(node)}"]`
    lines.push(`  ${safe(node.id)}${shape}`)
  }
  for (const edge of flow.edges) {
    lines.push(`  ${safe(edge.source)} --> ${safe(edge.target)}`)
  }
  return lines.join('\n') + '\n'
}
