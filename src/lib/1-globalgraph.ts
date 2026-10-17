// Multi-repository global graph (phase 6, spec-2 section 19): one combined
// module map across every indexed repository. Node identity stays namespaced
// by repository ("is:source" vs "express:source") so nothing collides, every
// module keeps its repository's color (ownership is visible), and repositories
// can be filtered in and out. Where two repositories have a module with the
// same name, an optional dashed link connects them - that is what makes
// cross-repository paths meaningful at map scale. Module-level aggregation
// keeps even large multi-repo graphs small enough to render at once.

import { buildModules, MODULE_COLORS, type ModuleEdge, type ModuleNode } from './modules'
import type { EdgeRec, FileRec, RepoRec, SymbolRec } from './types'

export interface RepoGraphInput {
  repo: RepoRec
  files: FileRec[]
  symbols: SymbolRec[]
  edges: EdgeRec[]
}

export interface GlobalGraphData {
  modules: ModuleNode[]
  moduleEdges: ModuleEdge[]
  repoColors: Map<string, string>
  moduleColors: Map<string, string>
  stats: { repos: number; files: number; symbols: number; edges: number; modules: number }
}

export function repoShortName(fullName: string): string {
  return fullName.split('/').pop() ?? fullName
}

// Colors are assigned by position in the full indexed list (pass repoColors
// from the caller) so a repository keeps its color when others are filtered
// out. Without it, position in the included subset is used.
export function buildGlobalGraph(inputs: RepoGraphInput[], linkSharedModules: boolean, colors?: Map<string, string>): GlobalGraphData {
  // Repository tag for namespacing: the short name, falling back to the full
  // name when two indexed repositories share one (forks, same-name projects).
  const shorts = inputs.map((i) => repoShortName(i.repo.fullName))
  const tagOf = (i: number) => (shorts.indexOf(shorts[i]) === i ? shorts[i] : inputs[i].repo.fullName)

  const modules: ModuleNode[] = []
  const moduleEdges: ModuleEdge[] = []
  const repoColors = new Map<string, string>()
  const moduleColors = new Map<string, string>()
  let files = 0
  let symbols = 0
  let edges = 0

  inputs.forEach((input, index) => {
    const color = colors?.get(input.repo.id) ?? MODULE_COLORS[index % MODULE_COLORS.length]
    const tag = tagOf(index)
    repoColors.set(input.repo.id, color)
    const { modules: mods, moduleEdges: medges } = buildModules(input.files, input.symbols, input.edges)
    const rename = new Map<string, string>()
    for (const m of mods) {
      const name = `${tag}:${m.name}`
      rename.set(m.name, name)
      modules.push({ ...m, id: `module:${name}`, name })
      moduleColors.set(name, color)
    }
    for (const e of medges) {
      moduleEdges.push({ ...e, from: rename.get(e.from) ?? e.from, to: rename.get(e.to) ?? e.to })
    }
    files += input.files.length
    symbols += input.symbols.length
    edges += input.edges.length
  })

  // Cross-repository links where meaningful: same module name in two
  // repositories (is:source <-> express:source). Drawn as calls-kind dashed
  // arcs so they read as connections, not import structure.
  if (linkSharedModules) {
    const byBase = new Map<string, string[]>()
    for (const m of modules) {
      const base = m.name.slice(m.name.indexOf(':') + 1)
      const list = byBase.get(base) ?? []
      list.push(m.name)
      byBase.set(base, list)
    }
    for (const names of byBase.values()) {
      for (let i = 0; i < names.length; i++) {
        for (let j = i + 1; j < names.length; j++) {
          moduleEdges.push({ from: names[i], to: names[j], count: 1, kind: 'calls' })
        }
      }
    }
  }

  return { modules, moduleEdges, repoColors, moduleColors, stats: { repos: inputs.length, files, symbols, edges, modules: modules.length } }
}
