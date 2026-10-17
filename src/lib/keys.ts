// API keys (phase 7 part 1, spec-2 section 26, pack-1 #23). Keys are held in
// memory by default and are never logged, displayed back, exported, or sent
// anywhere except the provider the visitor chose, on an explicit request.
// A visitor may opt in to remembering their own model key in this browser
// (localStorage); GitHub tokens are always memory-only (owner decision,
// 2026-10-17). Nothing key-shaped ever enters IndexedDB.

export type KeyKind = 'gemini' | 'github'

const LS_GEMINI = 'codeatlas.key.gemini'
const memory = new Map<KeyKind, string>()

export function setKey(kind: KeyKind, value: string, opts: { persist?: boolean } = {}, storage: Storage = localStorage): void {
  const trimmed = value.trim()
  if (!trimmed) return clearKey(kind, storage)
  memory.set(kind, trimmed)
  if (kind === 'gemini') {
    if (opts.persist) storage.setItem(LS_GEMINI, trimmed)
    else storage.removeItem(LS_GEMINI)
  }
}

export function getKey(kind: KeyKind, storage: Pick<Storage, 'getItem'> = localStorage): string | null {
  const held = memory.get(kind)
  if (held) return held
  if (kind === 'gemini') {
    const saved = storage.getItem(LS_GEMINI)
    if (saved) {
      memory.set(kind, saved)
      return saved
    }
  }
  return null
}

export function hasKey(kind: KeyKind): boolean {
  return getKey(kind) !== null
}

export function keyIsRemembered(kind: KeyKind, storage: Pick<Storage, 'getItem'> = localStorage): boolean {
  return kind === 'gemini' && storage.getItem(LS_GEMINI) !== null
}

export function clearKey(kind: KeyKind, storage: Pick<Storage, 'removeItem'> = localStorage): void {
  memory.delete(kind)
  if (kind === 'gemini') storage.removeItem(LS_GEMINI)
}

export function clearAllKeys(storage: Pick<Storage, 'removeItem'> = localStorage): void {
  memory.clear()
  storage.removeItem(LS_GEMINI)
}

// The privacy report (spec-2 section 26) states whether context ever left the
// device. This marker records that a send happened - provider, purpose and
// time only, never payloads, file lists, or anything key-shaped.
export interface ExternalSendMarker {
  at: number
  provider: string
  purpose: string
}

const LS_SENT = 'codeatlas.externalSend'

export function markExternalSend(provider: string, purpose: string, storage: Pick<Storage, 'setItem'> = localStorage): void {
  const marker: ExternalSendMarker = { at: Date.now(), provider, purpose }
  storage.setItem(LS_SENT, JSON.stringify(marker))
}

export function lastExternalSend(storage: Pick<Storage, 'getItem'> = localStorage): ExternalSendMarker | null {
  const raw = storage.getItem(LS_SENT)
  if (!raw) return null
  try {
    return JSON.parse(raw) as ExternalSendMarker
  } catch {
    return null
  }
}
