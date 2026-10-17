// Repo view: the top-level module map, repo stats, key-free graph queries
// (phase 3) with cited answers, and a side panel that lists a module's files
// and previews source. Layered drill-down and model chat arrive in later
// phases.

import { loadSettings } from '../lib/settings'
import { useEffect, useMemo, useRef, useState } from 'react'
import { deleteRepo, getAllByRepo, getRepo, listFeedback, putFeedback } from '../lib/db'
import { GitHubError, resolveCommit } from '../lib/github'
import type { IndexTarget } from './Landing'
import { answerQuestion, buildIndex, type QueryAnswer } from '../lib/graphquery'
import type { SearchOutcome } from '../lib/search'
import type { SearchRequest, SearchResponse } from '../workers/search.worker'
import FileExplorer from './FileExplorer'
import ImpactPanel from './ImpactPanel'
import CallFlowPanel from './CallFlowPanel'
import CommunitiesPanel from './CommunitiesPanel'
import CompareView from './CompareView'
import DiagnosticsPanel from './DiagnosticsPanel'
import ExportPanel from './ExportPanel'
import ChatPanel from './ChatPanel'
import SemanticPanel from './SemanticPanel'
import SnapshotsPanel from './SnapshotsPanel'
import FeedbackPanel from './FeedbackPanel'
import WatchPanel from './WatchPanel'
import type { CommunityStat } from '../lib/cluster'
import type { DiagnosticsReport } from '../lib/diagnostics'
import SearchPalette from './SearchPalette'
import { applyFeedbackToAnswer, findCorrections, makeFeedback, nodeAdjustments, type FeedbackRec, type FeedbackType } from '../lib/feedback'
import { pickLocalFolder, type LocalManifestEntry } from '../lib/localfolder'
import { formatMs, shouldUsePerformanceMode } from '../lib/perf'
import { getLocalHandle, persistLocalHandle } from '../lib/handles'
import { startLocalWatch, type WatchChangeSummary, type WatchSession, type WatchState } from '../lib/localwatch'
import { startIndexing } from '../lib/pipeline'
import { highlightToLines, type HighlightedLine } from '../lib/highlight'
import { buildModules, MODULE_COLORS } from '../lib/modules'
import type { EdgeRec, FileRec, RepoRec, SymbolRec } from '../lib/types'
import MapCanvas from './MapCanvas'

interface Props {
  repoId: string
  onBack: () => void
  onOpenRepo: (repoId: string) => void
  onReindex: (target: IndexTarget) => void
}

type ReindexState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'uptodate' }
  | { kind: 'error'; message: string }

export default function RepoView({ repoId, onBack, onReindex, onOpenRepo }: Props) {
  const [repo, setRepo] = useState<RepoRec | null>(null)
  const [files, setFiles] = useState<FileRec[]>([])
  const [symbols, setSymbols] = useState<SymbolRec[]>([])
  const [edges, setEdges] = useState<EdgeRec[]>([])
  const [selectedModule, setSelectedModule] = useState<string | null>(null)
  const [openFile, setOpenFile] = useState<FileRec | null>(null)
  const [missing, setMissing] = useState(false)
  const [reindex, setReindex] = useState<ReindexState>({ kind: 'idle' })
  // Resizable side panel: width persists in this browser (localStorage).
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    const saved = Number(window.localStorage.getItem('codeatlas.panelWidth'))
    return Number.isFinite(saved) && saved >= 280 ? Math.min(saved, 860) : 320
  })
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const [highlighted, setHighlighted] = useState<HighlightedLine[] | null>(null)
  // Graph Query Mode: the question, its cited answer, and the source line a
  // citation click should scroll to.
  const [query, setQuery] = useState('')
  const [answer, setAnswer] = useState<QueryAnswer | null>(null)
  const [answerMs, setAnswerMs] = useState<number | null>(null)
  // Performance mode (phase 9 part 2): auto-detected from graph size; the
  // user can force it on or off. null = follow auto-detection.
  const [perfOverride, setPerfOverride] = useState<boolean | null>(null)
  useEffect(() => {
    // Phase 7 part 1: the settings page owns the default; the map header
    // toggle still overrides per view.
    void loadSettings().then((s) => {
      if (s.performanceMode === 'on') setPerfOverride(true)
      else if (s.performanceMode === 'off') setPerfOverride(false)
    })
  }, [])
  const [pendingLine, setPendingLine] = useState<number | null>(null)
  // Repo-wide search palette: worker-backed, opened with Ctrl/Cmd+K.
  const [searchOpen, setSearchOpen] = useState(false)
  // Source viewer upgrades (phase 4): symbol outline with resolved imports,
  // and in-file search with match jumping.
  const [outlineOpen, setOutlineOpen] = useState(false)
  // Communities (phase 5): clustering runs in the search worker; assignments
  // (fileId -> communityId) and stats come back by request id. Labels default
  // to deterministic placeholders; renames persist in localStorage per repo.
  const [communitiesOpen, setCommunitiesOpen] = useState(false)
  const [clusterAssignments, setClusterAssignments] = useState<Map<string, string> | null>(null)
  const [communityStats, setCommunityStats] = useState<CommunityStat[]>([])
  const [clusterLoading, setClusterLoading] = useState(false)
  const [selectedCommunity, setSelectedCommunity] = useState<string | null>(null)
  const [communityLabels, setCommunityLabels] = useState<Record<string, string>>({})

  // Diagnostics (phase 5): read-only data-quality report, computed in the
  // search worker over src/lib/diagnostics.ts.
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [snapshotsOpen, setSnapshotsOpen] = useState(false)
  // Feedback memory (phase 7): this repo's ratings, the corrections matching
  // the current question, and the correction being typed.
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  // Watch mode (phase 8 part 2, local folders only): the session lives here
  // so watching continues when the panel closes; it stops on unmount.
  const [watchOpen, setWatchOpen] = useState(false)
  const [semanticOpen, setSemanticOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatPrefill, setChatPrefill] = useState<string | undefined>(undefined)
  const [watchState, setWatchState] = useState<WatchState | { kind: 'idle' }>({ kind: 'idle' })
  const [watchChanges, setWatchChanges] = useState<WatchChangeSummary | null>(null)
  const watchRef = useRef<WatchSession | null>(null)
  const [feedbackRecs, setFeedbackRecs] = useState<FeedbackRec[]>([])
  const [lastQuestion, setLastQuestion] = useState('')
  const [corrections, setCorrections] = useState<FeedbackRec[]>([])
  const [rated, setRated] = useState<FeedbackType | null>(null)
  const [correcting, setCorrecting] = useState(false)
  const [correctionText, setCorrectionText] = useState('')
  const [compareOpen, setCompareOpen] = useState(false)
  const [diagnosticsReport, setDiagnosticsReport] = useState<DiagnosticsReport | null>(null)
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false)

  // Impact panel (phase 4): the selected graph node id and optional map highlight.
  const [impactTarget, setImpactTarget] = useState<string | null>(null)
  const [impactHighlight, setImpactHighlight] = useState<string[] | null>(null)
  const [edgeVis, setEdgeVis] = useState({ imports: true, calls: true })
  // Call-flow panel (phase 4): rooted at a symbol id.
  const [flowTarget, setFlowTarget] = useState<string | null>(null)
  // File/dependency explorer: left tree panel, synced with map and viewer.
  const [explorerOpen, setExplorerOpen] = useState(true)
  const [fileQuery, setFileQuery] = useState('')
  const fileSearchRef = useRef<HTMLInputElement>(null)
  const searchWorkerRef = useRef<Worker | null>(null)
  const searchPendingRef = useRef(new Map<number, (outcome: SearchOutcome) => void>())
  const searchIdRef = useRef(0)

  // Lazy syntax coloring for the open file; falls back to plain text.
  useEffect(() => {
    setHighlighted(null)
    if (!openFile) return
    let stale = false
    void highlightToLines(openFile.text, openFile.path).then((lines) => {
      if (!stale) setHighlighted(lines)
    })
    return () => {
      stale = true
    }
  }, [openFile])
  const clampWidth = (w: number) => Math.min(Math.max(w, 280), Math.min(860, window.innerWidth - 320))
  const applyWidth = (w: number) => {
    const clamped = clampWidth(w)
    setPanelWidth(clamped)
    window.localStorage.setItem('codeatlas.panelWidth', String(Math.round(clamped)))
  }

  const loadRepo = async () => {
    const rec = await getRepo(repoId)
    if (!rec) {
      setMissing(true)
      return
    }
    setRepo(rec)
    setFiles(await getAllByRepo<FileRec>('files', repoId))
    setSymbols(await getAllByRepo<SymbolRec>('symbols', repoId))
    setEdges(await getAllByRepo<EdgeRec>('edges', repoId))
  }

  useEffect(() => {
    void loadRepo()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId])

  // Stop watching when the repo view unmounts.
  useEffect(() => {
    return () => {
      watchRef.current?.stop()
      watchRef.current = null
    }
  }, [])

  // Escape closes the topmost open panel (focus management, phase 9 part 3).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (answer) setAnswer(null)
      else if (chatOpen) setChatOpen(false)
      else if (semanticOpen) setSemanticOpen(false)
      else if (watchOpen) setWatchOpen(false)
      else if (feedbackOpen) setFeedbackOpen(false)
      else if (snapshotsOpen) setSnapshotsOpen(false)
      else if (diagnosticsOpen) setDiagnosticsOpen(false)
      else if (exportOpen) setExportOpen(false)
      else if (communitiesOpen) setCommunitiesOpen(false)
      else if (openFile) setOpenFile(null)
      else if (explorerOpen) setExplorerOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Start (or restart) a watch session for this local repo. Updates run the
  // standard indexing pipeline in the background - same pipeline, no view
  // change - and refresh this view's data when they land.
  const startWatch = () => {
    const handle = repo?.localHandle ?? (repo ? getLocalHandle(repo.id) : undefined)
    if (!repo || !handle) return
    watchRef.current?.stop()
    const fallbackManifest: LocalManifestEntry[] = files.map((f) => ({
      path: f.path,
      size: f.size,
      lastModified: 0,
      sha: f.contentHash,
    }))
    const session = startLocalWatch({
      handle,
      manifest: repo.localManifest ?? fallbackManifest,
      onState: (next) => setWatchState(next),
      onChanges: (summary) => setWatchChanges(summary),
      runUpdate: (entries) =>
        new Promise((resolve) => {
          const jobId = `${repo.id}:job:${Date.now()}`
          startIndexing(
            {
              repoId: repo.id,
              jobId,
              repoUrl: repo.url,
              fullName: repo.fullName,
              commit: repo.commit,
              defaultBranch: repo.defaultBranch,
              ref: repo.ref,
              incrementalFrom: repo.id,
              description: repo.description,
              language: repo.language,
              sizeKb: repo.sizeKb,
              local: true,
              localFiles: entries,
            },
            (event) => {
              if (event.type === 'stage' && event.status === 'active') {
                setWatchState({ kind: 'updating', detail: event.detail ?? event.stage })
              }
              if (event.type === 'done') {
                void loadRepo().then(() => resolve({ ok: true }))
              }
              if (event.type === 'failed') {
                resolve({ ok: false, error: event.message })
              }
            },
          )
        }),
    })
    watchRef.current = session
  }

  // Indexes created before watch mode have no stored handle: pick the folder
  // once, save the handle on the repo record, then start watching.
  const linkFolder = async () => {
    if (!repo) return
    const dir = await pickLocalFolder()
    if (!dir) return
    await persistLocalHandle(repo.id, dir)
    setRepo({ ...repo, localHandle: dir })
    setWatchState({ kind: 'idle' })
  }

  const { modules, moduleEdges } = useMemo(() => buildModules(files, symbols, edges), [files, symbols, edges])
  const autoPerf = useMemo(() => shouldUsePerformanceMode(modules.length, moduleEdges.length, files.length), [modules, moduleEdges, files])
  const perfMode = perfOverride ?? autoPerf
  const fileImports = useMemo(
    () => edges.filter((e) => e.type === 'imports').map((e) => ({ from: e.fromId, to: e.toId })),
    [edges],
  )
  const extractedEdges = useMemo(() => edges.filter((e) => e.confidence === 'extracted').length, [edges])
  const selected = modules.find((m) => m.name === selectedModule) ?? null

  // The query index rebuilds only when the underlying index records change.
  const queryIndex = useMemo(() => buildIndex(files, symbols, edges), [files, symbols, edges])
  // Modules touched by the current answer, ringed on the map.
  const highlightedModules = useMemo(() => {
    const names = new Set<string>()
    const paths = [...(answer?.highlightPaths ?? []), ...(impactHighlight ?? [])]
    for (const path of paths) {
      const mod = modules.find((m) => m.files.some((f) => f.path === path))
      if (mod) names.add(mod.name)
    }
    return [...names]
  }, [answer, impactHighlight, modules])

  // Community view: each module takes the color of its dominant community
  // (mode over member file assignments, ties to the smaller community index).
  // Community colors reuse the module palette by community index, so the map
  // keeps the same flat color family.
  const communityColorMap = useMemo(() => {
    if (!clusterAssignments || !communitiesOpen) return undefined
    const statById = new Map(communityStats.map((c) => [c.id, c]))
    const colorByCommunity = new Map(communityStats.map((c) => [c.id, MODULE_COLORS[(c.index - 1) % MODULE_COLORS.length]]))
    const map = new Map<string, string>()
    for (const m of modules) {
      const counts = new Map<string, number>()
      for (const f of m.files) {
        const cid = clusterAssignments.get(f.id)
        if (cid) counts.set(cid, (counts.get(cid) ?? 0) + 1)
      }
      let best: string | null = null
      let bestCount = 0
      for (const [cid, n] of counts) {
        const idx = statById.get(cid)?.index ?? Number.MAX_SAFE_INTEGER
        const bestIdx = best ? (statById.get(best)?.index ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER
        if (n > bestCount || (n === bestCount && idx < bestIdx)) {
          best = cid
          bestCount = n
        }
      }
      if (best) map.set(m.name, colorByCommunity.get(best) ?? '#8a76b3')
    }
    return map
  }, [clusterAssignments, communityStats, modules, communitiesOpen])

  // While one community is inspected, modules with no member in it dim.
  const communityDimmed = useMemo(() => {
    if (!selectedCommunity || !clusterAssignments) return undefined
    const dimmed: string[] = []
    for (const m of modules) {
      const hasMember = m.files.some((f) => clusterAssignments.get(f.id) === selectedCommunity)
      if (!hasMember) dimmed.push(m.name)
    }
    return dimmed
  }, [selectedCommunity, clusterAssignments, modules])

  // Search worker: one per repo view, re-initialised when the module list
  // changes. Terminated on unmount; pending promises settle with empty
  // results so the palette never hangs.
  useEffect(() => {
    if (!repo) return
    const worker = new Worker(new URL('../workers/search.worker.ts', import.meta.url), { type: 'module' })
    searchWorkerRef.current = worker
    worker.onmessage = (event: MessageEvent<SearchResponse>) => {
      const msg = event.data
      if (msg.type === 'result') {
        const resolve = searchPendingRef.current.get(msg.id)
        if (resolve) {
          searchPendingRef.current.delete(msg.id)
          resolve(msg.outcome)
        }
      } else if (msg.type === 'diagnosticsResult') {
        setDiagnosticsReport(msg.report)
        setDiagnosticsLoading(false)
      } else if (msg.type === 'clusterResult') {
        setClusterAssignments(new Map(msg.assignments))
        setCommunityStats(msg.communities)
        setClusterLoading(false)
        setSelectedCommunity(null)
      }
    }
    const init: SearchRequest = { type: 'init', repoId, moduleNames: modules.map((m) => m.name) }
    worker.postMessage(init)
    return () => {
      worker.terminate()
      searchWorkerRef.current = null
      for (const resolve of searchPendingRef.current.values()) resolve({ results: [], truncated: false })
      searchPendingRef.current.clear()
    }
  }, [repo, repoId, modules])

  const runSearch = (text: string): Promise<SearchOutcome> => {
    const worker = searchWorkerRef.current
    if (!worker) return Promise.resolve({ results: [], truncated: false })
    const id = ++searchIdRef.current
    return new Promise((resolve) => {
      searchPendingRef.current.set(id, resolve)
      worker.postMessage({ type: 'query', id, text } satisfies SearchRequest)
    })
  }

  const requestDiagnostics = () => {
    const worker = searchWorkerRef.current
    if (!worker) return
    setDiagnosticsLoading(true)
    worker.postMessage({ type: 'diagnostics', id: ++searchIdRef.current } satisfies SearchRequest)
  }

  const toggleDiagnostics = () => {
    if (diagnosticsOpen) {
      setDiagnosticsOpen(false)
      return
    }
    setDiagnosticsOpen(true)
    if (!diagnosticsReport) requestDiagnostics()
  }

  const requestCluster = () => {
    const worker = searchWorkerRef.current
    if (!worker) return
    setClusterLoading(true)
    worker.postMessage({ type: 'cluster', id: ++searchIdRef.current } satisfies SearchRequest)
  }

  const toggleCommunities = () => {
    if (communitiesOpen) {
      setCommunitiesOpen(false)
      setSelectedCommunity(null)
      return
    }
    setCommunitiesOpen(true)
    if (!clusterAssignments) requestCluster()
  }

  // Load this repo's feedback memory.
  useEffect(() => {
    if (!repo) return
    let stale = false
    void listFeedback(repo.id).then((rows) => {
      if (!stale) setFeedbackRecs(rows)
    })
    return () => {
      stale = true
    }
  }, [repo])

  // Load persisted label overrides for this repo; reset cluster state when
  // the repo changes so a stale community can never recolor a new map.
  useEffect(() => {
    setClusterAssignments(null)
    setCommunityStats([])
    setSelectedCommunity(null)
    setCommunitiesOpen(false)
    setDiagnosticsReport(null)
    setDiagnosticsOpen(false)
    try {
      const raw = localStorage.getItem(`codeatlas:community-labels:${repoId}`)
      setCommunityLabels(raw ? (JSON.parse(raw) as Record<string, string>) : {})
    } catch {
      setCommunityLabels({})
    }
  }, [repoId])

  const renameCommunity = (id: string, label: string) => {
    setCommunityLabels((prev) => {
      const next = { ...prev, [id]: label }
      try {
        localStorage.setItem(`codeatlas:community-labels:${repoId}`, JSON.stringify(next))
      } catch {
        // localStorage can be unavailable (private mode) - rename stays session-local.
      }
      return next
    })
  }

  // Ctrl/Cmd+K opens the palette from anywhere in the repo view.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const openSearchFile = (path: string, line?: number) => {
    openCitation(path, line)
  }
  const openSearchModule = (name: string) => {
    setSelectedModule(name)
    setOpenFile(null)
  }

  const ask = (e: React.FormEvent) => {
    e.preventDefault()
    const text = query.trim()
    if (!text) return
    // Feedback memory steers the answer: boosted nodes rank earlier, dead
    // ends sink, and corrections from similar past questions surface above.
    const startedAt = performance.now()
    const base = answerQuestion(text, queryIndex)
    setAnswer(applyFeedbackToAnswer(base, nodeAdjustments(feedbackRecs, Date.now())))
    setAnswerMs(performance.now() - startedAt)
    setLastQuestion(text)
    setCorrections(findCorrections(text, feedbackRecs))
    setRated(null)
    setCorrecting(false)
    setCorrectionText('')
  }

  // Rate the visible answer; stored with the question and the nodes, edges
  // and citations it returned (spec-2 section 17).
  const rate = async (type: FeedbackType) => {
    if (!repo || !answer || !lastQuestion) return
    const rec = makeFeedback(repo.id, lastQuestion, answer, type, correctionText, Date.now())
    await putFeedback(rec)
    setFeedbackRecs(await listFeedback(repo.id))
    setRated(type)
    setCorrecting(false)
    setCorrectionText('')
  }

  // A citation opens its file in the side panel and scrolls to the line.
  const openCitation = (path: string, startLine?: number) => {
    const file = files.find((f) => f.path === path)
    if (!file) return
    const mod = modules.find((m) => m.files.some((f) => f.path === path))
    if (mod) setSelectedModule(mod.name)
    setOpenFile(file)
    setPendingLine(startLine ?? null)
  }

  // Scroll to the cited line once the preview has rendered.
  useEffect(() => {
    if (!openFile || pendingLine == null) return
    document.getElementById(`L${pendingLine}`)?.scrollIntoView({ block: 'center' })
  }, [openFile, highlighted, pendingLine])

  // Outline: the open file's symbols and its resolved import targets.
  const openFileSymbols = useMemo(
    () => (openFile ? symbols.filter((s2) => s2.fileId === openFile.id).sort((a, b) => a.startLine - b.startLine) : []),
    [openFile, symbols],
  )
  const openFileImports = useMemo(() => {
    if (!openFile) return []
    return edges
      .filter((e) => e.type === 'imports' && e.fromId === openFile.id)
      .map((e) => files.find((f) => f.id === e.toId))
      .filter((f): f is FileRec => Boolean(f))
      .sort((a, b) => a.path.localeCompare(b.path))
  }, [openFile, edges, files])

  // Files that import the open file (its dependents).
  const openFileDependents = useMemo(() => {
    if (!openFile) return []
    return edges
      .filter((e) => e.type === 'imports' && e.toId === openFile.id)
      .map((e) => files.find((f) => f.id === e.fromId))
      .filter((f): f is FileRec => Boolean(f))
      .sort((a, b) => a.path.localeCompare(b.path))
  }, [openFile, edges, files])

  // Symbols the open file calls (targets may be symbols or whole files).
  const openFileCalls = useMemo(() => {
    if (!openFile) return []
    const ownSymbolIds = new Set(symbols.filter((s2) => s2.fileId === openFile.id).map((s2) => s2.id))
    const out: { name: string; path: string; line?: number }[] = []
    const seen = new Set<string>()
    for (const e of edges) {
      if (e.type !== 'calls' || !ownSymbolIds.has(e.fromId)) continue
      const targetSym = symbols.find((s2) => s2.id === e.toId)
      const targetFile = targetSym ? files.find((f) => f.id === targetSym.fileId) : files.find((f) => f.id === e.toId)
      if (!targetFile) continue
      const name = targetSym ? targetSym.name : targetFile.path
      const key = `${name}@${targetFile.path}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ name, path: targetFile.path, line: targetSym?.startLine })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 50)
  }, [openFile, edges, symbols, files])

  // External packages the open file references (not local imports).
  const openFilePackages = useMemo(() => {
    if (!openFile) return []
    const pkgs = new Set<string>()
    for (const m of openFile.text.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)|from\s+['"]([^'"]+)['"]/g)) {
      const spec = (m[1] ?? m[2]) as string
      if (!spec.startsWith('.') && !spec.startsWith('/') && !spec.startsWith('node:')) pkgs.add(spec)
    }
    return [...pkgs].sort()
  }, [openFile])

  // In-file search: matching line numbers for the current query.
  const fileMatches = useMemo(() => {
    if (!openFile || fileQuery.trim().length < 2) return []
    const q = fileQuery.trim().toLowerCase()
    const out: number[] = []
    const lines = openFile.text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(q)) out.push(i + 1)
      if (out.length >= 200) break
    }
    return out
  }, [openFile, fileQuery])

  // Ctrl/Cmd+F jumps to in-file search while a file is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && openFile) {
        e.preventDefault()
        setOutlineOpen(false)
        fileSearchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openFile])

  if (missing) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center px-6">
        <p className="text-ink-2">This index is not in this browser's storage. It may have been cleared.</p>
        <button onClick={onBack} className="mt-4 rounded-lg bg-dragon px-4 py-2 text-sm font-semibold text-night">
          Back to start
        </button>
      </div>
    )
  }

  if (!repo) {
    return (
      <div className="flex min-h-full items-center justify-center">
        <p className="text-ink-3">Loading index…</p>
      </div>
    )
  }

  // Re-index: resolve the picked ref's latest commit. Same sha means the
  // index is current; a new sha starts an incremental indexing run that
  // downloads only changed files (see src/lib/incremental.ts).
  const checkReindex = async () => {
    if (!repo) return
    setReindex({ kind: 'checking' })
    try {
      const [owner, name] = repo.fullName.split('/')
      const effectiveRef = repo.ref ?? repo.defaultBranch
      const commit = (await resolveCommit({ owner, repo: name }, effectiveRef)).data
      if (commit === repo.commit) {
        setReindex({ kind: 'uptodate' })
        return
      }
      onReindex({
        repoId: `${repo.fullName}@${commit}`,
        repoUrl: repo.url,
        fullName: repo.fullName,
        commit,
        defaultBranch: repo.defaultBranch,
        ref: repo.ref,
        description: repo.description,
        language: repo.language,
        sizeKb: repo.sizeKb,
        incrementalFrom: repo.id,
      })
    } catch (error) {
      const message =
        error instanceof GitHubError && error.code === 'rate_limited'
          ? `GitHub rate limit reached.${error.resetAt ? ` Resets at ${error.resetAt.toLocaleTimeString()}.` : ''}`
          : error instanceof Error
            ? error.message
            : 'Could not check for updates.'
      setReindex({ kind: 'error', message })
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface-1 px-4 py-3">
        <button onClick={onBack} className="text-sm text-ink-3 hover:text-ink" aria-label="Back to start">
          ←
        </button>
        <div className="min-w-0">
          <h1 className="truncate font-mono text-sm font-semibold text-ink">{repo.fullName}</h1>
          <p className="font-mono text-xs text-ink-3">
            {repo.local
              ? 'local folder'
              : <>{repo.ref && repo.ref !== repo.defaultBranch ? `${repo.ref} · ` : ''}commit {repo.commit.slice(0, 7)}</>}
          </p>
        </div>
        <button
          onClick={() => setExplorerOpen((v) => !v)}
          className={`ml-auto rounded-lg border px-3 py-1 text-xs ${explorerOpen ? 'border-dragon text-dragon' : 'border-line text-ink-2 hover:text-ink'}`}
        >
          Explorer
        </button>
        <button
          onClick={() => setSearchOpen(true)}
          className="rounded-lg border border-line px-3 py-1 text-xs text-ink-2 hover:border-dragon hover:text-ink"
        >
          Search <span className="text-ink-3">Ctrl K</span>
        </button>
        <button
          onClick={toggleDiagnostics}
          className={`rounded-lg border px-3 py-1 text-xs ${diagnosticsOpen ? 'border-dragon text-dragon' : 'border-line text-ink-2 hover:text-ink'}`}
        >
          Diagnostics
        </button>
        <button
          onClick={() => setExportOpen((v) => !v)}
          className={`rounded-lg border px-3 py-1 text-xs ${exportOpen ? 'border-dragon text-dragon' : 'border-line text-ink-2 hover:text-ink'}`}
        >
          Export
        </button>
        <button
          onClick={() => setSnapshotsOpen((v) => !v)}
          className={`rounded-lg border px-3 py-1 text-xs ${snapshotsOpen ? 'border-dragon text-dragon' : 'border-line text-ink-2 hover:text-ink'}`}
        >
          Snapshots
        </button>
        <button
          onClick={() => setFeedbackOpen((v) => !v)}
          title="Feedback memory and lessons for this repository"
          className={`rounded-lg border px-3 py-1 text-xs ${feedbackOpen ? 'border-dragon text-dragon' : 'border-line text-ink-2 hover:text-ink'}`}
        >
          Feedback
        </button>
        <button
          onClick={() => setChatOpen((v) => !v)}
          title="Chat with this repository using your own model (optional)"
          className={`rounded-lg border px-3 py-1 text-xs ${chatOpen ? 'border-dragon text-dragon' : 'border-line text-ink-2 hover:text-ink'}`}
        >
          Chat
        </button>
        <button
          onClick={() => setSemanticOpen((v) => !v)}
          title="Infer higher-level relationships with your own model (optional, INFERRED only)"
          className={`rounded-lg border px-3 py-1 text-xs ${semanticOpen ? 'border-dragon text-dragon' : 'border-line text-ink-2 hover:text-ink'}`}
        >
          Semantic
        </button>
        {repo.local && (
          <button
            onClick={() => setWatchOpen((v) => !v)}
            title="Watch this folder for changes and update the index automatically"
            className={`rounded-lg border px-3 py-1 text-xs ${watchOpen || watchState.kind === 'watching' || watchState.kind === 'updating' ? 'border-dragon text-dragon' : 'border-line text-ink-2 hover:text-ink'}`}
          >
            Watch
          </button>
        )}
        {!repo.imported && !repo.local && (
          <>
            <button
              onClick={() => void checkReindex()}
              disabled={reindex.kind === 'checking'}
              title="Check for new commits and update this index, downloading only what changed"
              className="rounded-lg border border-line px-3 py-1 text-xs text-ink-2 hover:border-dragon hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
            >
              {reindex.kind === 'checking' ? 'Checking…' : 'Re-index'}
            </button>
            {reindex.kind === 'uptodate' && <span className="text-xs text-ink-3">Up to date</span>}
            {reindex.kind === 'error' && <span className="text-xs text-error">{reindex.message}</span>}
          </>
        )}
        <button
          onClick={() => {
            if (window.confirm(`Clear the ${repo.fullName} index from this browser? The repository on GitHub is not affected.`)) {
              void deleteRepo(repo.id).then(onBack)
            }
          }}
          className="rounded-lg border border-line px-3 py-1 text-xs text-ink-3 hover:border-error hover:text-error"
        >
          Clear index
        </button>
        <div className="tabular flex items-center gap-4 text-xs text-ink-2">
          <span>{repo.stats.files} files</span>
          <span>{repo.stats.symbols} symbols</span>
          <span>
            {repo.stats.edges} edges ({extractedEdges} extracted, {repo.stats.edges - extractedEdges} inferred)
          </span>
        </div>
      </header>

      <form onSubmit={ask} className="flex items-center gap-2 border-b border-line bg-surface-1 px-4 py-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask about the graph: what does X import? who calls Y? what breaks if Z changes?"
          aria-label="Ask a graph question"
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface-2 px-3 py-1.5 font-mono text-xs text-ink placeholder:text-ink-3 focus:border-dragon focus:outline-none"
        />
        <button type="submit" className="rounded-lg bg-dragon px-3 py-1.5 text-xs font-semibold text-night">
          Ask
        </button>
        <p className="hidden text-xs text-ink-3 lg:block">Answers cite the index - no model key needed.</p>
      </form>

      <div className="flex min-h-0 flex-1">
        {explorerOpen && (
          <aside className="w-72 shrink-0 border-r border-line max-sm:hidden">
            <FileExplorer
              files={files}
              edges={edges}
              openFilePath={openFile?.path ?? null}
              selectedModule={selectedModule}
              onSelectFile={(path) => openCitation(path)}
              onClose={() => setExplorerOpen(false)}
            />
          </aside>
        )}
        <main className="relative min-w-0 flex-1">
          <MapCanvas modules={modules} moduleEdges={moduleEdges} edgeVisibility={edgeVis} fileImports={fileImports} selected={selectedModule} highlighted={highlightedModules} communityColors={communityColorMap} dimmed={communityDimmed} performanceMode={perfMode} onSelect={(name) => {
            setSelectedModule(name)
            setOpenFile(null)
          }} onOpenFile={(path) => openCitation(path)} />
          {communitiesOpen && (
            <CommunitiesPanel
              communities={communityStats}
              labels={communityLabels}
              colors={new Map(communityStats.map((c) => [c.id, MODULE_COLORS[(c.index - 1) % MODULE_COLORS.length]]))}
              selected={selectedCommunity}
              loading={clusterLoading}
              onSelect={setSelectedCommunity}
              onRename={renameCommunity}
              onRegenerate={requestCluster}
              onClose={toggleCommunities}
            />
          )}
          <div className="absolute left-3 top-3 z-10 flex items-center gap-3 rounded-lg border border-line bg-surface-1/90 px-3 py-1.5 text-xs text-ink-2">
            <span className="font-semibold text-ink">Map</span>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={edgeVis.imports} onChange={(e) => setEdgeVis((v) => ({ ...v, imports: e.target.checked }))} className="accent-dragon" />
              <span className="inline-block h-0 w-5 border-t-2 border-[#b8a8d9]" aria-hidden />
              imports
            </label>
            <button
              onClick={() => setPerfOverride(perfMode ? false : true)}
              title={autoPerf ? 'Large graph detected - performance mode is on automatically; click to toggle' : 'Reduce map detail for large graphs'}
              className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${perfMode ? 'border-dragon text-dragon' : 'border-line text-ink-3 hover:text-ink'}`}
            >
              Performance mode{autoPerf && perfOverride === null ? ' (auto)' : ''}
            </button>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={edgeVis.calls} onChange={(e) => setEdgeVis((v) => ({ ...v, calls: e.target.checked }))} className="accent-dragon" />
              <span className="inline-block h-0 w-5 border-t-2 border-dashed border-dragon" aria-hidden />
              calls
            </label>
            <span className="h-3 w-px bg-line" aria-hidden />
            <button
              onClick={toggleCommunities}
              aria-pressed={communitiesOpen}
              className={`rounded px-1.5 py-0.5 font-semibold ${communitiesOpen ? 'bg-dragon text-night' : 'text-ink-2 hover:text-ink'}`}
            >
              Communities
            </button>
          </div>
          {semanticOpen && (
            <SemanticPanel repoId={repoId} repoName={repo.fullName} files={files} onClose={() => setSemanticOpen(false)} />
          )}
          {chatOpen && (
            <ChatPanel
              repoId={repoId}
              repoName={repo.fullName}
              files={files}
              symbols={symbols}
              edges={edges}
              initialQuestion={chatPrefill}
              onOpenCitation={openCitation}
              onClose={() => { setChatOpen(false); setChatPrefill(undefined) }}
            />
          )}
          {watchOpen && repo && (
            <WatchPanel
              state={watchState}
              changes={watchChanges}
              hasHandle={Boolean(repo.localHandle ?? getLocalHandle(repo.id))}
              onStart={() => {
                setWatchState({ kind: 'watching', lastScan: Date.now() })
                startWatch()
              }}
              onLinkFolder={() => void linkFolder()}
              onAllow={() => void watchRef.current?.allow()}
              onPause={() => watchRef.current?.pause()}
              onResume={() => watchRef.current?.resume()}
              onStop={() => {
                watchRef.current?.stop()
                watchRef.current = null
              }}
              onClose={() => setWatchOpen(false)}
            />
          )}
          {feedbackOpen && repo && (
            <FeedbackPanel
              repo={repo}
              onClose={() => {
                setFeedbackOpen(false)
                void listFeedback(repo.id).then(setFeedbackRecs)
              }}
            />
          )}
          {snapshotsOpen && repo && (
            <SnapshotsPanel
              repo={repo}
              files={files}
              symbols={symbols}
              edges={edges}
              onOpenRepo={onOpenRepo}
              onCompare={() => {
                setSnapshotsOpen(false)
                setCompareOpen(true)
              }}
              onClose={() => setSnapshotsOpen(false)}
            />
          )}
          {compareOpen && repo && (
            <CompareView repoUrl={repo.url} repoName={repo.fullName} onOpenRepo={onOpenRepo} onClose={() => setCompareOpen(false)} />
          )}
          {exportOpen && repo && (
            <ExportPanel
              repo={repo}
              files={files}
              symbols={symbols}
              edges={edges}
              modules={modules}
              moduleEdges={moduleEdges}
              onClose={() => setExportOpen(false)}
            />
          )}
          {diagnosticsOpen && (
            <DiagnosticsPanel
              repoName={repo.fullName}
              report={diagnosticsReport}
              loading={diagnosticsLoading}
              onClose={() => setDiagnosticsOpen(false)}
              onOpenFile={(path) => openCitation(path)}
              onRefresh={requestDiagnostics}
            />
          )}
          {flowTarget && (
            <CallFlowPanel
              index={queryIndex}
              files={files}
              startId={flowTarget}
              onClose={() => setFlowTarget(null)}
              onOpenFile={(path, line) => openCitation(path, line ?? 1)}
              onHighlight={setImpactHighlight}
            />
          )}
          {impactTarget && (
            <ImpactPanel
              index={queryIndex}
              files={files}
              targetId={impactTarget}
              onClose={() => setImpactTarget(null)}
              onOpenFile={(path, line) => openCitation(path, line ?? 1)}
              onHighlight={setImpactHighlight}
            />
          )}
          {answer && (
            <div
              aria-live="polite"
              role="status"
              className="absolute right-4 top-4 flex max-h-[70%] w-96 max-w-[calc(100%-2rem)] flex-col rounded-lg border border-line bg-surface-1 shadow-lg"
            >
              <div className="flex items-start justify-between gap-2 border-b border-line px-3 py-2">
                <p className="text-xs font-semibold text-ink">
                  Graph answer{answerMs !== null && <span className="ml-1 font-normal text-ink-3">in {formatMs(answerMs)}</span>}
                </p>
                <button onClick={() => setAnswer(null)} aria-label="Close answer" className="text-ink-3 hover:text-ink">
                  ✕
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
                {answer.result.truncated && (
                  <div className="mb-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5">
                    <p className="text-[10px] text-amber-200">
                      Results stopped at the traversal budget - ask a narrower question for the full picture.
                    </p>
                  </div>
                )}
                {corrections.length > 0 && (
                  <div className="mb-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5">
                    <p className="text-[10px] font-semibold uppercase text-amber-400">Earlier corrections</p>
                    {corrections.map((c) => (
                      <p key={c.id} className="mt-0.5 text-xs leading-5 text-amber-200">
                        "{c.question}" - {c.correction}
                      </p>
                    ))}
                  </div>
                )}
                <p className="text-xs leading-5 text-ink-2">{answer.summary}</p>
                {answer.result.citations.length > 0 && (
                  <ul className="mt-2 space-y-0.5">
                    {answer.result.citations.slice(0, 50).map((c) => (
                      <li key={c.nodeId}>
                        <button
                          onClick={() => openCitation(c.path, c.startLine)}
                          className="w-full truncate rounded px-1.5 py-1 text-left font-mono text-xs text-dragon hover:bg-surface-2"
                        >
                          {c.path}
                          {c.startLine != null ? `:${c.startLine}${c.endLine != null && c.endLine !== c.startLine ? `-${c.endLine}` : ''}` : ''}
                        </button>
                      </li>
                    ))}
                    {answer.result.citations.length > 50 && (
                      <li className="px-1.5 py-1 text-xs text-ink-3">and {answer.result.citations.length - 50} more</li>
                    )}
                  </ul>
                )}
                {answer.needsModel && (
                  <p className="mt-2 rounded border border-line bg-surface-2 px-2 py-1.5 text-xs text-ink-3">
                    This is a free-form semantic question.{' '}
                    <button
                      onClick={() => { setChatPrefill(lastQuestion); setChatOpen(true) }}
                      className="text-dragon hover:underline"
                    >
                      Ask the model with your own key
                    </button>{' '}
                    - it answers with citations from the index.
                  </p>
                )}
                <div className="mt-2 border-t border-line pt-2">
                  {rated ? (
                    <p className="text-[11px] text-ink-3">
                      Noted as {rated === 'deadend' ? 'a dead end' : rated === 'corrected' ? 'corrected' : 'useful'} - feedback steers future answers.
                    </p>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-ink-3">Rate this answer:</span>
                      <button
                        onClick={() => void rate('useful')}
                        title="Useful answer - these nodes rank earlier next time"
                        className="rounded border border-line px-1.5 py-0.5 text-[10px] font-semibold text-ink-2 hover:border-emerald-500 hover:text-emerald-400"
                      >
                        ✓ Useful
                      </button>
                      <button
                        onClick={() => void rate('deadend')}
                        title="Dead end - these nodes sink next time"
                        className="rounded border border-line px-1.5 py-0.5 text-[10px] font-semibold text-ink-2 hover:border-error hover:text-error"
                      >
                        ✕ Dead end
                      </button>
                      <button
                        onClick={() => setCorrecting((v) => !v)}
                        title="The answer is wrong - say what it should have said"
                        className="rounded border border-line px-1.5 py-0.5 text-[10px] font-semibold text-ink-2 hover:border-amber-500 hover:text-amber-400"
                      >
                        ✎ Correct
                      </button>
                    </div>
                  )}
                  {correcting && !rated && (
                    <div className="mt-1.5">
                      <textarea
                        value={correctionText}
                        onChange={(e) => setCorrectionText(e.target.value)}
                        rows={2}
                        className="w-full rounded border border-line bg-surface-2 px-2 py-1 text-[11px] text-ink outline-none focus:border-dragon"
                        placeholder="What should the answer have said?"
                      />
                      <div className="mt-1 flex justify-end">
                        <button
                          onClick={() => void rate('corrected')}
                          disabled={!correctionText.trim()}
                          className="rounded bg-dragon px-2 py-0.5 text-[10px] font-semibold text-night disabled:opacity-50"
                        >
                          Save correction
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          <p className="pointer-events-none absolute bottom-4 left-4 max-w-md rounded-lg border border-line bg-surface-1/90 px-3 py-2 text-xs text-ink-3">
            Top-level modules. Node size and number show file count; solid arrows are imports, dashed arrows are calls. Drag to pan, scroll to zoom, click the minimap to jump. Double-click a module to expand its files.
            Click a module to list its files.
          </p>
        </main>

        {selected && (
          <aside
            className="relative flex shrink-0 flex-col border-l border-line bg-surface-1 max-sm:absolute max-sm:inset-x-0 max-sm:bottom-0 max-sm:max-h-[55%] max-sm:w-full max-sm:rounded-t-xl max-sm:border-t"
            style={{ width: panelWidth }}
          >
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize panel"
              aria-valuenow={Math.round(panelWidth)}
              aria-valuemin={280}
              aria-valuemax={860}
              tabIndex={0}
              className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize hover:bg-dragon/40 focus-visible:bg-dragon/60 max-sm:hidden"
              onPointerDown={(e) => {
                resizeRef.current = { startX: e.clientX, startWidth: panelWidth }
                e.currentTarget.setPointerCapture(e.pointerId)
              }}
              onPointerMove={(e) => {
                const drag = resizeRef.current
                if (!drag) return
                applyWidth(drag.startWidth + (drag.startX - e.clientX))
              }}
              onPointerUp={() => {
                resizeRef.current = null
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft') applyWidth(panelWidth + 24)
                if (e.key === 'ArrowRight') applyWidth(panelWidth - 24)
              }}
            />
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-ink">{selected.name}</h2>
                <p className="text-xs text-ink-3">
                  {selected.fileCount} files · {selected.symbolCount} symbols
                </p>
              </div>
              <button
                onClick={() => {
                  setSelectedModule(null)
                  setOpenFile(null)
                }}
                className="text-ink-3 hover:text-ink"
                aria-label="Close panel"
              >
                ✕
              </button>
            </div>
            {openFile ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <button
                  onClick={() => setOpenFile(null)}
                  className="border-b border-line px-4 py-2 text-left text-xs text-ink-3 hover:text-ink"
                >
                  ← {selected.name} files
                </button>
                <p className="border-b border-line px-4 py-2 font-mono text-xs text-ink-3">
                  {openFile.path.split('/').map((seg, i, arr) => (
                    <span key={i}>
                      {i > 0 && <span className="text-ink-3"> / </span>}
                      <span className={i === arr.length - 1 ? 'text-ink' : undefined}>{seg}</span>
                    </span>
                  ))}
                  <span className="ml-2 text-ink-3">@ {repo.commit.slice(0, 7)}</span>
                </p>
                <div className="flex items-center gap-2 border-b border-line px-4 py-1.5">
                  <button
                    onClick={() => setOutlineOpen((v) => !v)}
                    className={`rounded border px-2 py-0.5 text-xs ${outlineOpen ? 'border-dragon text-dragon' : 'border-line text-ink-3 hover:text-ink'}`}
                  >
                    Outline
                  </button>
                  <button
                    onClick={() => setImpactTarget(openFile.id)}
                    title="What breaks if this file changes"
                    className={`rounded border px-2 py-0.5 text-xs ${impactTarget === openFile.id ? 'border-dragon text-dragon' : 'border-line text-ink-3 hover:text-ink'}`}
                  >
                    Impact
                  </button>
                  <input
                    ref={fileSearchRef}
                    value={fileQuery}
                    onChange={(e) => setFileQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && fileMatches.length > 0) setPendingLine(fileMatches[0])
                    }}
                    placeholder="Find in file"
                    aria-label="Find in file"
                    className="min-w-0 flex-1 rounded border border-line bg-surface-2 px-2 py-0.5 font-mono text-xs text-ink placeholder:text-ink-3 focus:border-dragon focus:outline-none"
                  />
                  {fileQuery.trim().length >= 2 && (
                    <span className="shrink-0 text-xs text-ink-3">{fileMatches.length} {fileMatches.length === 1 ? 'match' : 'matches'}</span>
                  )}
                </div>
                {outlineOpen && (
                  <div className="max-h-56 overflow-auto border-b border-line px-4 py-2">
                    {openFileSymbols.length > 0 && (
                      <>
                        <p className="pb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">Symbols</p>
                        <ul>
                          {openFileSymbols.map((sym) => (
                            <li key={sym.id} className="flex items-center gap-1">
                              <button
                                onClick={() => setPendingLine(sym.startLine)}
                                className="w-full truncate rounded px-1.5 py-0.5 text-left font-mono text-xs text-ink-2 hover:bg-surface-2 hover:text-ink"
                              >
                                <span className="text-dragon">{sym.kind}</span> {sym.name}
                                <span className="text-ink-3"> :{sym.startLine}</span>
                              </button>
                              <button
                                onClick={() => setImpactTarget(sym.id)}
                                title={`Impact of changing ${sym.name}`}
                                aria-label={`Impact of changing ${sym.name}`}
                                className={`shrink-0 rounded border px-1 py-0 text-[10px] ${impactTarget === sym.id ? 'border-dragon text-dragon' : 'border-line text-ink-3 hover:text-ink'}`}
                              >
                                ⚡
                              </button>
                              <button
                                onClick={() => setFlowTarget(sym.id)}
                                title={`Call flow around ${sym.name}`}
                                aria-label={`Call flow around ${sym.name}`}
                                className={`shrink-0 rounded border px-1 py-0 text-[10px] ${flowTarget === sym.id ? 'border-dragon text-dragon' : 'border-line text-ink-3 hover:text-ink'}`}
                              >
                                ⇄
                              </button>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    {openFileImports.length > 0 && (
                      <>
                        <p className="pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Imports</p>
                        <ul>
                          {openFileImports.map((target) => (
                            <li key={target.id}>
                              <button
                                onClick={() => openCitation(target.path, 1)}
                                className="w-full truncate rounded px-1.5 py-0.5 text-left font-mono text-xs text-dragon hover:bg-surface-2"
                              >
                                {target.path}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    {openFileDependents.length > 0 && (
                      <>
                        <p className="pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Imported by</p>
                        <ul>
                          {openFileDependents.map((dep) => (
                            <li key={dep.id}>
                              <button
                                onClick={() => openCitation(dep.path, 1)}
                                className="w-full truncate rounded px-1.5 py-0.5 text-left font-mono text-xs text-dragon hover:bg-surface-2"
                              >
                                {dep.path}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    {openFileCalls.length > 0 && (
                      <>
                        <p className="pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Calls</p>
                        <ul>
                          {openFileCalls.map((call) => (
                            <li key={`${call.name}@${call.path}`}>
                              <button
                                onClick={() => openCitation(call.path, call.line)}
                                className="w-full truncate rounded px-1.5 py-0.5 text-left font-mono text-xs text-ink-2 hover:bg-surface-2 hover:text-ink"
                              >
                                {call.name} <span className="text-ink-3">{call.path}{call.line != null ? `:${call.line}` : ''}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    {openFilePackages.length > 0 && (
                      <>
                        <p className="pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-ink-3">External packages</p>
                        <p className="px-1.5 font-mono text-xs text-ink-3">{openFilePackages.join(', ')}</p>
                      </>
                    )}
                    {openFileSymbols.length === 0 && openFileImports.length === 0 && openFileDependents.length === 0 && openFileCalls.length === 0 && (
                      <p className="text-xs text-ink-3">No symbols or dependencies in this file.</p>
                    )}
                  </div>
                )}
                <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
                  <pre className="w-max min-w-full font-mono text-xs leading-5 text-ink-2">
                    {(highlighted ?? openFile.text.split('\n').map((line) => [{ text: line, color: '#B8A8D9' }])).map((segments, i) => (
                      <div key={i} id={`L${i + 1}`} className={pendingLine === i + 1 ? 'flex bg-dragon/15' : 'flex'}>
                        <span className="tabular sticky left-0 w-10 shrink-0 select-none bg-surface-1 pr-3 text-right text-ink-3">{i + 1}</span>
                        <span className="whitespace-pre pl-2">
                          {segments.length > 0
                            ? segments.map((seg, j) => (
                                <span key={j} style={{ color: seg.color }}>
                                  {seg.text}
                                </span>
                              ))
                            : ' '}
                        </span>
                      </div>
                    ))}
                  </pre>
                </div>
              </div>
            ) : (
              <ul className="min-h-0 flex-1 overflow-auto px-2 py-2">
                {selected.files.map((file) => (
                  <li key={file.id}>
                    <button
                      onClick={() => {
                        setOpenFile(file)
                        setPendingLine(null)
                      }}
                      className="w-full truncate rounded-md px-2 py-1.5 text-left font-mono text-xs text-ink-2 hover:bg-surface-2 hover:text-ink"
                    >
                      {file.path.split('/').slice(1).join('/')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        )}
      </div>
      <SearchPalette
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        search={runSearch}
        onOpenFile={openSearchFile}
        onOpenModule={openSearchModule}
      />
    </div>
  )
}
