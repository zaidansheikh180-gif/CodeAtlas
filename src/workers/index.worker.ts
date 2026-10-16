/// <reference lib="webworker" />
// The indexing pipeline. Runs fully inside this Web Worker: downloads the repo
// archive from GitHub, filters, scans for secrets, parses with tree-sitter
// (WASM), builds the graph and writes everything to IndexedDB. Repo contents
// are untrusted input - parsed, never executed.

import { CAPS } from '../lib/caps'
import { rawUrl, treeUrl } from '../lib/github'
import { languageOf, shouldSkip, type FileLanguage } from '../lib/filter'
import { scanForSecrets } from '../lib/secrets'
import { countByRepo, fileId, isQuotaError, putAll, putRepo, updateJob } from '../lib/db'
import { parseFile } from './parse'
import { buildGraph, type FileParse } from './graph'
import type { IndexRequest, IndexEvent } from '../lib/pipeline'
import type { FileRec, JobStage } from '../lib/types'

declare const self: DedicatedWorkerGlobalScope

const post = (event: IndexEvent) => self.postMessage(event)

const STAGE_LABEL: Record<string, string> = {
  fetching: 'Downloading archive',
  filtering: 'Filtering files',
  secrets: 'Scanning for secrets',
  parsing: 'Parsing code',
  graph: 'Building graph',
  storing: 'Saving index',
}

// Liveness state for the phase-3 watchdog: the page considers the worker
// alive while any message arrives, and the heartbeat below keeps that true
// during long stages. If the event loop wedges (measured in phase 2, the
// django run stalled silently), the heartbeats stop and the page names the
// failed stage instead of waiting forever.
let currentStage: JobStage | 'starting' = 'starting'
let hangAt: JobStage | undefined

function stage(stageName: JobStage, status: 'active' | 'done', detail?: string) {
  post({ type: 'stage', stage: stageName, status, detail })
  if (status === 'active') {
    currentStage = stageName
    if (hangAt === stageName) {
      // Dev-only fault injection (?hang=<stage>): block the event loop the way
      // the django run wedged, so the watchdog can be exercised end to end.
      // The page's watchdog cancels the run and terminates this worker.
      const until = performance.now() + 3_600_000
      while (performance.now() < until) {
        // wedged on purpose
      }
    }
  }
}

async function fail(stageName: JobStage, message: string, code?: string): Promise<never> {
  post({ type: 'failed', stage: stageName, message, code })
  throw new Error(message)
}

async function run(request: IndexRequest): Promise<void> {
  const timings: Record<string, number> = {}
  const t0 = performance.now()
  const mark = (name: string, start: number) => {
    timings[name] = Math.round(performance.now() - start)
  }

  // --- Stage 1: file list from the git tree API, then raw downloads ---
  // The zipball endpoint is unusable from a browser (codeload's CORS header
  // only allows render.githubusercontent.com), so fetching goes: one request
  // for the recursive file tree, then raw file downloads, which are served
  // from raw.githubusercontent.com (CORS-open, not rate-limited like the API).
  stage('fetching', 'active', 'Reading the repository file list from GitHub')
  let t = performance.now()
  let treeRes: Response
  try {
    treeRes = await fetch(treeUrl(request.fullName, request.commit), {
      headers: request.token ? { Authorization: `Bearer ${request.token}` } : {},
      signal: AbortSignal.timeout(30_000),
    })
  } catch {
    return fail('fetching', 'Could not reach GitHub. Check your connection and try again.', 'network')
  }
  if (treeRes.status === 404) {
    return fail('fetching', 'Repository not found. Check the URL - CodeAtlas can only read public repositories.', 'not_found')
  }
  const remaining = treeRes.headers.get('x-ratelimit-remaining')
  if (treeRes.status === 403 && remaining === '0') {
    return fail('fetching', 'GitHub rate limit reached for anonymous requests. Wait for the reset, or add your own GitHub token in Settings (coming in a later phase).', 'rate_limited')
  }
  if (!treeRes.ok) {
    return fail('fetching', `GitHub returned an error (HTTP ${treeRes.status}). Try again in a moment.`, 'network')
  }
  const treeData = (await treeRes.json()) as {
    truncated: boolean
    tree: { path: string; type: string; size?: number; sha?: string }[]
  }
  if (treeData.truncated) {
    return fail('fetching', 'This repository is too large for the browser version - its file list alone exceeds what GitHub returns in one request. The caps protect your browser tab.', 'too_large')
  }
  const blobs = treeData.tree.filter((e) => e.type === 'blob')

  // --- Stage 2: filter before downloading (sizes come from the tree) ---
  stage('filtering', 'active')
  const skipped = { vendored: 0, binary: 0, generated: 0, oversized: 0, overCaps: 0 }
  const unparsedLanguages: Record<string, number> = {}
  const wanted: { path: string; size: number; sha: string }[] = []
  let plannedBytes = 0
  for (const blob of blobs) {
    const path = blob.path
    const size = blob.size ?? 0
    const skip = shouldSkip(path)
    if (skip) {
      skipped[skip]++
      continue
    }
    if (size > CAPS.maxFileBytes) {
      skipped.oversized++
      continue
    }
    const language = languageOf(path)
    if (language === 'other') {
      const ext = path.split('.').pop()?.toLowerCase() ?? 'unknown'
      unparsedLanguages[ext] = (unparsedLanguages[ext] ?? 0) + 1
      continue
    }
    if (wanted.length >= CAPS.maxFiles || plannedBytes + size > CAPS.maxSourceBytes) {
      skipped.overCaps++
      continue
    }
    wanted.push({ path, size, sha: blob.sha ?? '' })
    plannedBytes += size
  }
  mark('filterMs', t)
  if (wanted.length === 0) {
    return fail('filtering', 'No readable source files were found in this repository after filtering.', 'empty')
  }
  stage(
    'filtering',
    'done',
    `${wanted.length} files to download, ${skipped.vendored + skipped.binary + skipped.generated} skipped (vendored, binary or generated)`,
  )

  // --- Stage 1b: download the kept files as raw content ---
  stage('fetching', 'active', `Downloading ${wanted.length} files`)
  t = performance.now()
  const decoder = new TextDecoder()
  const kept: { path: string; language: FileLanguage; text: string; sha: string }[] = []
  let downloaded = 0
  let failedDownloads = 0
  const CONCURRENCY = 8
  let cursor = 0
  // Every request carries a timeout: a stalled connection must never wedge a
  // download slot forever (measured need in phase 2, django run, 2026-10-16).
  const downloadOne = async (item: { path: string; sha: string }): Promise<boolean> => {
    try {
      const res = await fetch(rawUrl(request.fullName, request.commit, item.path), {
        signal: AbortSignal.timeout(20_000),
      })
      if (!res.ok) return false
      const text = decoder.decode(await res.arrayBuffer())
      kept.push({ path: item.path, language: languageOf(item.path), text, sha: item.sha })
      return true
    } catch {
      return false
    }
  }
  const failed: { path: string; sha: string }[] = []
  const worker = async (queue: { path: string; sha: string }[], failures: { path: string; sha: string }[] | null) => {
    while (cursor < queue.length) {
      const item = queue[cursor++]
      const ok = await downloadOne(item)
      if (!ok) {
        if (failures) failures.push(item)
        else failedDownloads++
      }
      downloaded++
      if (downloaded % 20 === 0 || downloaded === wanted.length) {
        post({ type: 'progress', stage: 'fetching', done: Math.min(downloaded, wanted.length), total: wanted.length })
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(wanted, failed)))
  // One retry pass over the failures; second failures are skipped for good.
  if (failed.length > 0) {
    cursor = 0
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(failed, null)))
  }
  mark('fetchMs', t)
  if (kept.length === 0) {
    return fail('fetching', 'The file downloads all failed. Check your connection and try again.', 'network')
  }
  stage(
    'fetching',
    'done',
    `${kept.length} files downloaded${failedDownloads > 0 ? `, ${failedDownloads} failed and were skipped` : ''}`,
  )

  // --- Stage 3: secret scanning ---
  stage('secrets', 'active')
  t = performance.now()
  const excludedSecrets: { path: string; pattern: string }[] = []
  const clean = kept.filter((file) => {
    const hit = scanForSecrets(file.path, file.text)
    if (hit) {
      excludedSecrets.push({ path: file.path, pattern: hit })
      return false
    }
    return true
  })
  mark('secretsMs', t)
  stage(
    'secrets',
    'done',
    excludedSecrets.length === 0
      ? 'No files looked like credentials'
      : `${excludedSecrets.length} file(s) excluded - they look like credentials`,
  )

  // --- Stage 4: parse with tree-sitter ---
  stage('parsing', 'active', 'Tree-sitter runs here in a Web Worker, so the page stays responsive')
  t = performance.now()
  const files: FileRec[] = []
  const parses: FileParse[] = []
  let done = 0
  let parseSkippedLarge = 0
  // Very large single files are kept in the index but skip tree-sitter: a
  // pathological parse must never stall the whole run (phase 2 hardening).
  const PARSE_MAX_BYTES = 256_000
  for (const file of clean) {
    const ext = file.path.split('.').pop()?.toLowerCase() ?? ''
    let result = null
    if (file.text.length > PARSE_MAX_BYTES) {
      parseSkippedLarge++
    } else {
      try {
        result = await parseFile(file.language, file.text, ext)
      } catch {
        result = null // a single unparseable file degrades to "files only"
      }
    }
    files.push({
      id: fileId(request.repoId, file.path),
      repoId: request.repoId,
      path: file.path,
      language: file.language,
      size: file.text.length,
      contentHash: file.sha,
      text: file.text,
    })
    parses.push({ path: file.path, language: file.language, result })
    done++
    if (done % 25 === 0 || done === clean.length) {
      post({ type: 'progress', stage: 'parsing', done, total: clean.length })
    }
  }
  mark('parseMs', t)
  const parsedCount = parses.filter((p) => p.result).length
  stage(
    'parsing',
    'done',
    `${parsedCount} of ${files.length} files parsed${parseSkippedLarge > 0 ? `, ${parseSkippedLarge} very large file(s) kept without parsing` : ''}`,
  )

  // --- Stage 5: build the graph ---
  stage('graph', 'active')
  t = performance.now()
  const { symbols, edges } = buildGraph(request.repoId, files, parses)
  mark('graphMs', t)
  const extracted = edges.filter((e) => e.confidence === 'extracted').length
  stage('graph', 'done', `${symbols.length} symbols, ${edges.length} edges (${extracted} extracted, ${edges.length - extracted} inferred)`)

  // --- Stage 6: store in IndexedDB, then read back and verify ---
  stage('storing', 'active')
  t = performance.now()
  const stats = {
    files: files.length,
    parsedFiles: parsedCount,
    symbols: symbols.length,
    edges: edges.length,
    secretsExcluded: excludedSecrets.length,
  }
  try {
    await putAll('files', files)
    await putAll('symbols', symbols)
    await putAll('edges', edges)
    await putRepo({
      id: request.repoId,
      url: request.repoUrl,
      fullName: request.fullName,
      commit: request.commit,
      defaultBranch: request.defaultBranch,
      ref: request.ref,
      status: 'ready',
      description: request.description,
      language: request.language,
      sizeKb: request.sizeKb,
      stats,
      indexedAt: Date.now(),
    })
  } catch (error) {
    if (isQuotaError(error)) {
      return fail(
        'storing',
        'This browser ran out of storage while saving the index. Clear an older index from the start page and try again.',
        'storage_full',
      )
    }
    throw error
  }

  // Read-back verification: the write is only done when the store agrees.
  const [storedFiles, storedSymbols, storedEdges] = await Promise.all([
    countByRepo('files', request.repoId),
    countByRepo('symbols', request.repoId),
    countByRepo('edges', request.repoId),
  ])
  if (storedFiles !== files.length || storedSymbols !== symbols.length || storedEdges !== edges.length) {
    return fail(
      'storing',
      'The index did not save completely to browser storage. Clear an older index from the start page and try again.',
      'storage_verify',
    )
  }
  mark('storeMs', t)
  mark('totalMs', t0)
  stage('storing', 'done', 'Saved and verified in this browser')
  post({ type: 'done', stats, timings, excludedSecrets, skipped: skipped as unknown as Record<string, number>, unparsedLanguages })
}

self.onmessage = async (message: MessageEvent<IndexRequest>) => {
  if (message.data.type !== 'start') return
  const request = message.data
  hangAt = request.debugHangAt
  // Heartbeat: proof of liveness for the page-side watchdog, carrying the
  // stage the worker is in so a stall can be named.
  const beat = setInterval(() => {
    post({ type: 'heartbeat', stage: currentStage, at: Date.now() })
  }, 2_000)
  try {
    await updateJob({
      id: request.jobId,
      repoId: request.repoId,
      stage: 'fetching',
      detail: STAGE_LABEL.fetching,
      error: null,
      updatedAt: Date.now(),
    })
    await run(request)
    await updateJob({
      id: request.jobId,
      repoId: request.repoId,
      stage: 'done',
      detail: 'Index complete',
      error: null,
      updatedAt: Date.now(),
    })
  } catch (error) {
    // The failure event was already posted with a plain-language message.
    await updateJob({
      id: request.jobId,
      repoId: request.repoId,
      stage: 'failed',
      detail: '',
      error: error instanceof Error ? error.message : 'Indexing failed.',
      updatedAt: Date.now(),
    })
    await putRepo({
      id: request.repoId,
      url: request.repoUrl,
      fullName: request.fullName,
      commit: request.commit,
      defaultBranch: request.defaultBranch,
      ref: request.ref,
      status: 'failed',
      description: request.description,
      language: request.language,
      sizeKb: request.sizeKb,
      stats: { files: 0, parsedFiles: 0, symbols: 0, edges: 0, secretsExcluded: 0 },
      indexedAt: Date.now(),
    })
  } finally {
    clearInterval(beat)
  }
}
