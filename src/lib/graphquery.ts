// Key-free Graph Query Mode: deterministic answers to structural questions
// about an indexed repository. No LLM, no network - rule-based intent
// detection, node resolution and graph traversal over the IndexedDB graph.
// Every answer carries file:line citations.

import type { EdgeRec, FileRec, SymbolRec } from './types'
import { TRAVERSAL_BUDGET } from './perf'

export type GNodeType = 'file' | 'function' | 'class' | 'method' | 'module' | 'symbol'

export interface GNode {
  id: string
  type: GNodeType
  name: string
  path: string
  startLine?: number
  endLine?: number
  language?: string
}

export type Relation =
  | 'imports'
  | 'imports_from'
  | 'calls'
  | 'calls_from'
  | 'defines'
  | 'extends'
  | 'implements'
  | 'uses'
  | 'contains'

export interface GEdge {
  source: string
  target: string
  relation: Relation
  context?: string
}

export interface Citation {
  path: string
  startLine: number
  endLine: number
  nodeId: string
}

export interface TraversalResult {
  startNodes: GNode[]
  nodes: GNode[]
  edges: GEdge[]
  citations: Citation[]
  truncated: boolean // expansion stopped at the traversal budget
}

export type QueryIntent =
  | 'imports'
  | 'dependents'
  | 'callers'
  | 'callees'
  | 'affected'
  | 'path'
  | 'explain'
  | 'files'
  | 'unknown'

export interface QueryAnswer {
  intent: QueryIntent
  summary: string
  result: TraversalResult
  highlightPaths: string[]
  needsModel?: boolean
}

// --- Index -------------------------------------------------------------

interface AdjEntry {
  id: string
  relation: Relation
}

export interface QueryIndex {
  nodes: Map<string, GNode>
  out: Map<string, AdjEntry[]>
  inn: Map<string, AdjEntry[]>
  filesByPath: Map<string, string>
}

// Maps a user-facing relation filter to the stored base relation and the
// direction it must be traversed. Reverse aliases (imports_from, calls_from)
// are the same stored edge walked backwards.
const BASE_RELATION: Record<string, { base: Relation; reverse: boolean }> = {
  imports: { base: 'imports', reverse: false },
  imports_from: { base: 'imports', reverse: true },
  calls: { base: 'calls', reverse: false },
  calls_from: { base: 'calls', reverse: true },
  defines: { base: 'defines', reverse: false },
  contains: { base: 'contains', reverse: false },
}

function citationOf(node: GNode): Citation {
  const start = node.startLine ?? 1
  return { path: node.path, startLine: start, endLine: node.endLine ?? start, nodeId: node.id }
}

export function buildIndex(files: FileRec[], symbols: SymbolRec[], edges: EdgeRec[]): QueryIndex {
  const nodes = new Map<string, GNode>()
  const filesByPath = new Map<string, string>()
  const filePathById = new Map<string, string>()
  for (const file of files) {
    filePathById.set(file.id, file.path)
    filesByPath.set(file.path, file.id)
    nodes.set(file.id, {
      id: file.id,
      type: 'file',
      name: file.path.split('/').pop() ?? file.path,
      path: file.path,
      language: file.language,
    })
  }
  for (const symbol of symbols) {
    nodes.set(symbol.id, {
      id: symbol.id,
      type: symbol.kind,
      name: symbol.name,
      path: filePathById.get(symbol.fileId) ?? '',
      startLine: symbol.startLine,
      endLine: symbol.endLine,
    })
  }
  const out = new Map<string, AdjEntry[]>()
  const inn = new Map<string, AdjEntry[]>()
  const push = (map: Map<string, AdjEntry[]>, key: string, entry: AdjEntry) => {
    const list = map.get(key)
    if (list) list.push(entry)
    else map.set(key, [entry])
  }
  const seen = new Set<string>()
  for (const edge of edges) {
    const relation: Relation = edge.type === 'contains' ? 'defines' : edge.type
    const key = `${edge.fromId}|${edge.toId}|${relation}`
    if (seen.has(key)) continue // deduplicate
    seen.add(key)
    if (!nodes.has(edge.fromId) || !nodes.has(edge.toId)) continue
    push(out, edge.fromId, { id: edge.toId, relation })
    push(inn, edge.toId, { id: edge.fromId, relation })
  }
  return { nodes, out, inn, filesByPath }
}

// --- Node resolution ----------------------------------------------------

export interface ResolvedCandidate {
  node: GNode
  score: number
  why: string
}

function subsequence(needle: string, haystack: string): boolean {
  let i = 0
  for (const ch of haystack) {
    if (ch === needle[i]) i++
    if (i === needle.length) return true
  }
  return needle.length > 0 && i === needle.length
}

// Ranks candidates: exact name or path > case-insensitive exact > partial
// path > prefix > substring > fuzzy subsequence. Returns every candidate
// that scores, best first, so ambiguous names return several matches.
export function resolveNodes(text: string, index: QueryIndex, limit = 5): ResolvedCandidate[] {
  const query = text.trim()
  if (!query) return []
  const lower = query.toLowerCase()
  const scored: ResolvedCandidate[] = []
  for (const node of index.nodes.values()) {
    let score = 0
    let why = ''
    const name = node.name
    const path = node.path
    // Path matching is for files only. A symbol's path is its file's path, so
    // letting symbols score on path makes every symbol in a queried file an
    // "exact path" match and floods the resolver with false ambiguity.
    if (node.type === 'file') {
      if (path === query) { score = 100; why = 'exact path' }
      else if (path.toLowerCase() === lower) { score = 92; why = 'path (case-insensitive)' }
      else if (path.endsWith(query) || path.endsWith('/' + query)) { score = 74; why = 'partial path' }
      else if (path.toLowerCase().endsWith(lower)) { score = 70; why = 'partial path (case-insensitive)' }
      else if (path.toLowerCase().includes(lower)) { score = 48; why = 'path contains' }
    }
    if (name === query && score < 96) { score = 96; why = 'exact name' }
    else if (name.toLowerCase() === lower && score < 88) { score = 88; why = 'name (case-insensitive)' }
    else if (name.toLowerCase().startsWith(lower) && score < 60) { score = 60; why = 'name prefix' }
    else if (name.toLowerCase().includes(lower) && score < 44) { score = 44; why = 'name contains' }
    else if (subsequence(lower, name.toLowerCase()) && score < 28) { score = 28; why = 'fuzzy name' }
    if (score > 0) {
      // Files outrank symbols on ties of name: a file named X usually is the target.
      scored.push({ node, score: score + (node.type === 'file' ? 2 : 0), why })
    }
  }
  scored.sort((a, b) => b.score - a.score || a.node.path.localeCompare(b.node.path))
  return scored.slice(0, limit)
}

// --- Intent detection -----------------------------------------------------

const QUESTION_WORDS = /^(what|who|whom|which|where|how|why|show|list|tell|give|does|do|is|are|the|a|an|me|about|of|in|this|that|please|can|you|if|i|change|changing|modified|modify)\b/i

// Pulls the likely node names out of a question: quoted strings, path-like
// tokens (with / or .), and CamelCase or snake_case identifiers.
export function extractTargets(text: string): string[] {
  const quoted = [...text.matchAll(/["'`]([^"'`]+)["'`]/g)].map((m) => m[1])
  if (quoted.length > 0) return quoted
  const tokens = text
    .replace(/[?!,;:()]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0)
  const targets = tokens.filter((t) => {
    if (QUESTION_WORDS.test(t)) return false
    if (/^(import|imports|importing|imported|call|calls|calling|called|caller|callers|callee|callees|depend|depends|dependent|dependents|dependency|dependencies|affect|affects|affected|impact|break|breaks|path|shortest|explain|structure|files|file|folder|folders|project|repo|repository|use|uses|used|by|to|from|from|on|into|onto|and|or|when|after|before|between|with|without|module|modules|function|class|method|symbol|node|nodes|graph|code|map|anything|something|everything|nothing|else|other|others|main|src)$/i.test(t)) return false
    // Paths, snake_case and camelCase read as identifiers outright; plain
    // lowercase words (deprecate, merge) still count when they are long
    // enough to be a name rather than question filler - unresolvable ones
    // surface honestly as "no graph node matches".
    return /[./\\_]|[A-Z]/.test(t) || /^[a-z][a-z0-9-]{3,}$/.test(t)
  })
  return targets.map((t) => t.replace(/^[./\\]+/, ''))
}

export function detectIntent(text: string): QueryIntent {
  const q = text.toLowerCase()
  if (/shortest\s+path|path\s+from|path\s+between|how\s+does\s+.+\s+reach/.test(q)) return 'path'
  if (/file\s+structure|project\s+structure|show\s+(the\s+)?files|list\s+(the\s+)?files|folder\s+structure|directory\s+structure/.test(q)) return 'files'
  if (/affected|impact|what\s+breaks|ripple|who\s+breaks/.test(q)) return 'affected'
  if (/who\s+calls|callers?\s+of|called\s+by|what\s+calls/.test(q)) return 'callers'
  if (/what\s+does\s+.+\s+call|callees?\s+of|calls\s+does/.test(q)) return 'callees'
  if (/who\s+imports|who\s+depends|dependents?\s+of|imported\s+by|what\s+depends\s+on|dependencies\s+of/.test(q)) return 'dependents'
  if (/what\s+does\s+.+\s+import|imports?\s+of|what\s+imports\s+does/.test(q)) return 'imports'
  if (/^explain|what\s+is|tell\s+me\s+about|describe|what\s+are/.test(q)) return 'explain'
  return 'unknown'
}

// --- Traversal -------------------------------------------------------------

export interface TraverseOptions {
  direction: 'forward' | 'reverse'
  depth?: number
  relations?: Relation[]
  // Node/edge budget: expansion stops when either is exceeded and the
  // result is flagged truncated (phase 9 part 2).
  budget?: { maxVisited?: number; maxEdges?: number }
}

function passesFilter(relation: Relation, direction: 'forward' | 'reverse', filter?: Relation[]): boolean {
  if (!filter || filter.length === 0) return true
  for (const wanted of filter) {
    const rule = BASE_RELATION[wanted]
    if (!rule) continue // extends/implements/uses: not extracted yet - match nothing
    if (rule.base === relation && (direction === 'forward') !== rule.reverse) return true
  }
  return false
}

// Breadth-first traversal with a visited set, so cycles terminate. Returns
// nodes grouped implicitly by insertion order (start nodes first, then by
// depth) plus every edge crossed, and citations for all returned nodes.
export function traverse(index: QueryIndex, startIds: string[], options: TraverseOptions): TraversalResult {
  const depthLimit = options.depth ?? 2
  const maxVisited = options.budget?.maxVisited ?? TRAVERSAL_BUDGET.maxVisited
  const maxEdges = options.budget?.maxEdges ?? TRAVERSAL_BUDGET.maxEdges
  const adjacency = options.direction === 'forward' ? index.out : index.inn
  const visited = new Set<string>(startIds)
  const nodes: GNode[] = []
  const edges: GEdge[] = []
  let truncated = false
  let frontier = [...startIds]
  for (let depth = 0; depth < depthLimit && frontier.length > 0 && !truncated; depth++) {
    const next: string[] = []
    for (const id of frontier) {
      if (truncated) break
      for (const entry of adjacency.get(id) ?? []) {
        if (!passesFilter(entry.relation, options.direction, options.relations)) continue
        if (edges.length >= maxEdges || visited.size >= maxVisited) {
          truncated = true
          break
        }
        const from = options.direction === 'forward' ? id : entry.id
        const to = options.direction === 'forward' ? entry.id : id
        edges.push({ source: from, target: to, relation: entry.relation })
        if (visited.has(entry.id)) continue
        visited.add(entry.id)
        const node = index.nodes.get(entry.id)
        if (node) nodes.push(node)
        next.push(entry.id)
      }
    }
    frontier = next
  }
  const startNodes = startIds.map((id) => index.nodes.get(id)).filter((n): n is GNode => !!n)
  const all = [...startNodes, ...nodes]
  return { startNodes, nodes, edges, citations: all.map(citationOf), truncated }
}

// Direct dependents are depth 1; transitive are deeper. Used for impact.
export function impact(index: QueryIndex, startIds: string[], depthLimit = 3): {
  direct: GNode[]
  transitive: GNode[]
  result: TraversalResult
} {
  const visited = new Set<string>(startIds)
  const direct: GNode[] = []
  const transitive: GNode[] = []
  const edges: GEdge[] = []
  let truncated = false
  let frontier = [...startIds]
  for (let depth = 1; depth <= depthLimit && frontier.length > 0 && !truncated; depth++) {
    const next: string[] = []
    for (const id of frontier) {
      if (truncated) break
      for (const entry of index.inn.get(id) ?? []) {
        if (edges.length >= TRAVERSAL_BUDGET.maxEdges || visited.size >= TRAVERSAL_BUDGET.maxVisited) {
          truncated = true
          break
        }
        edges.push({ source: entry.id, target: id, relation: entry.relation })
        if (visited.has(entry.id)) continue
        visited.add(entry.id)
        const node = index.nodes.get(entry.id)
        if (!node) continue
        ;(depth === 1 ? direct : transitive).push(node)
        next.push(entry.id)
      }
    }
    frontier = next
  }
  const startNodes = startIds.map((id) => index.nodes.get(id)).filter((n): n is GNode => !!n)
  const nodes = [...direct, ...transitive]
  return {
    direct,
    transitive,
    result: { startNodes, nodes, edges, citations: [...startNodes, ...nodes].map(citationOf), truncated },
  }
}

// Undirected shortest path (BFS over both directions). Returns the chain of
// nodes and the edges between them, or null when no path exists.
export function shortestPath(index: QueryIndex, fromId: string, toId: string): TraversalResult | null {
  if (fromId === toId) {
    const node = index.nodes.get(fromId)
    if (!node) return null
    return { startNodes: [node], nodes: [], edges: [], citations: [citationOf(node)], truncated: false }
  }
  const parent = new Map<string, { via: string; relation: Relation }>()
  const visited = new Set<string>([fromId])
  let frontier = [fromId]
  while (frontier.length > 0) {
    const next: string[] = []
    for (const id of frontier) {
      const neighbors: AdjEntry[] = [
        ...(index.out.get(id) ?? []),
        ...(index.inn.get(id) ?? []).map((e) => ({ id: e.id, relation: e.relation })),
      ]
      for (const entry of neighbors) {
        if (visited.has(entry.id)) continue
        visited.add(entry.id)
        parent.set(entry.id, { via: id, relation: entry.relation })
        if (entry.id === toId) {
          const chain: GNode[] = []
          const chainEdges: GEdge[] = []
          let cursor: string | undefined = toId
          while (cursor) {
            const node = index.nodes.get(cursor)
            if (node) chain.unshift(node)
            const step: { via: string; relation: Relation } | undefined = parent.get(cursor)
            if (!step) break
            chainEdges.unshift({ source: step.via, target: cursor, relation: step.relation })
            cursor = step.via
          }
          const startNode = index.nodes.get(fromId)
          return {
            startNodes: startNode ? [startNode] : [],
            nodes: chain.slice(1),
            edges: chainEdges,
            citations: chain.map(citationOf),
            truncated: false,
          }
        }
        next.push(entry.id)
      }
    }
    frontier = next
  }
  return null
}

// --- Answers ---------------------------------------------------------------

function fmtNode(node: GNode): string {
  return node.type === 'file' ? node.path : `${node.name} (${node.path}:${node.startLine ?? 1})`
}

const MODEL_NOTE = 'That question needs semantic understanding, which needs a model key. Graph Query answers structural questions (imports, callers, impact, paths) without one.'

export function answerQuestion(text: string, index: QueryIndex, options?: { depth?: number }): QueryAnswer {
  const intent = detectIntent(text)
  const depth = options?.depth ?? 2
  const empty: TraversalResult = { startNodes: [], nodes: [], edges: [], citations: [], truncated: false }

  if (intent === 'unknown') {
    return { intent, summary: MODEL_NOTE, result: empty, highlightPaths: [], needsModel: true }
  }

  if (intent === 'files') {
    const top = new Map<string, number>()
    for (const node of index.nodes.values()) {
      if (node.type !== 'file') continue
      const seg = node.path.includes('/') ? node.path.split('/')[0] : '(root)'
      top.set(seg, (top.get(seg) ?? 0) + 1)
    }
    const listing = [...top.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}/ (${n} files)`).join(', ')
    const fileNodes = [...index.nodes.values()].filter((n) => n.type === 'file')
    return {
      intent,
      summary: `Project structure: ${listing}.`,
      result: { startNodes: [], nodes: fileNodes, edges: [], citations: fileNodes.map(citationOf), truncated: false },
      highlightPaths: fileNodes.map((n) => n.path),
    }
  }

  const targets = extractTargets(text)
  if (targets.length === 0) {
    return { intent, summary: `I could not find a file or symbol name in that question. ${MODEL_NOTE}`, result: empty, highlightPaths: [], needsModel: true }
  }

  const resolved = targets.map((t) => ({ target: t, candidates: resolveNodes(t, index) }))
  const missing = resolved.filter((r) => r.candidates.length === 0)
  if (missing.length > 0) {
    return {
      intent,
      summary: `No graph node matches "${missing[0].target}". Check the spelling, or try the full file path.`,
      result: empty,
      highlightPaths: [],
    }
  }
  const ambiguous = resolved.filter((r) => r.candidates.length > 1 && r.candidates[0].score - (r.candidates[1]?.score ?? 0) < 8)
  const chosen = resolved.map((r) => r.candidates[0].node)
  const ambiguityNote = ambiguous.length > 0
    ? ` "${ambiguous[0].target}" is ambiguous - using ${fmtNode(ambiguous[0].candidates[0].node)}; also matches: ${ambiguous[0].candidates.slice(1, 4).map((c) => fmtNode(c.node)).join(', ')}.`
    : ''

  if (intent === 'path') {
    if (chosen.length < 2) {
      return { intent, summary: 'A path question needs two ends, for example: "shortest path from main.tsx to InfoCards.tsx".', result: empty, highlightPaths: [] }
    }
    const path = shortestPath(index, chosen[0].id, chosen[1].id)
    if (!path) {
      return { intent, summary: `No graph path connects ${fmtNode(chosen[0])} and ${fmtNode(chosen[1])}.`, result: empty, highlightPaths: [] }
    }
    const chain = [...path.startNodes, ...path.nodes]
    return {
      intent,
      summary: `Shortest path (${chain.length - 1} hop${chain.length === 2 ? '' : 's'}): ${chain.map((n) => n.name).join(' → ')}.${ambiguityNote}`,
      result: path,
      highlightPaths: chain.map((n) => n.path),
    }
  }

  if (intent === 'explain') {
    const node = chosen[0]
    const outEdges = index.out.get(node.id) ?? []
    const inEdges = index.inn.get(node.id) ?? []
    const count = (list: { relation: Relation }[], rel: Relation) => list.filter((e) => e.relation === rel).length
    const parts: string[] = []
    if (node.type === 'file') {
      parts.push(`${node.path} is a ${node.language ?? 'source'} file`)
      parts.push(`it imports ${count(outEdges, 'imports')} file(s), is imported by ${count(inEdges, 'imports')}, defines ${count(outEdges, 'defines')} symbol(s)`)
    } else {
      parts.push(`${node.name} is a ${node.type} in ${node.path} (lines ${node.startLine ?? '?'}-${node.endLine ?? '?'})`)
      parts.push(`it calls ${count(outEdges, 'calls')} symbol(s) and is called by ${count(inEdges, 'calls')}`)
    }
    const result = traverse(index, [node.id], { direction: 'forward', depth: 1 })
    const reverse = traverse(index, [node.id], { direction: 'reverse', depth: 1 })
    const all = { ...result, nodes: [...result.nodes, ...reverse.nodes], edges: [...result.edges, ...reverse.edges] }
    all.citations = [...all.startNodes, ...all.nodes].map(citationOf)
    return {
      intent,
      summary: `${parts.join('; ')}.${ambiguityNote}`,
      result: all,
      highlightPaths: [node.path],
    }
  }

  if (intent === 'affected') {
    const { direct, transitive, result } = impact(index, chosen.map((n) => n.id), Math.max(depth, 3))
    return {
      intent,
      summary: `Changing ${chosen.map(fmtNode).join(', ')} directly affects ${direct.length} node(s) and transitively ${transitive.length} more (depth ${Math.max(depth, 3)}).${ambiguityNote}`,
      result,
      highlightPaths: result.nodes.map((n) => n.path),
    }
  }

  const direction: 'forward' | 'reverse' =
    intent === 'dependents' || intent === 'callers' ? 'reverse' : 'forward'
  const relationFilter: Relation[] | undefined =
    intent === 'imports' ? ['imports']
    : intent === 'dependents' ? ['imports_from']
    : intent === 'callers' ? ['calls_from']
    : intent === 'callees' ? ['calls']
    : undefined
  // Direct neighbours are the natural answer to 'what does X import / who calls X';
  // deeper chains are what the impact intent is for.
  const result = traverse(index, chosen.map((n) => n.id), { direction, depth: 1, relations: relationFilter })
  const label: Record<string, string> = {
    imports: 'imports',
    dependents: 'is imported by',
    callers: 'is called by',
    callees: 'calls',
  }
  return {
    intent,
    summary: `${chosen.map(fmtNode).join(', ')} ${label[intent] ?? intent} ${result.nodes.length} node(s) directly.${ambiguityNote}`,
    result,
    highlightPaths: result.nodes.map((n) => n.path),
  }
}
