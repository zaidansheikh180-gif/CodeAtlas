// Graph construction from parse results. Nodes are files and symbols; edges
// are imports, calls and contains, each tagged EXTRACTED (read from the syntax
// tree and resolved directly) or INFERRED (matched by name). No LLM involved.

import type { ParsedCall, ParsedImport, ParsedSymbol } from './parse'
import type { EdgeRec, FileRec, SymbolRec } from '../lib/types'
import { edgeId, fileId, symbolId } from '../lib/db'
import { extOf } from '../lib/filter'

export interface FileParse {
  path: string
  language: string
  result: { symbols: ParsedSymbol[]; imports: ParsedImport[]; calls: ParsedCall[] } | null
}

const JS_EXTS = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts', 'd.ts']

function normalizePath(path: string): string {
  const parts: string[] = []
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return parts.join('/')
}

function dirOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

/** Resolve an import source to a repo file path, or null for external packages. */
export function resolveImport(
  importerPath: string,
  imp: ParsedImport,
  language: string,
  allPaths: Set<string>,
): string | null {
  if (language === 'python') {
    const dotted = imp.source
    if (!dotted) return null
    const asPath = dotted.replace(/\./g, '/')
    const bases: string[] = []
    if (imp.relativeDots && imp.relativeDots > 0) {
      let dir = dirOf(importerPath)
      for (let i = 1; i < imp.relativeDots; i++) dir = dirOf(dir)
      bases.push(dir ? `${dir}/${asPath}` : asPath)
    } else {
      // Absolute dotted import: repo root, src layout and the importer's dir.
      bases.push(asPath)
      bases.push(`src/${asPath}`)
      const dir = dirOf(importerPath)
      if (dir) bases.push(`${dir}/${asPath}`)
    }
    for (const base of bases) {
      for (const candidate of [`${base}.py`, `${base}/__init__.py`, `${base}.pyi`]) {
        if (allPaths.has(candidate)) return candidate
      }
    }
    return null
  }
  // JS/TS: only relative imports resolve to repo files.
  if (!imp.source.startsWith('.')) return null
  const base = normalizePath(`${dirOf(importerPath)}/${imp.source}`)
  const candidates: string[] = [base]
  for (const ext of JS_EXTS) candidates.push(`${base}.${ext}`)
  for (const ext of JS_EXTS) candidates.push(`${base}/index.${ext}`)
  for (const candidate of candidates) {
    if (allPaths.has(candidate)) return candidate
  }
  return null
}

interface CallSite {
  callerSymbolId: string | null
  callerFileId: string
  name: string
}

export function buildGraph(
  repoId: string,
  files: FileRec[],
  parses: FileParse[],
): { symbols: SymbolRec[]; edges: EdgeRec[] } {
  const allPaths = new Set(files.map((f) => f.path))
  const parseByPath = new Map(parses.map((p) => [p.path, p]))
  const symbols: SymbolRec[] = []
  const edges = new Map<string, EdgeRec>()

  const addEdge = (fromId: string, toId: string, type: EdgeRec['type'], confidence: EdgeRec['confidence']) => {
    if (fromId === toId) return
    const id = edgeId(repoId, fromId, toId, type)
    if (edges.has(id)) return
    edges.set(id, { id, repoId, fromId, toId, type, confidence })
  }

  // Pass 1: symbols and contains edges, plus a name index for resolution.
  const symbolsByName = new Map<string, SymbolRec[]>()
  const symbolsByFile = new Map<string, SymbolRec[]>()
  for (const file of files) {
    const parse = parseByPath.get(file.path)
    if (!parse?.result) continue
    const list: SymbolRec[] = []
    for (const s of parse.result.symbols) {
      const rec: SymbolRec = {
        id: symbolId(repoId, file.path, s.name, s.startLine),
        repoId,
        fileId: file.id,
        kind: s.kind,
        name: s.name,
        startLine: s.startLine,
        endLine: s.endLine,
      }
      symbols.push(rec)
      list.push(rec)
      const bucket = symbolsByName.get(s.name) ?? []
      bucket.push(rec)
      symbolsByName.set(s.name, bucket)
      addEdge(file.id, rec.id, 'contains', 'extracted')
    }
    symbolsByFile.set(file.path, list)
  }

  // Pass 2: import edges (file -> file, extracted when resolved).
  for (const file of files) {
    const parse = parseByPath.get(file.path)
    if (!parse?.result) continue
    for (const imp of parse.result.imports) {
      const target = resolveImport(file.path, imp, parse.language, allPaths)
      if (target) addEdge(file.id, fileId(repoId, target), 'imports', 'extracted')
    }
  }

  // Pass 3: call edges. Caller is the tightest enclosing symbol when known.
  for (const file of files) {
    const parse = parseByPath.get(file.path)
    if (!parse?.result) continue
    const fileSymbols = symbolsByFile.get(file.path) ?? []
    const enclosing = (line: number): SymbolRec | null => {
      let best: SymbolRec | null = null
      for (const s of fileSymbols) {
        if (s.startLine <= line && line <= s.endLine) {
          if (!best || s.startLine >= best.startLine) best = s
        }
      }
      return best
    }
    const importedNameTargets = new Map<string, string>() // name -> target file path
    for (const imp of parse.result.imports) {
      const target = resolveImport(file.path, imp, parse.language, allPaths)
      if (!target) continue
      for (const name of imp.names) importedNameTargets.set(name, target)
    }
    for (const call of parse.result.calls) {
      const caller = enclosing(call.line)
      const fromId = caller ? caller.id : file.id
      // 1. Same-file symbol with that name (extracted).
      const local = fileSymbols.find((s) => s.name === call.name)
      if (local) {
        addEdge(fromId, local.id, 'calls', 'extracted')
        continue
      }
      // 2. Imported name resolved into a known file (extracted when the symbol is found there).
      const targetPath = importedNameTargets.get(call.name)
      if (targetPath) {
        const targetSymbols = symbolsByFile.get(targetPath) ?? []
        const target = targetSymbols.find((s) => s.name === call.name)
        if (target) {
          addEdge(fromId, target.id, 'calls', 'extracted')
        } else {
          addEdge(fromId, fileId(repoId, targetPath), 'calls', 'extracted')
        }
        continue
      }
      // 3. Unique repo-wide name match (inferred).
      const bucket = symbolsByName.get(call.name)
      if (bucket && bucket.length === 1) {
        addEdge(fromId, bucket[0].id, 'calls', 'inferred')
      }
    }
  }

  return { symbols, edges: [...edges.values()] }
}
