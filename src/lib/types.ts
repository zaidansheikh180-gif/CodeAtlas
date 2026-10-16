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
  status: 'indexing' | 'ready' | 'failed'
  description: string | null
  language: string | null
  sizeKb: number
  stats: { files: number; parsedFiles: number; symbols: number; edges: number; secretsExcluded: number }
  indexedAt: number
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
