/// <reference lib="webworker" />
// Search worker (phase 4): loads the repo's files, symbols and edges from
// IndexedDB once, then answers queries off the main thread so large
// repositories stay responsive. Also runs graph clustering (phase 5) on
// demand. Protocol: init once per repo, then request/result pairs by id.

import { getAllByRepo } from '../lib/db'
import { searchAll, type SearchOutcome } from '../lib/search'
import { clusterFiles, type CommunityStat } from '../lib/cluster'
import type { EdgeRec, FileRec, SymbolRec } from '../lib/types'

declare const self: DedicatedWorkerGlobalScope

export type SearchRequest =
  | { type: 'init'; repoId: string; moduleNames: string[] }
  | { type: 'query'; id: number; text: string }
  | { type: 'cluster'; id: number }

export type SearchResponse =
  | { type: 'ready' }
  | { type: 'result'; id: number; outcome: SearchOutcome }
  | { type: 'clusterResult'; id: number; assignments: [string, string][]; communities: CommunityStat[] }

let files: FileRec[] = []
let symbols: SymbolRec[] = []
let edges: EdgeRec[] = []
let moduleNames: string[] = []

self.onmessage = (event: MessageEvent<SearchRequest>) => {
  const msg = event.data
  if (msg.type === 'init') {
    moduleNames = msg.moduleNames
    void (async () => {
      files = await getAllByRepo<FileRec>('files', msg.repoId)
      symbols = await getAllByRepo<SymbolRec>('symbols', msg.repoId)
      edges = await getAllByRepo<EdgeRec>('edges', msg.repoId)
      self.postMessage({ type: 'ready' } satisfies SearchResponse)
    })()
    return
  }
  if (msg.type === 'cluster') {
    const result = clusterFiles(files, symbols, edges)
    self.postMessage({
      type: 'clusterResult',
      id: msg.id,
      assignments: [...result.assign.entries()],
      communities: result.communities,
    } satisfies SearchResponse)
    return
  }
  const outcome = searchAll(msg.text, files, symbols, moduleNames)
  self.postMessage({ type: 'result', id: msg.id, outcome } satisfies SearchResponse)
}
