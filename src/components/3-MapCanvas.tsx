// Canvas renderer for the architecture map: one node per top-level module,
// edges for aggregated relationships between them. Imports are solid arcs
// (they also drive the layout), calls are dashed dragonfruit arcs overlaid
// on the same settled positions. A corner minimap shows the whole world with
// the current viewport, and clicking it recenters the view.
//
// Layout rules (phase 1 polish, user feedback 2026-10-16):
// - Modules with import links settle together in a force layout with weak
//   gravity, so the cluster stays tight.
// - Modules with no links never join the force field; they sit in a tidy
//   labelled group ("No imports found") beside the cluster instead of
//   drifting to the edges.
// - Labels are drawn at a constant screen size so zoom never makes them
//   unreadable, and the settled layout is fitted to the canvas bounds.

import { useEffect, useRef, useCallback, useState } from 'react'
import { forceSimulation, forceLink, forceManyBody, forceCollide, forceX, forceY, type SimulationNodeDatum, type SimulationLinkDatum } from 'd3-force'
import { moduleColor, type ModuleEdge, type ModuleNode } from '../lib/modules'

export interface EdgeVisibility {
  imports: boolean
  calls: boolean
}

export interface FileImportEdge {
  from: string
  to: string
}

// Plain serializable link; draw() resolves endpoint names to settled nodes.
interface DrawLink {
  source: string
  target: string
  count: number
  kind: 'imports' | 'calls'
}

interface Props {
  modules: ModuleNode[]
  moduleEdges: ModuleEdge[]
  edgeVisibility: EdgeVisibility
  // File-level imports, used to draw intra-module structure when a module
  // is expanded. Ids match FileRec.id.
  fileImports?: FileImportEdge[]
  selected: string | null
  // Modules a graph-query answer touches get a dragonfruit ring so the user
  // can see where an answer lives on the map.
  highlighted?: string[]
  // Community mode (phase 5): per-module recolor by dominant community, and
  // dimming of non-member modules while one community is inspected. Both
  // resolve at draw time, so toggling never re-settles the layout.
  communityColors?: Map<string, string>
  dimmed?: string[]
  // Diff map (phase 6): per-edge change status keyed "from->to|kind". Added
  // edges draw solid green, removed edges dashed pink, overriding the usual
  // imports/calls styling. Unmarked edges keep their normal look.
  edgeStatus?: Map<string, 'added' | 'removed'>
  onSelect: (moduleName: string | null) => void
  onOpenFile?: (path: string) => void
}

interface SimNode extends SimulationNodeDatum {
  name: string
  radius: number
  color: string
  fileCount: number
  linked: boolean
  // kind 'module' is the default top-level node; kind 'file' is a satellite
  // of an expanded module, positioned deterministically on rings around it.
  kind?: 'module' | 'file'
  path?: string
  parent?: string
  label?: string
}

interface ViewTransform {
  x: number
  y: number
  k: number
}

const UNLINKED_LABEL = 'No imports found'

export default function MapCanvas({ modules, moduleEdges, edgeVisibility, fileImports, selected, highlighted, communityColors, dimmed, edgeStatus, onSelect, onOpenFile }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const miniRef = useRef<HTMLCanvasElement>(null)
  const nodesRef = useRef<SimNode[]>([])
  const nodeByNameRef = useRef<Map<string, SimNode>>(new Map())
  const linksRef = useRef<DrawLink[]>([])
  const unlinkedAnchorRef = useRef<{ x: number; y: number } | null>(null)
  const viewRef = useRef<ViewTransform>({ x: 0, y: 0, k: 1 })
  const worldBoundsRef = useRef<{ minX: number; maxX: number; minY: number; maxY: number } | null>(null)
  const dragRef = useRef<{ node: SimNode | null; panning: boolean; startX: number; startY: number; moved: boolean }>({
    node: null,
    panning: false,
    startX: 0,
    startY: 0,
    moved: false,
  })
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const highlightedRef = useRef<Set<string>>(new Set())
  highlightedRef.current = new Set(highlighted ?? [])
  const edgeVisRef = useRef(edgeVisibility)
  edgeVisRef.current = edgeVisibility
  // Expanded modules show their files as satellite nodes on rings inside a
  // dashed container. Toggled by double-clicking the module (or its
  // container background to collapse).
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const expandedRef = useRef(expanded)
  expandedRef.current = expanded
  const fileNodeByIdRef = useRef<Map<string, SimNode>>(new Map())
  const fileImportsRef = useRef(fileImports ?? [])
  fileImportsRef.current = fileImports ?? []
  const communityColorsRef = useRef(communityColors)
  communityColorsRef.current = communityColors
  const dimmedRef = useRef<Set<string>>(new Set())
  dimmedRef.current = new Set(dimmed ?? [])
  const edgeStatusRef = useRef(edgeStatus)
  edgeStatusRef.current = edgeStatus
  // Minimap world-to-mini transform, recomputed every draw.
  const miniTransformRef = useRef<{ ms: number; ox: number; oy: number } | null>(null)

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    const { width, height } = canvas.getBoundingClientRect()
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr
      canvas.height = height * dpr
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    const view = viewRef.current
    ctx.translate(view.x, view.y)
    ctx.scale(view.k, view.k)

    const nodes = nodesRef.current

    // Edges: gentle quadratic arcs, weight by relationship count, direction
    // arrow. Every arc bends to the right of its own direction, so a
    // reciprocal pair (A -> B and B -> A) fans out to opposite world sides
    // instead of overlapping. Endpoints trim to the node circles, so arcs
    // never cross a node or its label. Imports are solid; calls are dashed
    // dragonfruit, so the type reads from the line style, not color alone.
    const nodeByName = nodeByNameRef.current
    const dimmedNow = dimmedRef.current
    const visible = linksRef.current.filter((l) => edgeVisRef.current[l.kind])
    const pairKeys = new Set<string>()
    for (const link of visible) pairKeys.add(`${link.source}->${link.target}`)
    for (const link of visible) {
      const source = nodeByName.get(link.source)
      const target = nodeByName.get(link.target)
      if (!source || !target) continue
      const count = link.count
      const sx = source.x ?? 0
      const sy = source.y ?? 0
      const tx = target.x ?? 0
      const ty = target.y ?? 0
      const dx = tx - sx
      const dy = ty - sy
      const len = Math.hypot(dx, dy) || 1
      const ux = dx / len
      const uy = dy / len
      const nx = -uy
      const ny = ux
      const reciprocal = pairKeys.has(`${target.name}->${source.name}`)
      // Clean routing: pick the bend side and size that keeps the arc clear
      // of every other node. Reciprocal pairs must stay on their own right
      // side to fan out, so they only vary size; one-way edges may flip side.
      const candidates = reciprocal
        ? [0.14, 0.22, 0.3].map((f) => Math.min(len * f, 64))
        : [0.1, 0.2, -0.1, -0.2, 0.3, -0.3].map((f) => Math.max(Math.min(len * f, 64), -64))
      let bend = candidates[0]
      let bestClearance = -1
      for (const candidate of candidates) {
        const pcx = (sx + tx) / 2 + nx * candidate
        const pcy = (sy + ty) / 2 + ny * candidate
        let clearance = Infinity
        for (const other of nodes) {
          if (other === source || other === target) continue
          for (let step = 1; step < 8; step++) {
            const t = step / 8
            const mt = 1 - t
            const px = mt * mt * sx + 2 * mt * t * pcx + t * t * tx
            const py = mt * mt * sy + 2 * mt * t * pcy + t * t * ty
            const dist = Math.hypot(px - (other.x ?? 0), py - (other.y ?? 0)) - other.radius
            if (dist < clearance) clearance = dist
          }
        }
        if (clearance > bestClearance) {
          bestClearance = clearance
          bend = candidate
        }
        if (clearance > 6) break
      }
      const cx = (sx + tx) / 2 + nx * bend
      const cy = (sy + ty) / 2 + ny * bend
      // Tangent directions at the curve ends, used to trim to the circles.
      const tsx = cx - sx
      const tsy = cy - sy
      const tsl = Math.hypot(tsx, tsy) || 1
      const startX = sx + (tsx / tsl) * (source.radius + 1)
      const startY = sy + (tsy / tsl) * (source.radius + 1)
      const tex = tx - cx
      const tey = ty - cy
      const tel = Math.hypot(tex, tey) || 1
      const eux = tex / tel
      const euy = tey / tel
      const tipX = tx - eux * (target.radius + 3)
      const tipY = ty - euy * (target.radius + 3)
      const endX = tipX - eux * 7
      const endY = tipY - euy * 7
      const edgeDim = dimmedNow.size > 0 && (dimmedNow.has(link.source) || dimmedNow.has(link.target))
      const change = edgeStatusRef.current?.get(`${link.source}->${link.target}|${link.kind}`)
      if (change === 'added') {
        ctx.strokeStyle = 'rgba(62, 207, 142, 0.55)'
        ctx.setLineDash([])
      } else if (change === 'removed') {
        ctx.strokeStyle = 'rgba(255, 70, 150, 0.55)'
        ctx.setLineDash([5 / view.k, 4 / view.k])
      } else if (link.kind === 'calls') {
        ctx.strokeStyle = edgeDim ? 'rgba(255, 70, 150, 0.08)' : 'rgba(255, 70, 150, 0.3)'
        ctx.setLineDash([5 / view.k, 4 / view.k])
      } else {
        ctx.strokeStyle = edgeDim ? 'rgba(184, 168, 217, 0.08)' : 'rgba(184, 168, 217, 0.35)'
        ctx.setLineDash([])
      }
      // Calls counts run into the hundreds on real repos, so they grow at
      // half rate and cap lower - the dashed overlay must never shout over
      // the import structure.
      ctx.lineWidth = link.kind === 'calls' ? Math.min(1 + Math.log2(count) * 0.5, 2) : Math.min(1 + Math.log2(count), 4)
      ctx.beginPath()
      ctx.moveTo(startX, startY)
      ctx.quadraticCurveTo(cx, cy, endX, endY)
      ctx.stroke()
      ctx.setLineDash([])
      // Arrowhead at the tip, aligned with the curve's arrival tangent.
      ctx.fillStyle =
        change === 'added'
          ? 'rgba(62, 207, 142, 0.65)'
          : change === 'removed'
            ? 'rgba(255, 70, 150, 0.65)'
            : link.kind === 'calls'
              ? 'rgba(255, 70, 150, 0.45)'
              : 'rgba(184, 168, 217, 0.5)'
      ctx.beginPath()
      ctx.moveTo(tipX, tipY)
      ctx.lineTo(tipX - 7 * eux + 4 * -euy, tipY - 7 * euy + 4 * eux)
      ctx.lineTo(tipX - 7 * eux - 4 * -euy, tipY - 7 * euy - 4 * eux)
      ctx.fill()
    }

    // Intra-module imports inside expanded containers: thin straight lines,
    // trimmed to the satellite circles, quiet enough to sit under the rings.
    if (fileImportsRef.current.length > 0 && fileNodeByIdRef.current.size > 0) {
      ctx.strokeStyle = 'rgba(184, 168, 217, 0.22)'
      ctx.lineWidth = 1
      for (const e of fileImportsRef.current) {
        const a = fileNodeByIdRef.current.get(e.from)
        const b = fileNodeByIdRef.current.get(e.to)
        if (!a || !b || a.parent !== b.parent) continue
        const dx = (b.x ?? 0) - (a.x ?? 0)
        const dy = (b.y ?? 0) - (a.y ?? 0)
        const len = Math.hypot(dx, dy) || 1
        ctx.beginPath()
        ctx.moveTo((a.x ?? 0) + (dx / len) * (a.radius + 1), (a.y ?? 0) + (dy / len) * (a.radius + 1))
        ctx.lineTo((b.x ?? 0) - (dx / len) * (b.radius + 1), (b.y ?? 0) - (dy / len) * (b.radius + 1))
        ctx.stroke()
      }
    }

    // Group label above the unlinked modules, if any. Drawn at a constant
    // screen size like the node labels.
    const anchor = unlinkedAnchorRef.current
    if (anchor) {
      ctx.fillStyle = '#8a76b3'
      ctx.font = `600 ${12 / view.k}px Inter, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'alphabetic'
      ctx.fillText(UNLINKED_LABEL.toUpperCase(), anchor.x, anchor.y)
    }

    // Nodes: flat fills, label under each node. Color pairs with the label.
    // Label fonts divide by the zoom factor so on-screen size never changes.
    for (const node of nodes) {
      const isSelected = node.kind !== 'file' && node.name === selectedRef.current
      const isHighlighted = highlightedRef.current.has(node.parent ?? node.name)
      const isExpanded = node.kind !== 'file' && expandedRef.current.has(node.name)
      const moduleKey = node.parent ?? node.name
      const communityColor = communityColorsRef.current?.get(moduleKey)
      const isDimmed = dimmedNow.has(moduleKey)
      if (isDimmed) ctx.globalAlpha = 0.18
      if (isExpanded) {
        // Container: dashed ring in the module color, name and count above.
        ctx.beginPath()
        ctx.arc(node.x ?? 0, node.y ?? 0, node.radius, 0, Math.PI * 2)
        ctx.setLineDash([8 / view.k, 6 / view.k])
        ctx.lineWidth = 2 / view.k
        ctx.strokeStyle = communityColor ?? node.color
        ctx.globalAlpha = isDimmed ? 0.18 : 0.6
        ctx.stroke()
        ctx.setLineDash([])
        ctx.globalAlpha = 1
        ctx.fillStyle = isSelected ? '#f2edfa' : (communityColor ?? node.color)
        ctx.font = `600 ${13 / view.k}px Inter, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'alphabetic'
        ctx.fillText(`${node.name} (${node.fileCount})`, node.x ?? 0, (node.y ?? 0) - node.radius - 12 / view.k)
        if (isSelected) {
          ctx.beginPath()
          ctx.arc(node.x ?? 0, node.y ?? 0, node.radius + 5 / view.k, 0, Math.PI * 2)
          ctx.lineWidth = 2.5 / view.k
          ctx.strokeStyle = '#f2edfa'
          ctx.stroke()
        }
        ctx.globalAlpha = 1
        continue
      }
      ctx.beginPath()
      ctx.arc(node.x ?? 0, node.y ?? 0, node.radius, 0, Math.PI * 2)
      ctx.fillStyle = communityColor ?? node.color
      ctx.fill()
      if (isSelected) {
        ctx.lineWidth = 3 / view.k
        ctx.strokeStyle = '#f2edfa'
        ctx.stroke()
      }
      if (isHighlighted) {
        ctx.beginPath()
        ctx.arc(node.x ?? 0, node.y ?? 0, node.radius + 5 / view.k, 0, Math.PI * 2)
        ctx.lineWidth = 2.5 / view.k
        ctx.strokeStyle = '#FF4696'
        ctx.stroke()
      }
      if (node.kind === 'file') {
        // Satellite: small filled dot, basename below when the parent is
        // small enough for labels to stay readable.
        if (node.label) {
          ctx.fillStyle = '#b8a8d9'
          ctx.font = `500 ${10 / view.k}px Inter, sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'alphabetic'
          ctx.fillText(node.label, node.x ?? 0, (node.y ?? 0) + node.radius + 13 / view.k)
        }
        ctx.globalAlpha = 1
        continue
      }
      // File count inside the node.
      ctx.fillStyle = '#1e1033'
      ctx.font = `600 ${Math.max(14, node.radius * 0.55 * view.k) / view.k}px Inter, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(node.fileCount), node.x ?? 0, node.y ?? 0)
      // Name below.
      ctx.fillStyle = isSelected ? '#f2edfa' : isHighlighted ? '#FF4696' : '#b8a8d9'
      ctx.font = `500 ${13 / view.k}px Inter, sans-serif`
      ctx.textBaseline = 'alphabetic'
      ctx.fillText(node.name, node.x ?? 0, (node.y ?? 0) + node.radius + 18 / view.k)
      ctx.globalAlpha = 1
    }

    // Minimap: whole world scaled into the corner box, nodes as dots in
    // their module colors, and the current viewport as a frame.
    const mini = miniRef.current
    const bounds = worldBoundsRef.current
    if (mini && bounds) {
      const mctx = mini.getContext('2d')
      if (mctx) {
        const MW = mini.width
        const MH = mini.height
        const margin = 10
        const bw = Math.max(1, bounds.maxX - bounds.minX)
        const bh = Math.max(1, bounds.maxY - bounds.minY)
        const ms = Math.min((MW - margin * 2) / bw, (MH - margin * 2) / bh)
        const ox = (MW - bw * ms) / 2 - bounds.minX * ms
        const oy = (MH - bh * ms) / 2 - bounds.minY * ms
        miniTransformRef.current = { ms, ox, oy }
        mctx.clearRect(0, 0, MW, MH)
        for (const node of nodes) {
          const isFile = node.kind === 'file'
          mctx.beginPath()
          mctx.arc((node.x ?? 0) * ms + ox, (node.y ?? 0) * ms + oy, isFile ? 1.6 : node.linked ? 4 : 3, 0, Math.PI * 2)
          mctx.fillStyle = node.color
          mctx.globalAlpha = isFile ? 0.6 : node.linked ? 1 : 0.45
          mctx.fill()
        }
        mctx.globalAlpha = 1
        // Viewport: the world rect the main canvas currently shows.
        const vx = (-view.x / view.k) * ms + ox
        const vy = (-view.y / view.k) * ms + oy
        const vw = (width / view.k) * ms
        const vh = (height / view.k) * ms
        mctx.strokeStyle = 'rgba(242, 237, 250, 0.85)'
        mctx.lineWidth = 1.5
        mctx.strokeRect(vx, vy, vw, vh)
      }
    }
  }, [])

  // Fit stored world bounds into the current canvas size with margin.
  const fitView = useCallback(() => {
    const canvas = canvasRef.current
    const bounds = worldBoundsRef.current
    if (!canvas || !bounds) return
    const { width, height } = canvas.getBoundingClientRect()
    if (width < 10 || height < 10) return
    const { minX, maxX, minY, maxY } = bounds
    const k = Math.min(1.6, Math.min(width / Math.max(1, maxX - minX), height / Math.max(1, maxY - minY)))
    viewRef.current = {
      k,
      x: width / 2 - ((minX + maxX) / 2) * k,
      y: height / 2 - ((minY + maxY) / 2) * k,
    }
  }, [])

  // Build and settle the layout once per data change; draw statically after.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const { width, height } = canvas.getBoundingClientRect()
    const maxCount = Math.max(1, ...modules.map((m) => m.fileCount))

    // "Linked" means import-linked: modules with no imports park in the
    // labelled side group even when calls reach them.
    const linkedNames = new Set<string>()
    for (const e of moduleEdges) {
      if (e.kind !== 'imports') continue
      linkedNames.add(e.from)
      linkedNames.add(e.to)
    }

    // Expanded modules become containers: their radius grows to hold rings
    // of file satellites, so the force layout and edge trimming make room.
    const ringLayout = (count: number): { container: number; rings: number[] } => {
      const rings: number[] = []
      let remaining = count
      let i = 0
      while (remaining > 0) {
        const cap = 8 * (i + 1)
        rings.push(Math.min(remaining, cap))
        remaining -= cap
        i++
      }
      const lastRadius = 70 + (rings.length - 1) * 52
      return { container: lastRadius + 46, rings }
    }
    const nodes: SimNode[] = modules.map((m, i) => {
      const isExpanded = expandedRef.current.has(m.name)
      return {
        name: m.name,
        fileCount: m.fileCount,
        radius: isExpanded ? ringLayout(m.fileCount).container : 18 + 30 * Math.sqrt(m.fileCount / maxCount),
        color: moduleColor(i),
        linked: linkedNames.has(m.name),
        kind: 'module' as const,
        x: width / 2 + Math.cos((i / modules.length) * Math.PI * 2) * 120,
        y: height / 2 + Math.sin((i / modules.length) * Math.PI * 2) * 120,
      }
    })
    const linked = nodes.filter((n) => n.linked)
    const unlinked = nodes.filter((n) => !n.linked).sort((a, b) => b.fileCount - a.fileCount)

    // Only import-linked nodes join the force field (call overlays never
    // move the settled import structure). Weak gravity keeps the cluster
    // tight instead of letting edge modules wander. Draw links stay plain
    // name pairs in both kinds; draw() resolves them through nodeByNameRef.
    const importEdges = moduleEdges.filter((e) => e.kind === 'imports')
    const linkedLinks = importEdges
      .filter((e) => linkedNames.has(e.from) && linkedNames.has(e.to))
      .map((e) => ({ source: e.from, target: e.to, count: e.count })) as SimulationLinkDatum<SimNode>[]
    nodesRef.current = nodes
    nodeByNameRef.current = new Map(nodes.map((n) => [n.name, n]))
    linksRef.current = moduleEdges.map((e) => ({ source: e.from, target: e.to, count: e.count, kind: e.kind }))
    if (linked.length > 0) {
      const simulation = forceSimulation(linked)
        .force('link', forceLink<SimNode, SimulationLinkDatum<SimNode>>(linkedLinks).id((d) => d.name).distance((l) => 130 - Math.min(50, ((l as { count?: number }).count ?? 1))))
        .force('charge', forceManyBody().strength(-320))
        .force('collide', forceCollide<SimNode>().radius((d) => d.radius + 26))
        .force('x', forceX(width / 2).strength(0.07))
        .force('y', forceY(height / 2).strength(0.1))
        .stop()
      for (let i = 0; i < 300; i++) simulation.tick()
    }

    // Unlinked modules: a tidy grid parked beside the cluster, largest first.
    unlinkedAnchorRef.current = null
    if (unlinked.length > 0) {
      const lxs = linked.map((n) => n.x ?? width / 2)
      const lys = linked.map((n) => n.y ?? height / 2)
      const clusterMaxX = linked.length > 0 ? Math.max(...lxs) : width / 2 - 220
      const clusterMinY = linked.length > 0 ? Math.min(...lys) : height / 2 - 140
      const clusterMaxY = linked.length > 0 ? Math.max(...lys) : height / 2 + 140

      const gap = 26
      const colWidth = Math.max(...unlinked.map((n) => n.radius)) * 2 + gap
      const startX = linked.length > 0 ? clusterMaxX + 150 : width / 2 - (Math.min(unlinked.length, 3) - 1) * (colWidth / 2)
      const areaTop = linked.length > 0 ? clusterMinY - 30 : height / 2 - 120
      const areaHeight = Math.max(220, clusterMaxY - clusterMinY + 60)
      const columns = Math.max(1, Math.ceil(unlinked.length / Math.max(1, Math.floor(areaHeight / 110))))

      unlinked.forEach((node, i) => {
        const col = Math.floor(i / Math.ceil(unlinked.length / columns))
        const row = i % Math.ceil(unlinked.length / columns)
        const rowsInCol = Math.ceil(unlinked.length / columns)
        node.x = startX + col * colWidth
        node.y = areaTop + 40 + (row + 0.5) * (areaHeight / rowsInCol)
      })
      const anchorX = startX + ((columns - 1) * colWidth) / 2
      unlinkedAnchorRef.current = { x: anchorX, y: areaTop }
    }

    // File satellites for expanded modules: deterministic concentric rings
    // around the module center, 8/16/24... per ring. No force simulation -
    // the geometry is stable and never overlaps inside the container.
    fileNodeByIdRef.current = new Map()
    for (const m of modules) {
      if (!expandedRef.current.has(m.name)) continue
      const hub = nodes.find((n) => n.name === m.name)
      if (!hub) continue
      const { rings } = ringLayout(m.fileCount)
      let idx = 0
      const showLabel = m.fileCount <= 60
      m.files.forEach((f) => {
        let ring = 0
        let acc = rings[0]
        while (idx >= acc) {
          ring++
          acc += rings[ring]
        }
        const posInRing = idx - (acc - rings[ring])
        const angle = (posInRing / rings[ring]) * Math.PI * 2 - Math.PI / 2 + (ring % 2) * 0.2
        const rr = 70 + ring * 52
        const base = f.path.split('/').pop() ?? f.path
        const node: SimNode = {
          name: `${m.name}/${base}`,
          label: showLabel ? (base.length > 12 ? `${base.slice(0, 10)}…` : base) : undefined,
          fileCount: 0,
          radius: 13,
          color: hub.color,
          linked: true,
          kind: 'file',
          path: f.path,
          parent: m.name,
          x: (hub.x ?? 0) + Math.cos(angle) * rr,
          y: (hub.y ?? 0) + Math.sin(angle) * rr,
        }
        nodes.push(node)
        fileNodeByIdRef.current.set(f.id, node)
        idx++
      })
    }

    // Fit the settled layout (cluster plus unlinked group) into view.
    const xs = nodes.map((n) => (n.x ?? 0) - n.radius)
    const xe = nodes.map((n) => (n.x ?? 0) + n.radius)
    const ys = nodes.map((n) => (n.y ?? 0) - n.radius - 30)
    const ye = nodes.map((n) => (n.y ?? 0) + n.radius + 40)
    worldBoundsRef.current = {
      minX: Math.min(...xs) - 40,
      maxX: Math.max(...xe) + 40,
      minY: Math.min(...ys, unlinkedAnchorRef.current ? unlinkedAnchorRef.current.y - 30 : Infinity) - 30,
      maxY: Math.max(...ye) + 30,
    }
    fitView()
    draw()
  }, [modules, moduleEdges, expanded, draw, fitView])

  // Re-fit when the canvas resizes (the file panel opening shrinks it).
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const observer = new ResizeObserver(() => {
      fitView()
      draw()
    })
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [fitView, draw])

  useEffect(() => {
    draw()
  }, [selected, highlighted, edgeVisibility, communityColors, dimmed, draw])

  const toWorld = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const view = viewRef.current
    return {
      x: (clientX - rect.left - view.x) / view.k,
      y: (clientY - rect.top - view.y) / view.k,
    }
  }

  const hitNode = (wx: number, wy: number): SimNode | null => {
    for (let i = nodesRef.current.length - 1; i >= 0; i--) {
      const node = nodesRef.current[i]
      if (Math.hypot((node.x ?? 0) - wx, (node.y ?? 0) - wy) <= node.radius + 4) return node
    }
    return null
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const world = toWorld(e.clientX, e.clientY)
    const hit = hitNode(world.x, world.y)
    // File satellites are not draggable: they belong to their ring geometry.
    const node = hit && hit.kind !== 'file' ? hit : null
    dragRef.current = { node, panning: !hit, startX: e.clientX, startY: e.clientY, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    const world = toWorld(e.clientX, e.clientY)
    if (drag.node) {
      if (Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY) > 3) drag.moved = true
      drag.node.x = world.x
      drag.node.y = world.y
      draw()
    } else if (drag.panning) {
      if (Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY) > 3) drag.moved = true
      viewRef.current.x += e.movementX
      viewRef.current.y += e.movementY
      draw()
    } else {
      const hover = hitNode(world.x, world.y)
      e.currentTarget.style.cursor = hover ? 'pointer' : 'grab'
    }
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    if (!drag.moved) {
      if (e.detail > 1) {
        // Second click of a double-click: onDoubleClick owns this gesture.
        dragRef.current = { node: null, panning: false, startX: 0, startY: 0, moved: false }
        return
      }
      const world = toWorld(e.clientX, e.clientY)
      const node = hitNode(world.x, world.y)
      if (node?.kind === 'file') {
        if (node.path) onOpenFile?.(node.path)
      } else {
        onSelect(node ? node.name : null)
      }
    }
    dragRef.current = { node: null, panning: false, startX: 0, startY: 0, moved: false }
  }

  // Double-click a module to expand it into file satellites; double-click
  // the container background to collapse it back.
  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const world = toWorld(e.clientX, e.clientY)
    const node = hitNode(world.x, world.y)
    if (!node || node.kind === 'file') return
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(node.name)) next.delete(node.name)
      else next.add(node.name)
      return next
    })
  }

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const view = viewRef.current
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
    const k = Math.min(4, Math.max(0.3, view.k * factor))
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    viewRef.current = {
      k,
      x: px - ((px - view.x) / view.k) * k,
      y: py - ((py - view.y) / view.k) * k,
    }
    draw()
  }

  // Clicking the minimap centers the main view on that world point.
  const onMiniPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const mini = miniRef.current
    const t = miniTransformRef.current
    if (!mini || !t) return
    const rect = mini.getBoundingClientRect()
    const mx = ((e.clientX - rect.left) / rect.width) * mini.width
    const my = ((e.clientY - rect.top) / rect.height) * mini.height
    const wx = (mx - t.ox) / t.ms
    const wy = (my - t.oy) / t.ms
    const canvas = canvasRef.current!
    const { width, height } = canvas.getBoundingClientRect()
    viewRef.current = { ...viewRef.current, x: width / 2 - wx * viewRef.current.k, y: height / 2 - wy * viewRef.current.k }
    draw()
  }

  return (
    <div className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        className="h-full w-full touch-none"
        role="img"
        aria-label="Architecture map of the repository's top-level modules"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        onWheel={onWheel}
      />
      <canvas
        ref={miniRef}
        width={320}
        height={200}
        className="absolute bottom-3 right-3 h-[100px] w-[160px] cursor-crosshair rounded-lg border border-line bg-surface-1/80"
        role="img"
        aria-label="Minimap overview - click to center the map"
        onPointerDown={onMiniPointerDown}
      />
    </div>
  )
}
