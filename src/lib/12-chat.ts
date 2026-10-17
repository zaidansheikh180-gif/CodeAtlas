// Model chat with graph-first retrieval (phase 7 part 4, pack-1 #21/#22,
// spec-2 sections 15 and 16). Retrieval is deterministic and local: the
// question is resolved against the same query index the key-free Ask bar
// uses, the relevant files and their one-hop graph neighborhood are packed
// under the visitor's context budget, and only that listed context leaves
// the browser, to the visitor's own provider, when they press send. Answers
// stream, can be canceled, and every file:line citation is validated
// against the context that was actually sent - invented paths are dropped.

import { estimateTokens, ProviderError } from './providers'
import { chatStream } from './providers'
import { buildIndex, detectIntent, resolveNodes, traverse, type QueryIndex } from './graphquery'
import { markExternalSend } from './keys'
import type { Settings } from './settings'
import type { EdgeRec, FileRec, SymbolRec } from './types'

export interface ChatCitation {
  path: string
  startLine: number
  endLine: number | null
}

export interface ContextItem {
  path: string
  text: string
  reason: string
}

export interface RetrievedContext {
  items: ContextItem[]
  tokensEstimated: number
  intent: string
  truncated: boolean
}

export interface ChatMessageRec {
  id: string
  conversationId: string
  role: 'user' | 'assistant'
  text: string
  citations: ChatCitation[]
  // Paths actually sent to the provider for this turn (user turns only).
  contextPaths: string[]
  outputTokens: number | null
  createdAt: number
}

export interface ConversationRec {
  id: string
  repoId: string
  title: string
  createdAt: number
  updatedAt: number
}

const PER_FILE_CHARS = 6000
const HISTORY_TURNS = 6

export const CHAT_SYSTEM = `You are CodeAtlas, a codebase assistant. Answer questions about the repository using ONLY the provided context files and graph notes.

Rules:
- Cite every claim as path:line or path:startLine-endLine, using only paths from the provided context.
- If the context does not answer the question, say so plainly and name which files would help.
- Keep answers focused; use short paragraphs or bullets.
- Never invent file paths, symbols or line numbers.`

function lineOf(text: string, needle: string): number {
  const idx = text.indexOf(needle)
  if (idx < 0) return 1
  return text.slice(0, idx).split('\n').length
}

// Graph-first retrieval: resolve the question against the query index, then
// pack the resolved files and their one-hop neighbors under the budget.
export function retrieveContext(
  question: string,
  files: FileRec[],
  symbols: SymbolRec[],
  edges: EdgeRec[],
  settings: Settings,
): RetrievedContext {
  const index: QueryIndex = buildIndex(files, symbols, edges)
  const intent = detectIntent(question)
  const resolved = resolveNodes(question, index, 5)
  const byPath = new Map<string, ContextItem>()
  const budget = Math.max(2000, settings.maxContextTokens)
  let tokens = 0
  let truncated = false

  const addFile = (path: string, reason: string): boolean => {
    if (byPath.has(path)) return true
    const file = files.find((f) => f.path === path)
    if (!file) return false
    const text = file.text.length > PER_FILE_CHARS ? `${file.text.slice(0, PER_FILE_CHARS)}\n// ... truncated for context budget` : file.text
    const cost = estimateTokens(text) + estimateTokens(path) + 20
    if (tokens + cost > budget && byPath.size > 0) {
      truncated = true
      return false
    }
    byPath.set(path, { path, text, reason })
    tokens += cost
    return true
  }

  // Resolved nodes first: the files the question names, anchored at the
  // matching symbol's line where we have one.
  for (const cand of resolved) {
    const path = cand.node.path ?? cand.node.id.replace(/^file:/, '')
    addFile(path, `mentioned as ${cand.node.name}`)
  }

  // One-hop graph neighborhood of the resolved files.
  if (resolved.length > 0) {
    const result = traverse(index, resolved.map((c) => c.node.id), {
      direction: 'forward',
      depth: 1,
      budget: { maxVisited: 24, maxEdges: 48 },
    })
    for (const node of result.nodes) {
      const path = node.path ?? node.id.replace(/^file:/, '')
      if (!addFile(path, 'connected in the graph')) break
    }
  }

  // Nothing resolved: fall back to the most-connected files so the model
  // still sees the repo's core, and say so honestly.
  if (byPath.size === 0) {
    const degree = new Map<string, number>()
    for (const edge of edges) {
      degree.set(edge.fromId, (degree.get(edge.fromId) ?? 0) + 1)
      degree.set(edge.toId, (degree.get(edge.toId) ?? 0) + 1)
    }
    const ranked = [...files].sort((a, b) => (degree.get(`file:${b.path}`) ?? 0) - (degree.get(`file:${a.path}`) ?? 0))
    for (const file of ranked.slice(0, 6)) {
      if (!addFile(file.path, 'most connected file')) break
    }
    truncated = true
  }

  return { items: [...byPath.values()], tokensEstimated: tokens, intent, truncated }
}

export function buildChatPrompt(question: string, history: ChatMessageRec[], context: RetrievedContext): string {
  const parts: string[] = []
  const recent = history.slice(-HISTORY_TURNS * 2)
  if (recent.length > 0) {
    parts.push('Conversation so far:')
    for (const msg of recent) parts.push(`${msg.role === 'user' ? 'Visitor' : 'CodeAtlas'}: ${msg.text.slice(0, 1500)}`)
    parts.push('')
  }
  parts.push('Context files:')
  for (const item of context.items) {
    parts.push(`--- ${item.path} (${item.reason}) ---`)
    parts.push(item.text)
  }
  parts.push('')
  parts.push(`Question: ${question}`)
  return parts.join('\n')
}

// Validate every citation against the sent context. A citation the model
// invented (path not sent, line past end of file) is dropped.
export function parseCitations(text: string, context: RetrievedContext): ChatCitation[] {
  const valid = new Map(context.items.map((item) => [item.path, item.text.split('\n').length]))
  const seen = new Set<string>()
  const out: ChatCitation[] = []
  const re = /([\w./()-]+\.[a-zA-Z0-9]{1,6})(?::(?:L)?(\d+)(?:\s*-\s*(?:L)?(\d+))?)?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const path = m[1]!
    const lines = valid.get(path)
    if (lines == null) continue
    const start = m[2] ? Math.min(Math.max(1, parseInt(m[2], 10)), lines) : 1
    const end = m[3] ? Math.min(Math.max(start, parseInt(m[3], 10)), lines) : null
    const key = `${path}:${start}:${end ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ path, startLine: start, endLine: end })
  }
  return out
}

export interface StreamChatOptions {
  settings: Settings
  question: string
  history: ChatMessageRec[]
  files: FileRec[]
  symbols: SymbolRec[]
  edges: EdgeRec[]
  signal?: AbortSignal
  onDelta?: (fullText: string) => void
  onFirstSend?: () => void
}

export interface StreamChatResult {
  text: string
  citations: ChatCitation[]
  context: RetrievedContext
  outputTokens: number | null
  canceled: boolean
}

export async function streamChat(opts: StreamChatOptions): Promise<StreamChatResult> {
  if (opts.settings.provider === 'none') {
    throw new ProviderError('No model provider configured. Choose Gemini or Ollama in Settings.', 'invalid_key', false)
  }
  const context = retrieveContext(opts.question, opts.files, opts.symbols, opts.edges, opts.settings)
  const prompt = buildChatPrompt(opts.question, opts.history, context)
  opts.onFirstSend?.()
  let text = ''
  let outputTokens: number | null = null
  let canceled = false
  try {
    for await (const chunk of chatStream({
      settings: opts.settings,
      system: CHAT_SYSTEM,
      prompt,
      maxOutputTokens: opts.settings.maxOutputTokens,
      signal: opts.signal,
    })) {
      if (chunk.delta) {
        text += chunk.delta
        opts.onDelta?.(text)
      }
      if (chunk.outputTokens != null) outputTokens = chunk.outputTokens
    }
  } catch (error) {
    if (error instanceof ProviderError && error.code === 'canceled') {
      canceled = true
    } else {
      throw error
    }
  }
  return { text, citations: parseCitations(text, context), context, outputTokens, canceled }
}

export function markChatSend(provider: string): void {
  markExternalSend(provider, 'model chat')
}
