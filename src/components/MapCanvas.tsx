// Canvas renderer for the first architecture map: one node per top-level
// module, edges for aggregated imports between them. Layered drill-down into
// files and symbols is a later phase; this level is built to stay readable.

import { useEffect, useRef, useCallback } from 'react'
import { forceSimulation, forceLink, forceManyBody, forceCollide, forceCenter, type SimulationNodeDatum, type SimulationLinkDatum } from 'd3-force'
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
}

interface ViewTransform {
  x: number
  y: number
  k: number
}

export default function MapCanvas({ modules, moduleEdges, selected, onSelect }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const nodesRef = useRef<SimNode[]>([])
  const linksRef = useRef<SimulationLinkDatum<SimNode>[]>([])
  const viewRef = useRef<ViewTransform>({ x: 0, y: 0, k: 1 })
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
    const byName = new Map(nodes.map((n) => [n.name, n]))

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

    // Nodes: flat fills, label under each node. Color pairs with the label.
    for (const node of nodes) {
      const isSelected = node.name === selectedRef.current
      ctx.beginPath()
      ctx.arc(node.x ?? 0, node.y ?? 0, node.radius, 0, Math.PI * 2)
      ctx.fillStyle = node.color
      ctx.fill()
      if (isSelected) {
        ctx.lineWidth = 3
        ctx.strokeStyle = '#f2edfa'
        ctx.stroke()
      }
      // File count inside the node.
      ctx.fillStyle = '#1e1033'
      ctx.font = `600 ${Math.max(11, node.radius * 0.55)}px Inter, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(node.fileCount), node.x ?? 0, node.y ?? 0)
      // Name below.
      ctx.fillStyle = isSelected ? '#f2edfa' : '#b8a8d9'
      ctx.font = `500 12px Inter, sans-serif`
      ctx.fillText(node.name, node.x ?? 0, (node.y ?? 0) + node.radius + 14)
    }
    void byName
  }, [])

  // Build and settle the layout once per data change; draw statically after.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const { width, height } = canvas.getBoundingClientRect()
    const maxCount = Math.max(1, ...modules.map((m) => m.fileCount))
    const nodes: SimNode[] = modules.map((m, i) => ({
      name: m.name,
      fileCount: m.fileCount,
      radius: 16 + 26 * Math.sqrt(m.fileCount / maxCount),
      color: moduleColor(i),
      x: width / 2 + Math.cos((i / modules.length) * Math.PI * 2) * 120,
      y: height / 2 + Math.sin((i / modules.length) * Math.PI * 2) * 120,
    }))
    const links = moduleEdges.map((e) => ({ source: e.from, target: e.to, count: e.count }))
    nodesRef.current = nodes
    linksRef.current = links as SimulationLinkDatum<SimNode>[]

    const simulation = forceSimulation(nodes)
      .force('link', forceLink<SimNode, SimulationLinkDatum<SimNode>>(links as SimulationLinkDatum<SimNode>[]).id((d) => d.name).distance((l) => 140 - Math.min(60, ((l as { count?: number }).count ?? 1))))
      .force('charge', forceManyBody().strength(-260))
      .force('collide', forceCollide<SimNode>().radius((d) => d.radius + 28))
      .force('center', forceCenter(width / 2, height / 2))
      .stop()
    for (let i = 0; i < 240; i++) simulation.tick()

    // Fit the settled layout into view with margin.
    const xs = nodes.map((n) => n.x ?? 0)
    const ys = nodes.map((n) => n.y ?? 0)
    const minX = Math.min(...xs) - 60
    const maxX = Math.max(...xs) + 60
    const minY = Math.min(...ys) - 80
    const maxY = Math.max(...ys) + 80
    const k = Math.min(1.4, Math.min(width / Math.max(1, maxX - minX), height / Math.max(1, maxY - minY)))
    viewRef.current = {
      k,
      x: width / 2 - ((minX + maxX) / 2) * k,
      y: height / 2 - ((minY + maxY) / 2) * k,
    }
    draw()
  }, [modules, moduleEdges, draw])

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
