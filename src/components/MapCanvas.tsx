// Canvas renderer for the first architecture map: one node per top-level
// module, edges for aggregated imports between them. Layered drill-down into
// files and symbols is a later phase; this level is built to stay readable.
//
// Layout rules (phase 1 polish, user feedback 2026-10-16):
// - Modules with import links settle together in a force layout with weak
//   gravity, so the cluster stays tight.
// - Modules with no links never join the force field; they sit in a tidy
//   labelled group ("No imports found") beside the cluster instead of
//   drifting to the edges.
// - Labels are drawn at a constant screen size so zoom never makes them
//   unreadable, and the settled layout is fitted to the canvas bounds.

import { useEffect, useRef, useCallback } from 'react'
import { forceSimulation, forceLink, forceManyBody, forceCollide, forceX, forceY, type SimulationNodeDatum, type SimulationLinkDatum } from 'd3-force'
import { moduleColor, type ModuleEdge, type ModuleNode } from '../lib/modules'

interface Props {
  modules: ModuleNode[]
  moduleEdges: ModuleEdge[]
  selected: string | null
  onSelect: (moduleName: string | null) => void
}

interface SimNode extends SimulationNodeDatum {
  name: string
  radius: number
  color: string
  fileCount: number
  linked: boolean
}

interface ViewTransform {
  x: number
  y: number
  k: number
}

const UNLINKED_LABEL = 'No imports found'

export default function MapCanvas({ modules, moduleEdges, selected, onSelect }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const nodesRef = useRef<SimNode[]>([])
  const linksRef = useRef<SimulationLinkDatum<SimNode>[]>([])
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

    // Edges: hairlines, weight by import count, direction arrow.
    for (const link of linksRef.current) {
      const source = link.source as SimNode
      const target = link.target as SimNode
      const count = (link as { count?: number }).count ?? 1
      ctx.strokeStyle = 'rgba(184, 168, 217, 0.35)'
      ctx.lineWidth = Math.min(1 + Math.log2(count), 4)
      ctx.beginPath()
      ctx.moveTo(source.x ?? 0, source.y ?? 0)
      ctx.lineTo(target.x ?? 0, target.y ?? 0)
      ctx.stroke()
      // Small arrowhead pointing at the target.
      const dx = (target.x ?? 0) - (source.x ?? 0)
      const dy = (target.y ?? 0) - (source.y ?? 0)
      const len = Math.hypot(dx, dy) || 1
      const ux = dx / len
      const uy = dy / len
      const tipX = (target.x ?? 0) - ux * (target.radius + 3)
      const tipY = (target.y ?? 0) - uy * (target.radius + 3)
      ctx.fillStyle = 'rgba(184, 168, 217, 0.5)'
      ctx.beginPath()
      ctx.moveTo(tipX, tipY)
      ctx.lineTo(tipX - 7 * ux + 4 * -uy, tipY - 7 * uy + 4 * ux)
      ctx.lineTo(tipX - 7 * ux - 4 * -uy, tipY - 7 * uy - 4 * ux)
      ctx.fill()
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
      const isSelected = node.name === selectedRef.current
      ctx.beginPath()
      ctx.arc(node.x ?? 0, node.y ?? 0, node.radius, 0, Math.PI * 2)
      ctx.fillStyle = node.color
      ctx.fill()
      if (isSelected) {
        ctx.lineWidth = 3 / view.k
        ctx.strokeStyle = '#f2edfa'
        ctx.stroke()
      }
      // File count inside the node.
      ctx.fillStyle = '#1e1033'
      ctx.font = `600 ${Math.max(14, node.radius * 0.55 * view.k) / view.k}px Inter, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(node.fileCount), node.x ?? 0, node.y ?? 0)
      // Name below.
      ctx.fillStyle = isSelected ? '#f2edfa' : '#b8a8d9'
      ctx.font = `500 ${13 / view.k}px Inter, sans-serif`
      ctx.textBaseline = 'alphabetic'
      ctx.fillText(node.name, node.x ?? 0, (node.y ?? 0) + node.radius + 18 / view.k)
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

    const linkedNames = new Set<string>()
    for (const e of moduleEdges) {
      linkedNames.add(e.from)
      linkedNames.add(e.to)
    }

    const nodes: SimNode[] = modules.map((m, i) => ({
      name: m.name,
      fileCount: m.fileCount,
      radius: 18 + 30 * Math.sqrt(m.fileCount / maxCount),
      color: moduleColor(i),
      linked: linkedNames.has(m.name),
      x: width / 2 + Math.cos((i / modules.length) * Math.PI * 2) * 120,
      y: height / 2 + Math.sin((i / modules.length) * Math.PI * 2) * 120,
    }))
    const linked = nodes.filter((n) => n.linked)
    const unlinked = nodes.filter((n) => !n.linked).sort((a, b) => b.fileCount - a.fileCount)

    // Only linked nodes join the force field. Weak gravity keeps the cluster
    // tight instead of letting edge modules wander. Links still carry name
    // strings at this point (forceLink resolves them to node objects in
    // place), so the same array must drive both the simulation and draw().
    const linkedLinks = moduleEdges
      .filter((e) => linkedNames.has(e.from) && linkedNames.has(e.to))
      .map((e) => ({ source: e.from, target: e.to, count: e.count })) as SimulationLinkDatum<SimNode>[]
    nodesRef.current = nodes
    linksRef.current = linkedLinks
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
  }, [modules, moduleEdges, draw, fitView])

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
  }, [selected, draw])

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
    const node = hitNode(world.x, world.y)
    dragRef.current = { node, panning: !node, startX: e.clientX, startY: e.clientY, moved: false }
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
      const world = toWorld(e.clientX, e.clientY)
      const node = hitNode(world.x, world.y)
      onSelect(node ? node.name : null)
    }
    dragRef.current = { node: null, panning: false, startX: 0, startY: 0, moved: false }
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

  return (
    <canvas
      ref={canvasRef}
      className="h-full w-full touch-none"
      role="img"
      aria-label="Architecture map of the repository's top-level modules"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onWheel={onWheel}
    />
  )
}
