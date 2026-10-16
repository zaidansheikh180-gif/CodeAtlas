/// <reference lib="webworker" />
// Search worker (phase 4): loads the repo's files and symbols from IndexedDB
// once, then answers queries off the main thread so large repositories stay
// responsive. Protocol: init once per repo, then query/result pairs by id.

import { getAllByRepo } from '../lib/db'
import { searchAll, type SearchOutcome } from '../lib/search'
import type { FileRec, SymbolRec } from '../lib/types'

declare const self: DedicatedWorkerGlobalScope

export type SearchRequest =
  | { type: 'init'; repoId: string; moduleNames: string[] }
  | { type: 'query'; id: number; text: string }

export type SearchResponse =
  | { type: 'ready' }
  | { type: 'result'; id: number; outcome: SearchOutcome }

let files: FileRec[] = []
let symbols: SymbolRec[] = []
let moduleNames: string[] = []

self.onmessage = (event: MessageEvent<SearchRequest>) => {
  const msg = event.data
  if (msg.type === 'init') {
    moduleNames = msg.moduleNames
    void (async () => {
      files = await getAllByRepo<FileRec>('files', msg.repoId)
      symbols = await getAllByRepo<SymbolRec>('symbols', msg.repoId)
      self.postMessage({ type: 'ready' } satisfies SearchResponse)
    })()
    return
  }
  const outcome = searchAll(msg.text, files, symbols, moduleNames)
  self.postMessage({ type: 'result', id: msg.id, outcome } satisfies SearchResponse)
}
