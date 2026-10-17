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
