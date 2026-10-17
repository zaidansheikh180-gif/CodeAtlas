// Record shapes for the IndexedDB stores. Mirrors the "v1 local storage"
// section of BACKEND_SCHEMA.md; keep the two in sync.

export type EdgeType = 'imports' | 'calls' | 'contains'
export type EdgeConfidence = 'extracted' | 'inferred'
export type JobStage =
  | 'fetching'
  | 'filtering'
  | 'secrets'
  | 'parsing'
  | 'graph'
  | 'storing'
  | 'done'
  | 'failed'
  | 'canceled'

export interface RepoRec {
  id: string
  url: string
  fullName: string
  commit: string
  defaultBranch: string
  // The branch, tag or commit the user chose on the landing page. Absent on
  // indexes created before the ref picker existed; treat as defaultBranch.
  ref?: string
  status: 'indexing' | 'ready' | 'failed'
  description: string | null
  language: string | null
  sizeKb: number
  stats: { files: number; parsedFiles: number; symbols: number; edges: number; secretsExcluded: number }
  indexedAt: number
  // True when this record came from a graph JSON import rather than a live
  // GitHub index. Imported repos skip re-index and provenance claims.
  imported?: boolean
  // True when this record is a materialized snapshot view (phase 6). Hidden
  // from the landing list; opened through the snapshots panel.
  snapshot?: boolean
  // True when this record came from a local folder picked with the File
  // System Access API (phase 8). Local repos never touch GitHub: no re-index
  // against a remote, and their files never leave the device.
  local?: boolean
  // The picked directory handle, kept so watch mode (phase 8 part 2) can
  // re-scan without asking again. IndexedDB structured-clones handles in
  // supporting browsers; permission is re-queried before every scan.
  localHandle?: FileSystemDirectoryHandle
  // The manifest watch mode diffs each scan against, refreshed on every
  // local index and re-scan. Stored as a plain array (structured-clone
  // friendly): {path, size, lastModified, sha}.
  localManifest?: { path: string; size: number; lastModified: number; sha: string }[]
}

export interface FileRec {
  id: string
  repoId: string
  path: string
  language: string
  size: number
  contentHash: string
  text: string
}

export interface SymbolRec {
  id: string
  repoId: string
  fileId: string
  kind: 'function' | 'class' | 'method'
  name: string
  startLine: number
  endLine: number
}

export interface EdgeRec {
  id: string
  repoId: string
  fromId: string
  toId: string
  type: EdgeType
  confidence: EdgeConfidence
}

export interface JobRec {
  id: string
  repoId: string
  stage: JobStage
  detail: string
  error: string | null
  updatedAt: number
}

export interface SettingRec {
  key: string
  value: string
}
