// Visual diff map data (phase 6, spec-2 section 23): the union module graph
// of two snapshots with a change status per module and per edge. The compare
// view feeds this straight into MapCanvas - status colors ride the existing
// communityColors channel, edge status rides the edgeStatus prop.

import { buildModules, type ModuleEdge, type ModuleNode } from './modules'
import type { ComparisonReport, SnapshotRec } from './snapshots'

export type ChangeStatus = 'added' | 'removed' | 'modified' | 'unchanged'
export type EdgeChangeStatus = 'added' | 'removed'

// Night Violet / Dragonfruit family; matches the legend in the compare view.
export const STATUS_COLORS: Record<ChangeStatus, string> = {
  added: '#3ECF8E',
  removed: '#FF4696',
  modified: '#F5B942',
  unchanged: '#8A76B3',
}

export interface DiffMapData {
  modules: ModuleNode[]
  moduleEdges: ModuleEdge[]
  moduleStatus: Map<string, ChangeStatus>
  edgeStatus: Map<string, EdgeChangeStatus>
}

export const diffEdgeKey = (from: string, to: string, kind: string): string => `${from}->${to}|${kind}`

export function buildDiffMap(a: SnapshotRec, b: SnapshotRec, report: ComparisonReport): DiffMapData {
  const aGraph = buildModules(a.data.files, a.data.symbols, a.data.edges)
  const bGraph = buildModules(b.data.files, b.data.symbols, b.data.edges)

  const aModuleNames = new Set(aGraph.modules.map((m) => m.name))
  const bModuleNames = new Set(bGraph.modules.map((m) => m.name))
  const changedFiles = new Set([...report.files.added, ...report.files.removed, ...report.files.modified])

  // Modules come from B (the newer version); modules that exist only in A
  // are appended so removed edges still have both endpoints to draw between.
  const moduleStatus = new Map<string, ChangeStatus>()
  const modules: ModuleNode[] = []
  for (const m of bGraph.modules) {
    let status: ChangeStatus
    if (!aModuleNames.has(m.name)) status = 'added'
    else if (m.files.some((f) => changedFiles.has(f.path))) status = 'modified'
    else status = 'unchanged'
    moduleStatus.set(m.name, status)
    modules.push(m)
  }
  for (const m of aGraph.modules) {
    if (bModuleNames.has(m.name)) continue
    moduleStatus.set(m.name, 'removed')
    modules.push(m)
  }

  // Edge keys include the kind, so an imports edge that became a calls edge
  // reads as one removed plus one added. Removed edges stay in the list -
  // MapCanvas draws them dashed pink from edgeStatus.
  const aEdges = new Map(aGraph.moduleEdges.map((e) => [diffEdgeKey(e.from, e.to, e.kind), e]))
  const bEdges = new Map(bGraph.moduleEdges.map((e) => [diffEdgeKey(e.from, e.to, e.kind), e]))
  const edgeStatus = new Map<string, EdgeChangeStatus>()
  const moduleEdges: ModuleEdge[] = []
  for (const [key, e] of bEdges) {
    moduleEdges.push(e)
    if (!aEdges.has(key)) edgeStatus.set(key, 'added')
  }
  for (const [key, e] of aEdges) {
    if (bEdges.has(key)) continue
    moduleEdges.push(e)
    edgeStatus.set(key, 'removed')
  }

  return { modules, moduleEdges, moduleStatus, edgeStatus }
}
