// Local folder handles (phase 8). Real FileSystemDirectoryHandles are
// structured-cloneable and can persist in IndexedDB (Chrome), which lets a
// stored handle survive a reload. But a handle is still a live capability:
// some environments cannot clone one, and a persisted handle can lose its
// permission. So the handle lives in two places:
//   1. this session registry - always populated when a folder is picked,
//      never serialized, always safe;
//   2. the repo record in IndexedDB - best effort, for reload persistence.
// Callers resolve a handle from the record first, then the registry.

import { getRepo, putRepo } from './db'

const sessionHandles = new Map<string, FileSystemDirectoryHandle>()

export function registerLocalHandle(repoId: string, handle: FileSystemDirectoryHandle): void {
  sessionHandles.set(repoId, handle)
}

export function getLocalHandle(repoId: string): FileSystemDirectoryHandle | undefined {
  return sessionHandles.get(repoId)
}

// Persist a handle on the repo record so watch mode survives a reload where
// the browser supports it. A handle that cannot be structured-cloned simply
// skips persistence - the session registry above still covers this session.
export async function persistLocalHandle(repoId: string, handle: FileSystemDirectoryHandle): Promise<void> {
  registerLocalHandle(repoId, handle)
  try {
    const rec = await getRepo(repoId)
    if (rec) await putRepo({ ...rec, localHandle: handle })
  } catch {
    // Not cloneable here - session registry only.
  }
}
