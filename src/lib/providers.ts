// Model provider calls (phase 7 part 3, spec-2 section 14). v1 supports the
// two providers the owner approved: Gemini (visitor's own API key) and Ollama
// (visitor's own endpoint). Calls go directly from the browser to the
// provider; there is no CodeAtlas server in the path. Keys come from keys.ts
// and are never logged or included in thrown errors.

import { getKey } from './keys'
import type { Settings } from './settings'

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code: 'invalid_key' | 'rate_limited' | 'network' | 'provider' | 'canceled',
    readonly retryable: boolean,
  ) {
    super(message)
  }
}

export interface ChatRequest {
  settings: Settings
  system: string
  prompt: string
  maxOutputTokens: number
  signal?: AbortSignal
}

export interface ChatResponse {
  text: string
  // Best-effort token accounting; providers report usage differently and
  // sometimes not at all, so this can be null.
  outputTokens: number | null
}

// Rough token estimate (about 4 characters per token for code). Used for
// budget display before anything is sent.
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

async function callGemini(req: ChatRequest): Promise<ChatResponse> {
  const key = getKey('gemini')
  if (!key) {
    throw new ProviderError('No Gemini key saved. Add your own key in Settings - it stays in this browser.', 'invalid_key', false)
  }
  const model = req.settings.model || 'gemini-2.5-flash'
  let res: Response
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
        generationConfig: { maxOutputTokens: req.maxOutputTokens, temperature: 0.2 },
      }),
      signal: req.signal ?? null,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new ProviderError('Canceled.', 'canceled', false)
    throw new ProviderError('Could not reach Gemini. Check your connection.', 'network', true)
  }
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    throw new ProviderError(`Gemini rejected the request (HTTP ${res.status}). Check your API key in Settings.`, 'invalid_key', false)
  }
  if (res.status === 429) {
    throw new ProviderError('Gemini rate limit reached. Wait a moment and retry.', 'rate_limited', true)
  }
  if (!res.ok) {
    throw new ProviderError(`Gemini returned an error (HTTP ${res.status}). Retry in a moment.`, 'provider', true)
  }
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
    usageMetadata?: { candidatesTokenCount?: number }
  }
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
  if (!text.trim()) throw new ProviderError('Gemini returned an empty response. Retry in a moment.', 'provider', true)
  return { text, outputTokens: data.usageMetadata?.candidatesTokenCount ?? null }
}

async function callOllama(req: ChatRequest): Promise<ChatResponse> {
  const endpoint = (req.settings.ollamaEndpoint || 'http://localhost:11434').replace(/\/$/, '')
  let res: Response
  try {
    res = await fetch(`${endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: req.settings.model,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.prompt },
        ],
        stream: false,
        options: { num_predict: req.maxOutputTokens, temperature: 0.2 },
      }),
      signal: req.signal ?? null,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new ProviderError('Canceled.', 'canceled', false)
    throw new ProviderError(
      `Could not reach the Ollama endpoint (${endpoint}). Check that it is running and that OLLAMA_ORIGINS allows this page.`,
      'network',
      true,
    )
  }
  if (res.status === 404) {
    throw new ProviderError(`Ollama does not have the model "${req.settings.model}". Pull it first (ollama pull ${req.settings.model}).`, 'provider', false)
  }
  if (!res.ok) {
    throw new ProviderError(`Ollama returned an error (HTTP ${res.status}). Retry in a moment.`, 'provider', true)
  }
  const data = (await res.json()) as { message?: { content?: string }; eval_count?: number }
  const text = data.message?.content ?? ''
  if (!text.trim()) throw new ProviderError('Ollama returned an empty response. Retry in a moment.', 'provider', true)
  return { text, outputTokens: data.eval_count ?? null }
}

export async function chatOnce(req: ChatRequest): Promise<ChatResponse> {
  if (req.settings.provider === 'gemini') return callGemini(req)
  if (req.settings.provider === 'ollama') return callOllama(req)
  throw new ProviderError('No model provider configured. Choose Gemini or Ollama in Settings.', 'invalid_key', false)
}

// --- Streaming (phase 7 part 4, spec-2 section 15) ----------------------

export interface StreamChunk {
  delta: string
  done: boolean
  outputTokens: number | null
}

async function* sseLines(body: ReadableStream<Uint8Array>, separator: 'sse' | 'ndjson'): AsyncGenerator<unknown> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      // SSE events split on blank lines; NDJSON splits on newlines.
      for (;;) {
        if (separator === 'sse') {
          const m = buffer.match(/\r?\n\r?\n/)
          if (!m || m.index == null) break
          const raw = buffer.slice(0, m.index)
          buffer = buffer.slice(m.index + m[0].length)
          for (const line of raw.split(/\r?\n/)) {
            if (!line.startsWith('data:')) continue
            const payload = line.slice(5).trim()
            if (!payload || payload === '[DONE]') continue
            try { yield JSON.parse(payload) } catch { /* skip malformed event */ }
          }
        } else {
          const idx = buffer.indexOf('\n')
          if (idx < 0) break
          const line = buffer.slice(0, idx).trim()
          buffer = buffer.slice(idx + 1)
          if (!line) continue
          try { yield JSON.parse(line) } catch { /* skip malformed line */ }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

// Stream a chat completion as text deltas. Same providers and key handling
// as chatOnce; cancel through the passed AbortSignal.
export async function* chatStream(req: ChatRequest): AsyncGenerator<StreamChunk> {
  if (req.settings.provider === 'gemini') {
    const key = getKey('gemini')
    if (!key) throw new ProviderError('No Gemini key saved. Add your own key in Settings - it stays in this browser.', 'invalid_key', false)
    const model = req.settings.model || 'gemini-2.5-flash'
    let res: Response
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: req.system }] },
          contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
          generationConfig: { maxOutputTokens: req.maxOutputTokens, temperature: 0.2 },
        }),
        signal: req.signal ?? null,
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw new ProviderError('Canceled.', 'canceled', false)
      throw new ProviderError('Could not reach Gemini. Check your connection.', 'network', true)
    }
    if (res.status === 400 || res.status === 401 || res.status === 403) throw new ProviderError(`Gemini rejected the request (HTTP ${res.status}). Check your API key in Settings.`, 'invalid_key', false)
    if (res.status === 429) throw new ProviderError('Gemini rate limit reached. Wait a moment and retry.', 'rate_limited', true)
    if (!res.ok || !res.body) throw new ProviderError(`Gemini returned an error (HTTP ${res.status}). Retry in a moment.`, 'provider', true)
    for await (const event of sseLines(res.body, 'sse')) {
      const e = event as { candidates?: { content?: { parts?: { text?: string }[] } }[]; usageMetadata?: { candidatesTokenCount?: number } }
      const delta = e.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
      const tokens = e.usageMetadata?.candidatesTokenCount ?? null
      if (delta) yield { delta, done: false, outputTokens: null }
      if (tokens != null) yield { delta: '', done: true, outputTokens: tokens }
    }
    yield { delta: '', done: true, outputTokens: null }
    return
  }
  if (req.settings.provider === 'ollama') {
    const endpoint = (req.settings.ollamaEndpoint || 'http://localhost:11434').replace(/\/$/, '')
    let res: Response
    try {
      res = await fetch(`${endpoint}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: req.settings.model,
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.prompt },
          ],
          stream: true,
          options: { num_predict: req.maxOutputTokens, temperature: 0.2 },
        }),
        signal: req.signal ?? null,
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw new ProviderError('Canceled.', 'canceled', false)
      throw new ProviderError(`Could not reach the Ollama endpoint (${endpoint}). Check that it is running and that OLLAMA_ORIGINS allows this page.`, 'network', true)
    }
    if (res.status === 404) throw new ProviderError(`Ollama does not have the model "${req.settings.model}". Pull it first (ollama pull ${req.settings.model}).`, 'provider', false)
    if (!res.ok || !res.body) throw new ProviderError(`Ollama returned an error (HTTP ${res.status}). Retry in a moment.`, 'provider', true)
    for await (const event of sseLines(res.body, 'ndjson')) {
      const e = event as { message?: { content?: string }; done?: boolean; eval_count?: number }
      if (e.message?.content) yield { delta: e.message.content, done: false, outputTokens: null }
      if (e.done) yield { delta: '', done: true, outputTokens: e.eval_count ?? null }
    }
    return
  }
  throw new ProviderError('No model provider configured. Choose Gemini or Ollama in Settings.', 'invalid_key', false)
}
