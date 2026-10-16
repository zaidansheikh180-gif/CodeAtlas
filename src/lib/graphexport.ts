// Graph export and import (phase 5, spec-2 section 22). Fully client-side:
// exports render in the page and download; imports parse, validate and remap
// into IndexedDB. Nothing here touches the network.
//
// The export file carries the full fidelity of the index - file text
// included - so an imported graph keeps every citation. Import validation is
// hand-rolled and strict: unknown fields are ignored, missing or mistyped
// required fields fail the whole import, and oversized files are warned
// about or rejected before parsing.

import { edgeId, fileId, symbolId } from './db'
import type { ModuleEdge, ModuleNode } from './modules'
import type { EdgeRec, EdgeType, FileRec, RepoRec, SymbolRec } from './types'

export const GRAPH_EXPORT_KIND = 'codeatlas-graph-export'
export const GRAPH_EXPORT_SCHEMA_VERSION = 1
// Hard reject above this many bytes; warn (require confirmation) above the
// soft limit. Parsing a 50 MB JSON in the page would freeze the tab.
export const IMPORT_SOFT_LIMIT_BYTES = 10 * 1024 * 1024
export const IMPORT_HARD_LIMIT_BYTES = 50 * 1024 * 1024
export const IMPORT_MAX_RECORDS = 200_000

export interface GraphExportFile {
  kind: typeof GRAPH_EXPORT_KIND
  schemaVersion: number
  exportedAt: string
  repo: {
    url: string
    fullName: string
    ref: string
    commit: string
    indexedAt: number
  }
  counts: { files: number; symbols: number; edges: number }
  files: FileRec[]
  symbols: SymbolRec[]
  edges: EdgeRec[]
}

export interface GraphFilter {
  // Top-level path segments to keep (e.g. ["lib", "test"]). Empty = all.
  modules?: string[]
  edgeTypes?: EdgeType[]
}

export function filterGraph(files: FileRec[], symbols: SymbolRec[], edges: EdgeRec[], filter: GraphFilter): { files: FileRec[]; symbols: SymbolRec[]; edges: EdgeRec[] } {
  const modules = filter.modules && filter.modules.length > 0 ? new Set(filter.modules) : null
  const types = filter.edgeTypes && filter.edgeTypes.length > 0 ? new Set(filter.edgeTypes) : null
  const keepFile = (f: FileRec) => !modules || modules.has(f.path.split('/')[0])
  const keptFiles = files.filter(keepFile)
  const keptIds = new Set(keptFiles.map((f) => f.id))
  const keptSymbols = symbols.filter((s) => keptIds.has(s.fileId))
  const keptSymbolIds = new Set(keptSymbols.map((s) => s.id))
  const keptEdges = edges.filter(
    (e) =>
      (!types || types.has(e.type)) &&
      (keptIds.has(e.fromId) || keptSymbolIds.has(e.fromId)) &&
      (keptIds.has(e.toId) || keptSymbolIds.has(e.toId)),
  )
  return { files: keptFiles, symbols: keptSymbols, edges: keptEdges }
}

export function exportGraph(repo: RepoRec, files: FileRec[], symbols: SymbolRec[], edges: EdgeRec[], filter: GraphFilter = {}): GraphExportFile {
  const subset = filterGraph(files, symbols, edges, filter)
  return {
    kind: GRAPH_EXPORT_KIND,
    schemaVersion: GRAPH_EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    repo: {
      url: repo.url,
      fullName: repo.fullName,
      ref: repo.ref ?? repo.defaultBranch,
      commit: repo.commit,
      indexedAt: repo.indexedAt,
    },
    counts: { files: subset.files.length, symbols: subset.symbols.length, edges: subset.edges.length },
    files: subset.files,
    symbols: subset.symbols,
    edges: subset.edges,
  }
}

// --- Architecture map exports ------------------------------------------------

export function exportMapJson(repo: RepoRec, modules: ModuleNode[], moduleEdges: ModuleEdge[]): string {
  return JSON.stringify(
    {
      kind: 'codeatlas-map-export',
      schemaVersion: GRAPH_EXPORT_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      repo: { url: repo.url, fullName: repo.fullName, ref: repo.ref ?? repo.defaultBranch, commit: repo.commit, indexedAt: repo.indexedAt },
      modules: modules.map((m) => ({ name: m.name, fileCount: m.fileCount, symbolCount: m.symbolCount, files: m.files.map((f) => f.path) })),
      edges: moduleEdges.map((e) => ({ source: e.from, target: e.to, kind: e.kind, count: e.count })),
    },
    null,
    2,
  )
}

function mermaidId(name: string): string {
  const clean = name.replace(/[^a-zA-Z0-9_]/g, '_')
  return /^[0-9]/.test(clean) ? `m_${clean}` : clean || 'unnamed'
}

export function mapToMermaid(modules: ModuleNode[], moduleEdges: ModuleEdge[]): string {
  const lines = ['flowchart LR']
  for (const m of [...modules].sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push(`  ${mermaidId(m.name)}["${m.name} (${m.fileCount} files)"]`)
  }
  const sorted = [...moduleEdges].sort((a, b) => `${a.from}${a.to}${a.kind}`.localeCompare(`${b.from}${b.to}${b.kind}`))
  for (const e of sorted) {
    const arrow = e.kind === 'calls' ? '-.->' : '-->'
    lines.push(`  ${mermaidId(e.from)} ${arrow}|${e.kind} x${e.count}| ${mermaidId(e.to)}`)
  }
  return lines.join('\n') + '\n'
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function mapToGraphml(modules: ModuleNode[], moduleEdges: ModuleEdge[]): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="files" for="node" attr.name="files" attr.type="int"/>',
    '  <key id="kind" for="edge" attr.name="kind" attr.type="string"/>',
    '  <key id="count" for="edge" attr.name="count" attr.type="int"/>',
    '  <graph id="codeatlas" edgedefault="directed">',
  ]
  for (const m of [...modules].sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push(`    <node id="${xmlEscape(m.name)}"><data key="files">${m.fileCount}</data></node>`)
  }
  const sorted = [...moduleEdges].sort((a, b) => `${a.from}${a.to}${a.kind}`.localeCompare(`${b.from}${b.to}${b.kind}`))
  sorted.forEach((e, i) => {
    lines.push(`    <edge id="e${i}" source="${xmlEscape(e.from)}" target="${xmlEscape(e.to)}"><data key="kind">${e.kind}</data><data key="count">${e.count}</data></edge>`)
  })
  lines.push('  </graph>', '</graphml>')
  return lines.join('\n') + '\n'
}

// --- Import ------------------------------------------------------------------

export type ImportResult =
  | { ok: true; data: GraphExportFile; warning: string | null }
  | { ok: false; error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function validateGraphImport(text: string, byteSize: number): ImportResult {
  if (byteSize > IMPORT_HARD_LIMIT_BYTES) {
    return { ok: false, error: `File is ${(byteSize / 1024 / 1024).toFixed(1)} MB - over the 50 MB import limit. Import refused.` }
  }
  const warning = byteSize > IMPORT_SOFT_LIMIT_BYTES ? `This export is ${(byteSize / 1024 / 1024).toFixed(1)} MB. Importing may take a moment and use significant browser storage.` : null

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, error: 'The file is not valid JSON.' }
  }
  if (!isRecord(parsed)) return { ok: false, error: 'The file does not contain a graph export object.' }
  if (parsed.kind !== GRAPH_EXPORT_KIND) return { ok: false, error: `Unrecognized file kind "${String(parsed.kind)}". Expected a CodeAtlas graph export.` }
  if (parsed.schemaVersion !== GRAPH_EXPORT_SCHEMA_VERSION) {
    return { ok: false, error: `Unsupported schema version ${String(parsed.schemaVersion)}. This build reads version ${GRAPH_EXPORT_SCHEMA_VERSION}.` }
  }
  const repo = parsed.repo
  if (!isRecord(repo) || typeof repo.url !== 'string' || typeof repo.fullName !== 'string' || typeof repo.commit !== 'string' || typeof repo.indexedAt !== 'number') {
    return { ok: false, error: 'The export is missing repository metadata.' }
  }
  const { files, symbols, edges } = parsed as { files?: unknown; symbols?: unknown; edges?: unknown }
  if (!Array.isArray(files) || !Array.isArray(symbols) || !Array.isArray(edges)) {
    return { ok: false, error: 'The export is missing its files, symbols or edges arrays.' }
  }
  if (files.length + symbols.length + edges.length > IMPORT_MAX_RECORDS) {
    return { ok: false, error: `The export holds ${(files.length + symbols.length + edges.length).toLocaleString()} records - over the ${IMPORT_MAX_RECORDS.toLocaleString()} safety cap. Import refused.` }
  }
  for (const f of files) {
    if (!isRecord(f) || typeof f.id !== 'string' || typeof f.path !== 'string' || typeof f.text !== 'string') {
      return { ok: false, error: 'A file record is malformed (missing id, path or text).' }
    }
  }
  for (const s of symbols) {
    if (!isRecord(s) || typeof s.id !== 'string' || typeof s.fileId !== 'string' || typeof s.name !== 'string' || typeof s.startLine !== 'number' || typeof s.endLine !== 'number' || !Number.isFinite(s.startLine) || !Number.isFinite(s.endLine)) {
      return { ok: false, error: 'A symbol record is malformed (missing id, fileId, name or line numbers).' }
    }
  }
  const EDGE_TYPES: EdgeType[] = ['imports', 'calls', 'contains']
  for (const e of edges) {
    if (!isRecord(e) || typeof e.id !== 'string' || typeof e.fromId !== 'string' || typeof e.toId !== 'string' || typeof e.type !== 'string' || !EDGE_TYPES.includes(e.type as EdgeType)) {
      return { ok: false, error: 'An edge record is malformed (missing id, endpoints or a known relationship type).' }
    }
  }
  return { ok: true, data: parsed as unknown as GraphExportFile, warning }
}

// Remap every record onto a fresh repo id. Ids are recomputed from content
// (the same scheme the indexer uses), so an import can never collide with or
// overwrite an existing index. Edges whose endpoints cannot be resolved are
// dropped and counted.
export function remapImport(data: GraphExportFile, newRepoId: string): { files: FileRec[]; symbols: SymbolRec[]; edges: EdgeRec[]; droppedEdges: number } {
  const pathByOldFileId = new Map(data.files.map((f) => [f.id, f.path]))
  const files: FileRec[] = data.files.map((f) => ({
    id: fileId(newRepoId, f.path),
    repoId: newRepoId,
    path: f.path,
    language: typeof f.language === 'string' ? f.language : 'unknown',
    size: typeof f.size === 'number' ? f.size : f.text.length,
    contentHash: typeof f.contentHash === 'string' ? f.contentHash : '',
    text: f.text,
  }))
  const idMap = new Map<string, string>()
  data.files.forEach((f, i) => idMap.set(f.id, files[i].id))

  const symbols: SymbolRec[] = []
  for (const s of data.symbols) {
    const path = pathByOldFileId.get(s.fileId)
    if (!path) continue // symbol without its file cannot be placed
    const id = symbolId(newRepoId, path, s.name, s.startLine)
    idMap.set(s.id, id)
    symbols.push({
      id,
      repoId: newRepoId,
      fileId: fileId(newRepoId, path),
      kind: s.kind === 'class' || s.kind === 'method' ? s.kind : 'function',
      name: s.name,
      startLine: s.startLine,
      endLine: s.endLine,
    })
  }

  const edges: EdgeRec[] = []
  let droppedEdges = 0
  for (const e of data.edges) {
    const fromId = idMap.get(e.fromId)
    const toId = idMap.get(e.toId)
    if (!fromId || !toId) {
      droppedEdges++
      continue
    }
    edges.push({
      id: edgeId(newRepoId, fromId, toId, e.type),
      repoId: newRepoId,
      fromId,
      toId,
      type: e.type,
      confidence: e.confidence === 'extracted' ? 'extracted' : 'inferred',
    })
  }
  return { files, symbols, edges, droppedEdges }
}
