// Local folder indexing (phase 8, spec-2 section 24): index a folder on this
// device with the File System Access API instead of a GitHub URL. The main
// thread walks the picked directory, reads file texts (the same size caps as
// GitHub indexing apply), and hands the entries to the same indexing worker,
// so filtering, secret scanning, parsing and graph building are identical.
// Nothing is uploaded anywhere - local files never leave the device.
//
// File texts travel with the entries instead of file handles because plain
// handles cannot always be structured-cloned with their methods, and the
// text-carrying shape doubles as the part-2 watch re-scan protocol: unchanged
// files arrive with their previous content hash and no text, changed files
// with fresh text.

import { isSkippedDirName } from './filter'

// The File System Access picker's Window binding is not in the standard DOM
// lib yet; declare the one method we use.
declare global {
  interface Window {
    showDirectoryPicker?: (options?: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>
  }
  // The async-iteration side of the File System Access API is not in this
  // TypeScript's DOM lib yet; declare the one method the walk uses.
  interface FileSystemDirectoryHandle {
    values(): AsyncIterableIterator<FileSystemDirectoryHandle | FileSystemFileHandle>
  }
}

export interface LocalFileEntry {
  path: string // relative POSIX path inside the picked folder
  size: number
  lastModified: number
  // Content hash (SHA-256 hex) - freshly computed when text is present,
  // carried over from the previous index when the file is unchanged.
  sha: string
  text?: string
}

export function supportsLocalFolders(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'
}

// Opens the native directory picker. Returns null when unsupported or when
// the user cancels - both are normal outcomes, not errors.
export async function pickLocalFolder(): Promise<FileSystemDirectoryHandle | null> {
  if (!supportsLocalFolders()) return null
  try {
    return await window.showDirectoryPicker!({ id: 'codeatlas-local', mode: 'read' })
  } catch {
    return null
  }
}

// Guard against a pathological folder (a home directory or worse): the walk
// stops past this many enumerated entries and reports what it has.
export const MAX_WALK_ENTRIES = 200_000

// Recursively enumerate the folder. Directories the pipeline would filter
// anyway (node_modules, dist, .git, hidden dirs) are pruned before
// enumerating them. onEntry fires per file found so the UI can show a live
// count while large folders enumerate.
export async function walkLocalFolder(
  dir: FileSystemDirectoryHandle,
  onEntry?: (count: number) => void,
  prefix = '',
  out: { path: string; size: number; lastModified: number; handle: FileSystemFileHandle }[] = [],
): Promise<{ path: string; size: number; lastModified: number; handle: FileSystemFileHandle }[]> {
  for await (const entry of dir.values()) {
    if (out.length >= MAX_WALK_ENTRIES) break
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.kind === 'directory') {
      if (entry.name.startsWith('.') || isSkippedDirName(entry.name)) continue
      await walkLocalFolder(entry as FileSystemDirectoryHandle, onEntry, path, out)
    } else if (entry.kind === 'file') {
      const file = await (entry as FileSystemFileHandle).getFile()
      out.push({ path, size: file.size, lastModified: file.lastModified, handle: entry as FileSystemFileHandle })
      onEntry?.(out.length)
    }
  }
  return out
}

export async function hashText(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Read every walked file's text and compute its content hash. The worker
// applies the same filters and caps as a GitHub index, so reads stay within
// the same budget.
export async function readLocalEntries(
  walked: { path: string; size: number; lastModified: number; handle: FileSystemFileHandle }[],
  onProgress?: (done: number, total: number) => void,
): Promise<LocalFileEntry[]> {
  const entries: LocalFileEntry[] = []
  let done = 0
  for (const item of walked) {
    const file = await item.handle.getFile()
    const text = await file.text()
    entries.push({ path: item.path, size: item.size, lastModified: item.lastModified, sha: await hashText(text), text })
    done++
    if (done % 20 === 0 || done === walked.length) onProgress?.(done, walked.length)
  }
  return entries
}

export function localRepoUrl(folderName: string): string {
  return `local:${folderName}`
}

export function isLocalRepoUrl(url: string): boolean {
  return url.startsWith('local:')
}
