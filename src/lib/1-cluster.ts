// Graph clustering (phase 5): deterministic greedy modularity (CNM-style)
// over the file-level connectivity graph (imports plus calls resolved to
// files). Label propagation was tried first and dropped: its async label
// cascade floods across weak bridges, merging distinct communities. Greedy
// modularity merging is stable, deterministic (ties break to the smallest
// community pair) and cheap at repository scale. No LLM, no randomness.
// Unit tested directly; runs inside the search worker so large repositories
// stay responsive.

import type { EdgeRec, FileRec, SymbolRec } from './types'

export interface CommunityStat {
  // Deterministic identity: the smallest member file id. Stable across runs
  // on the same graph, which is what makes persisted labels stick.
  id: string
  // 1-based position in the size-ordered community list (labels UI).
  index: number
  fileIds: string[]
  fileCount: number
  internalEdges: number
  externalEdges: number
  mainLanguage: string | null
  hubs: { id: string; path: string; degree: number }[]
  // Evidence for naming: the most common leading directories among members.
  topPaths: string[]
}

export interface ClusterResult {
  assign: Map<string, string> // fileId -> communityId
  communities: CommunityStat[]
}

export function clusterFiles(files: FileRec[], symbols: SymbolRec[], edges: EdgeRec[]): ClusterResult {
  const fileIds = files.map((f) => f.id).sort()
  const fileSet = new Set(fileIds)
  const symToFile = new Map(symbols.map((s) => [s.id, s.fileId] as const))
  const pathOf = new Map(files.map((f) => [f.id, f.path] as const))

  // Undirected adjacency with per-neighbor weights (deduplicated pairs).
  const pairWeight = new Map<string, number>()
  const resolve = (id: string) => (fileSet.has(id) ? id : symToFile.get(id))
  for (const e of edges) {
    if (e.type !== 'imports' && e.type !== 'calls') continue
    const a = resolve(e.fromId)
    const b = resolve(e.toId)
    if (!a || !b || a === b || !fileSet.has(a) || !fileSet.has(b)) continue
    const key = a < b ? `${a}|${b}` : `${b}|${a}`
    pairWeight.set(key, (pairWeight.get(key) ?? 0) + 1)
  }
  const neighbors = new Map<string, Map<string, number>>()
  const degree = new Map<string, number>()
  for (const [key, w] of pairWeight) {
    const [a, b] = key.split('|')
    if (!neighbors.has(a)) neighbors.set(a, new Map())
    if (!neighbors.has(b)) neighbors.set(b, new Map())
    neighbors.get(a)!.set(b, (neighbors.get(a)!.get(b) ?? 0) + w)
    neighbors.get(b)!.set(a, (neighbors.get(b)!.get(a) ?? 0) + w)
    degree.set(a, (degree.get(a) ?? 0) + w)
    degree.set(b, (degree.get(b) ?? 0) + w)
  }

  // Greedy modularity: start every file as a singleton community, then
  // repeatedly merge the connected community pair with the largest positive
  // modularity gain, ties to the smallest pair key. Communities are keyed by
  // their smallest member id throughout, so identities stay deterministic.
  const totalWeight = [...pairWeight.values()].reduce((a, b) => a + b, 0)
  const communityOf = new Map<string, string>(fileIds.map((id) => [id, id]))
  const members = new Map<string, Set<string>>(fileIds.map((id) => [id, new Set([id])]))
  const tot = new Map<string, number>(fileIds.map((id) => [id, degree.get(id) ?? 0]))
  // Weight between communities, keyed by sorted pair.
  const commWeight = new Map<string, number>()
  for (const [key, w] of pairWeight) commWeight.set(key, w)

  for (let step = 0; step < fileIds.length; step++) {
    let bestKey: string | null = null
    let bestGain = 1e-12
    for (const [key, eAB] of [...commWeight.entries()].sort()) {
      const [A, B] = key.split('|')
      const gain = eAB / totalWeight - (tot.get(A)! * tot.get(B)!) / (2 * totalWeight * totalWeight)
      if (gain > bestGain) {
        bestGain = gain
        bestKey = key
      }
    }
    if (!bestKey) break
    const [A, B] = bestKey.split('|') // merge B into A (A < B by key order)
    for (const m of members.get(B)!) {
      members.get(A)!.add(m)
      communityOf.set(m, A)
    }
    members.delete(B)
    tot.set(A, tot.get(A)! + tot.get(B)!)
    tot.delete(B)
    // Rewire B's pair weights into A.
    for (const [key, w] of [...commWeight.entries()]) {
      const [x, y] = key.split('|')
      if (x !== B && y !== B) continue
      const other = x === B ? y : x
      commWeight.delete(key)
      if (other === A) continue
      const nKey = other < A ? `${other}|${A}` : `${A}|${other}`
      commWeight.set(nKey, (commWeight.get(nKey) ?? 0) + w)
    }
  }

  // Group and re-key communities by their smallest member id.
  const groups = new Map<string, string[]>()
  for (const id of fileIds) {
    const key = communityOf.get(id)!
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(id)
  }
  const assign = new Map<string, string>()
  const communities: CommunityStat[] = []
  for (const members of groups.values()) {
    members.sort()
    const id = members[0]
    for (const m of members) assign.set(m, id)
    const memberSet = new Set(members)
    let internalEdges = 0
    let externalEdges = 0
    for (const [key, w] of pairWeight) {
      const [a, b] = key.split('|')
      const ain = memberSet.has(a)
      const bin = memberSet.has(b)
      if (ain && bin) internalEdges += w
      else if (ain || bin) externalEdges += w
    }
    const langCount = new Map<string, number>()
    const dirCount = new Map<string, number>()
    for (const m of members) {
      const f = files.find((x) => x.id === m)!
      if (f.language) langCount.set(f.language, (langCount.get(f.language) ?? 0) + 1)
      const seg = f.path.split('/')
      const dir = seg.length > 1 ? seg[0] : '(root)'
      dirCount.set(dir, (dirCount.get(dir) ?? 0) + 1)
    }
    const pickTop = (map: Map<string, number>, n: number) =>
      [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n)
    const hubs = members
      .map((m) => ({ id: m, path: pathOf.get(m)!, degree: degree.get(m) ?? 0 }))
      .sort((a, b) => b.degree - a.degree || a.path.localeCompare(b.path))
      .slice(0, 3)
      .filter((h) => h.degree > 0)
    const topLang = pickTop(langCount, 1)
    communities.push({
      id,
      index: 0, // assigned after sorting below
      fileIds: members,
      fileCount: members.length,
      internalEdges,
      externalEdges,
      mainLanguage: topLang.length > 0 ? topLang[0][0] : null,
      hubs,
      topPaths: pickTop(dirCount, 2).map(([dir]) => dir),
    })
  }
  communities.sort((a, b) => b.fileCount - a.fileCount || a.id.localeCompare(b.id))
  communities.forEach((c, i) => {
    c.index = i + 1
  })
  return { assign, communities }
}

// Deterministic placeholder label: "Community N" by size rank. Manual and
// model-generated labels (later phase) layer on top, keyed by community id.
export function placeholderLabel(stat: CommunityStat): string {
  return `Community ${stat.index}`
}
