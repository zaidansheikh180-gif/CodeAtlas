// Groups indexed files into top-level modules (first path segment) and
// aggregates file-level edges into module edges, keeping the relationship
// kind: imports structure the layout, calls add dashed overlays. This powers
// the architecture map: about 8 to 12 readable nodes, never a hairball.

import type { EdgeRec, FileRec } from './types'

export interface ModuleNode {
  id: string
  name: string
  fileCount: number
  symbolCount: number
  files: FileRec[]
}

export interface ModuleEdge {
  from: string
  to: string
  count: number
  kind: 'imports' | 'calls'
}

const MERGE_BELOW = 3 // folders with fewer files fold into "Other"

export function buildModules(
  files: FileRec[],
  symbols: { id: string; fileId: string }[],
  edges: EdgeRec[],
): { modules: ModuleNode[]; moduleEdges: ModuleEdge[] } {
  const symbolsPerFile = new Map<string, number>()
  for (const s of symbols) symbolsPerFile.set(s.fileId, (symbolsPerFile.get(s.fileId) ?? 0) + 1)

  const groups = new Map<string, FileRec[]>()
  for (const file of files) {
    const segments = file.path.split('/')
    const key = segments.length > 1 ? segments[0] : '(root)'
    const bucket = groups.get(key) ?? []
    bucket.push(file)
    groups.set(key, bucket)
  }

  // Merge tiny folders into "Other" so the top level stays readable.
  const merged = new Map<string, FileRec[]>()
  const other: FileRec[] = []
  for (const [key, bucket] of groups) {
    if (key !== '(root)' && bucket.length < MERGE_BELOW) other.push(...bucket)
    else merged.set(key, bucket)
  }
  if (other.length > 0) merged.set('Other', other)

  const fileToModule = new Map<string, string>()
  const modules: ModuleNode[] = [...merged.entries()]
    .map(([name, bucket]) => {
      bucket.sort((a, b) => a.path.localeCompare(b.path))
      for (const file of bucket) fileToModule.set(file.id, name)
      return {
        id: `module:${name}`,
        name,
        fileCount: bucket.length,
        symbolCount: bucket.reduce((sum, f) => sum + (symbolsPerFile.get(f.id) ?? 0), 0),
        files: bucket,
      }
    })
    .sort((a, b) => b.fileCount - a.fileCount)

  // Calls edges are symbol-level, so resolve symbols back to their file
  // before bucketing to modules. Imports edges are file-level already.
  const symToFile = new Map<string, string>()
  for (const s of symbols) symToFile.set(s.id, s.fileId)
  const moduleOf = (id: string) => fileToModule.get(id) ?? fileToModule.get(symToFile.get(id) ?? '')

  const edgeCounts = new Map<string, ModuleEdge>()
  for (const edge of edges) {
    if (edge.type !== 'imports' && edge.type !== 'calls') continue
    const from = moduleOf(edge.fromId)
    const to = moduleOf(edge.toId)
    if (!from || !to || from === to) continue
    const key = `${from}->${to}|${edge.type}`
    const existing = edgeCounts.get(key)
    if (existing) existing.count++
    else edgeCounts.set(key, { from, to, count: 1, kind: edge.type })
  }

  return { modules, moduleEdges: [...edgeCounts.values()].sort((a, b) => b.count - a.count) }
}

// Categorical module colors derived from the Night Violet / Dragonfruit
// palette family. Color always pairs with a label, never stands alone.
export const MODULE_COLORS = [
  '#FF4696', // dragonfruit (accent)
  '#7AB8FF', // info blue
  '#3ECF8E', // green
  '#F5B942', // amber
  '#B98CFF', // violet
  '#FF8A5C', // coral
  '#4FD8D8', // teal
  '#E4D35C', // yellow
  '#8FB8FF', // periwinkle
  '#FF6FB1', // pink
  '#6FD3A7', // mint
  '#C9A0FF', // lavender
]

export function moduleColor(index: number): string {
  return MODULE_COLORS[index % MODULE_COLORS.length]
}
