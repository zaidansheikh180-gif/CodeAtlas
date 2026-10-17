// Model chat panel (phase 7 part 4, pack-1 #21/#22, spec-2 sections 15-16):
// chat with the repository through the visitor's own provider (Gemini key or
// Ollama endpoint). Retrieval is graph-first and deterministic; the exact
// context files and token estimate are shown before each send, answers
// stream with cancel, and file:line citations are validated against the sent
// context and open the file viewer at the line. Conversations persist in
// IndexedDB (conversations/messages stores) and are deletable.

import { useEffect, useMemo, useRef, useState } from 'react'
import { deleteConversation, listChatMessages, listConversations, putChatMessage, putConversation } from '../lib/db'
import {
  markChatSend,
  retrieveContext,
  streamChat,
  type ChatMessageRec,
  type ConversationRec,
} from '../lib/chat'
import { hasKey } from '../lib/keys'
import { estimateTokens } from '../lib/providers'
import { loadSettings, type Settings } from '../lib/settings'
import type { EdgeRec, FileRec, SymbolRec } from '../lib/types'

interface Props {
  repoId: string
  repoName: string
  files: FileRec[]
  symbols: SymbolRec[]
  edges: EdgeRec[]
  initialQuestion?: string
  onOpenCitation: (path: string, line?: number) => void
  onClose: () => void
}

const now = () => Date.now()
const uid = (prefix: string) => `${prefix}-${now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

export default function ChatPanel({ repoId, repoName, files, symbols, edges, initialQuestion, onOpenCitation, onClose }: Props) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [conversations, setConversations] = useState<ConversationRec[]>([])
  const [active, setActive] = useState<ConversationRec | null>(null)
  const [messages, setMessages] = useState<ChatMessageRec[]>([])
  const [draft, setDraft] = useState(initialQuestion ?? '')
  const [streaming, setStreaming] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      const [s, convs] = await Promise.all([loadSettings(), listConversations(repoId)])
      if (!alive) return
      setSettings(s)
      const sorted = convs.sort((a, b) => b.updatedAt - a.updatedAt)
      setConversations(sorted)
      if (sorted[0]) {
        setActive(sorted[0])
        setMessages((await listChatMessages(sorted[0].id)).sort((a, b) => a.createdAt - b.createdAt))
      }
    })()
    return () => {
      alive = false
    }
  }, [repoId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, streaming])

  const providerReady = settings && (settings.provider === 'ollama' || (settings.provider === 'gemini' && hasKey('gemini')))
  const busy = streaming !== null

  // Live pre-send preview: exactly which files and how many estimated tokens
  // the next message would send.
  const preview = useMemo(() => {
    if (!settings || !draft.trim()) return null
    const ctx = retrieveContext(draft, files, symbols, edges, settings)
    const historyTokens = estimateTokens(messages.slice(-12).map((m) => m.text).join('\n'))
    return { files: ctx.items.length, tokens: ctx.tokensEstimated + historyTokens }
  }, [draft, files, symbols, edges, settings, messages])

  async function openConversation(conv: ConversationRec) {
    if (busy) return
    setActive(conv)
    setMessages((await listChatMessages(conv.id)).sort((a, b) => a.createdAt - b.createdAt))
    setError(null)
  }

  async function removeConversation(conv: ConversationRec) {
    if (busy) return
    await deleteConversation(conv.id)
    const next = conversations.filter((c) => c.id !== conv.id)
    setConversations(next)
    if (active?.id === conv.id) {
      setActive(null)
      setMessages([])
    }
  }

  async function send(e?: React.FormEvent) {
    e?.preventDefault()
    if (!settings || !providerReady || busy) return
    const question = draft.trim()
    if (!question) return
    setError(null)
    let conv = active
    if (!conv) {
      conv = { id: uid('conv'), repoId, title: question.slice(0, 60), createdAt: now(), updatedAt: now() }
      await putConversation(conv)
      setConversations((prev) => [conv!, ...prev])
      setActive(conv)
    }
    const userMsg: ChatMessageRec = {
      id: uid('msg'),
      conversationId: conv.id,
      role: 'user',
      text: question,
      citations: [],
      contextPaths: [],
      outputTokens: null,
      createdAt: now(),
    }
    setMessages((prev) => [...prev, userMsg])
    setDraft('')
    const controller = new AbortController()
    abortRef.current = controller
    setStreaming('')
    try {
      const result = await streamChat({
        settings,
        question,
        history: messages,
        files,
        symbols,
        edges,
        signal: controller.signal,
        onDelta: (full) => setStreaming(full),
        onFirstSend: () => markChatSend(settings.provider),
      })
      const sentUser: ChatMessageRec = { ...userMsg, contextPaths: result.context.items.map((i) => i.path) }
      await putChatMessage(sentUser)
      const assistantMsg: ChatMessageRec = {
        id: uid('msg'),
        conversationId: conv.id,
        role: 'assistant',
        text: result.text || (result.canceled ? '(canceled before the first token)' : ''),
        citations: result.citations,
        contextPaths: [],
        outputTokens: result.outputTokens,
        createdAt: now(),
      }
      await putChatMessage(assistantMsg)
      const updated = { ...conv, updatedAt: now() }
      await putConversation(updated)
      setConversations((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
      setMessages((prev) => [...prev.slice(0, -1), sentUser, assistantMsg])
      setStreaming(null)
    } catch (err) {
      await putChatMessage(userMsg)
      setError(err instanceof Error ? err.message : 'The request failed.')
      setStreaming(null)
    } finally {
      abortRef.current = null
    }
  }

  if (!settings) return null
  const destination = settings.provider === 'gemini' ? 'Google Gemini' : settings.provider === 'ollama' ? 'your Ollama endpoint' : 'no provider'

  return (
    <div className="absolute right-0 top-0 z-30 flex h-full w-full max-w-md flex-col border-l border-line bg-night" role="dialog" aria-label="Model chat">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">Chat</h2>
          <p className="text-xs text-ink-3">Ask {repoName} with your own model. Context leaves this browser only when you send.</p>
        </div>
        <button onClick={onClose} className="rounded-lg border border-line px-2.5 py-1 text-xs text-ink-2 hover:border-dragon hover:text-ink">
          Close
        </button>
      </div>

      {!providerReady ? (
        <div className="p-4 text-xs text-ink-2">
          {settings.provider === 'none'
            ? 'No model provider configured. Open Settings and choose Gemini (your API key) or Ollama (your endpoint). The key-free Ask bar works without any of this.'
            : 'No Gemini key saved. Add your own key in Settings - it stays in this browser.'}
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 border-b border-line px-3 py-2">
            <select
              aria-label="Conversation"
              className="min-w-0 flex-1 rounded border border-line bg-surface-2 px-2 py-1 text-xs text-ink"
              value={active?.id ?? ''}
              onChange={(e) => {
                const conv = conversations.find((c) => c.id === e.target.value)
                if (conv) void openConversation(conv)
              }}
              disabled={busy}
            >
              {conversations.length === 0 && <option value="">No conversations yet</option>}
              {active === null && conversations.length > 0 && <option value="">Pick a conversation</option>}
              {conversations.map((c) => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </select>
            <button
              onClick={() => { setActive(null); setMessages([]); setError(null) }}
              disabled={busy}
              className="rounded-lg border border-line px-2 py-1 text-xs text-ink-2 hover:border-dragon hover:text-ink disabled:opacity-50"
            >
              New
            </button>
            {active && (
              <button
                onClick={() => void removeConversation(active)}
                disabled={busy}
                className="rounded-lg border border-error/40 px-2 py-1 text-xs text-error hover:bg-error hover:text-night disabled:opacity-50"
              >
                Delete
              </button>
            )}
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-3" aria-live="polite">
            {messages.length === 0 && streaming === null && (
              <p className="text-xs text-ink-3">
                Ask anything about this repository. Retrieval runs on the local index first; only the listed context files go to {destination} with your question.
              </p>
            )}
            {messages.map((msg) => (
              <div key={msg.id} className={`rounded-lg border p-2.5 text-xs ${msg.role === 'user' ? 'border-line bg-surface-1' : 'border-dragon/30 bg-surface-2'}`}>
                <p className="whitespace-pre-wrap text-ink">{msg.text}</p>
                {msg.role === 'user' && msg.contextPaths.length > 0 && (
                  <p className="mt-1.5 text-ink-3">
                    Sent as context: {msg.contextPaths.slice(0, 6).join(', ')}
                    {msg.contextPaths.length > 6 ? ` and ${msg.contextPaths.length - 6} more` : ''}
                  </p>
                )}
                {msg.role === 'assistant' && msg.citations.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {msg.citations.map((cit) => (
                      <button
                        key={`${cit.path}:${cit.startLine}`}
                        onClick={() => onOpenCitation(cit.path, cit.startLine)}
                        className="rounded border border-dragon/40 px-1.5 py-0.5 font-mono text-[10px] text-dragon hover:bg-dragon hover:text-night"
                      >
                        {cit.path}:{cit.startLine}{cit.endLine && cit.endLine !== cit.startLine ? `-${cit.endLine}` : ''}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {streaming !== null && (
              <div className="rounded-lg border border-dragon/30 bg-surface-2 p-2.5 text-xs">
                <p className="whitespace-pre-wrap text-ink">{streaming || 'Thinking…'}</p>
                <span className="mt-1 inline-block h-2 w-2 animate-pulse rounded-full bg-dragon" aria-label="Streaming" />
              </div>
            )}
            {error && (
              <div role="alert" className="rounded-lg border border-error/40 bg-surface-1 p-2.5 text-xs text-error">
                {error}
                <button onClick={() => void send()} className="ml-2 underline">Retry</button>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <form onSubmit={(e) => void send(e)} className="border-t border-line p-3">
            {preview && (
              <p className="mb-1.5 text-[11px] text-ink-3">
                Will send about {preview.tokens.toLocaleString()} tokens from {preview.files} context file{preview.files === 1 ? '' : 's'} to {destination}.
              </p>
            )}
            <div className="flex gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void send()
                  }
                }}
                rows={2}
                aria-label="Message"
                placeholder="Ask a question about this repository…"
                className="min-w-0 flex-1 resize-none rounded-lg border border-line bg-surface-1 px-2.5 py-1.5 text-xs text-ink placeholder:text-ink-3 focus:border-dragon focus:outline-none"
                disabled={busy}
              />
              {busy ? (
                <button
                  type="button"
                  onClick={() => abortRef.current?.abort()}
                  className="self-end rounded-lg border border-error/50 px-3 py-1.5 text-xs text-error hover:bg-error hover:text-night"
                >
                  Cancel
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!draft.trim()}
                  className="self-end rounded-lg bg-dragon px-3 py-1.5 text-xs font-semibold text-night hover:bg-dragon-deep disabled:opacity-50"
                >
                  Send
                </button>
              )}
            </div>
          </form>
        </>
      )}
    </div>
  )
}
