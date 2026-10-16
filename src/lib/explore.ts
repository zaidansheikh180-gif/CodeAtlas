// File and dependency explorer data layer (phase 4): builds the repository
// tree from indexed files, attaches sizes and dependency counts, and flattens
// the visible (expanded) portion into fixed-height rows for virtualized
// rendering. Pure functions - unit-tested with bun test.

import type { EdgeRec, FileRec } from './types'

export interface TreeFolder {
  kind: 'folder'
  name: string
  path: string
  children: TreeNode[]
  fileCount: number
  totalSize: number
}

export interface TreeFile {
  kind: 'file'
  name: string
  path: string
  file: FileRec
  importsOut: number
  importsIn: number
}

export type TreeNode = TreeFolder | TreeFile

export type TreeSort = 'name' | 'size' | 'deps'

export interface FlatRow {
  node: TreeNode
  depth: number
}

// Dependency counts per file id from the graph's import edges.
export function computeDepCounts(edges: EdgeRec[]): Map<string, { out: number; inn: number }> {
  const counts = new Map<string, { out: number; inn: number }>()
  const bump = (id: string, key: 'out' | 'inn') => {
    const c = counts.get(id) ?? { out: 0, inn: 0 }
    c[key]++
    counts.set(id, c)
  }
  for (const e of edges) {
    if (e.type !== 'imports') continue
    bump(e.fromId, 'out')
    bump(e.toId, 'inn')
  }
  return counts
}

function sortNodes(nodes: TreeNode[], mode: TreeSort): void {
  nodes.sort((a, b) => {
    // Folders always precede files, whatever the sort.
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
    if (mode === 'name') return a.name.localeCompare(b.name)
    if (mode === 'size') {
      const sa = a.kind === 'file' ? a.file.size : a.totalSize
      const sb = b.kind === 'file' ? b.file.size : b.totalSize
      return sb - sa || a.name.localeCompare(b.name)
    }
    const da = a.kind === 'file' ? a.importsOut + a.importsIn : -1
    const db = b.kind === 'file' ? b.importsOut + b.importsIn : -1
    return db - da || a.name.localeCompare(b.name)
  })
  for (const n of nodes) if (n.kind === 'folder') sortNodes(n.children, mode)
}

export function buildFileTree(files: FileRec[], depCounts: Map<string, { out: number; inn: number }>, sort: TreeSort = 'name'): TreeFolder {
  const root: TreeFolder = { kind: 'folder', name: '', path: '', children: [], fileCount: 0, totalSize: 0 }
  const folders = new Map<string, TreeFolder>()
  folders.set('', root)
  const folderAt = (path: string): TreeFolder => {
    const existing = folders.get(path)
    if (existing) return existing
    const parentPath = path.split('/').slice(0, -1).join('/')
    const folder: TreeFolder = {
      kind: 'folder',
      name: path.split('/').pop() ?? path,
      path,
      children: [],
      fileCount: 0,
      totalSize: 0,
    }
    folderAt(parentPath).children.push(folder)
    folders.set(path, folder)
    return folder
  }
  for (const file of files) {
    const parts = file.path.split('/')
    const parent = folderAt(parts.slice(0, -1).join('/'))
    const counts = depCounts.get(file.id) ?? { out: 0, inn: 0 }
    parent.children.push({
      kind: 'file',
      name: parts[parts.length - 1],
      path: file.path,
      file,
      importsOut: counts.out,
      importsIn: counts.inn,
    })
  }
  // Aggregate folder stats bottom-up.
  const aggregate = (folder: TreeFolder): { files: number; size: number } => {
    let f = 0
    let s = 0
    for (const child of folder.children) {
      if (child.kind === 'file') {
        f++
        s += child.file.size
      } else {
        const sub = aggregate(child)
        f += sub.files
        s += sub.size
      }
    }
    folder.fileCount = f
    folder.totalSize = s
    return { files: f, size: s }
  }
  aggregate(root)
  sortNodes(root.children, sort)
  return root
}

// Flatten the expanded portion of the tree into rows for the virtual list.
export function flattenTree(root: TreeFolder, expanded: Set<string>): FlatRow[] {
  const rows: FlatRow[] = []
  const walk = (node: TreeNode, depth: number) => {
    rows.push({ node, depth })
    if (node.kind === 'folder' && expanded.has(node.path)) {
      for (const child of node.children) walk(child, depth + 1)
    }
  }
  for (const child of root.children) walk(child, 0)
  return rows
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}
