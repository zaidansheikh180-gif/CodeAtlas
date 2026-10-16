// Diff between the file list a fresh tree fetch wants and the files already
// stored by a previous index, so a re-index only downloads what changed.
// FileRec.contentHash holds the git blob sha from the tree, which is exactly
// what the new tree returns - identical sha means identical content.

export interface WantedFile {
  path: string
  sha: string
}

export interface StoredFileRef {
  path: string
  contentHash: string
}

export interface IncrementalDiff {
  // Paths that must be downloaded: new files and files whose blob sha changed.
  toDownload: string[]
  // Paths whose stored text can be reused unchanged (same blob sha).
  reusable: string[]
  // Stored paths that no longer exist upstream (or no longer pass the filter).
  removed: number
}

export function diffWanted(wanted: WantedFile[], stored: StoredFileRef[]): IncrementalDiff {
  const storedByPath = new Map(stored.map((file) => [file.path, file.contentHash]))
  const toDownload: string[] = []
  const reusable: string[] = []
  const seen = new Set<string>()
  for (const file of wanted) {
    seen.add(file.path)
    const oldHash = storedByPath.get(file.path)
    if (oldHash !== undefined && oldHash === file.sha && file.sha !== '') reusable.push(file.path)
    else toDownload.push(file.path)
  }
  const removed = stored.filter((file) => !seen.has(file.path)).length
  return { toDownload, reusable, removed }
}
