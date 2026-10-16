// IndexedDB layer. All CodeAtlas state lives in the visitor's browser; nothing
// is sent anywhere but GitHub and (later) the visitor's own model provider.
// Browser storage can be evicted under pressure, so this is a cache, not a
// durable store.

import { openDB, type IDBPDatabase } from 'idb'
import type { EdgeRec, FileRec, JobRec, RepoRec, SettingRec, SymbolRec } from './types'

const DB_NAME = 'codeatlas'
const DB_VERSION = 1

export type CodeAtlasDB = IDBPDatabase

let dbPromise: Promise<IDBPDatabase> | null = null

export function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const repos = db.createObjectStore('repos', { keyPath: 'id' })
        repos.createIndex('by-url', 'url')

        const files = db.createObjectStore('files', { keyPath: 'id' })
        files.createIndex('by-repo', 'repoId')
        files.createIndex('by-path', ['repoId', 'path'], { unique: true })

        const symbols = db.createObjectStore('symbols', { keyPath: 'id' })
        symbols.createIndex('by-repo', 'repoId')
        symbols.createIndex('by-file', 'fileId')
        symbols.createIndex('by-name', ['repoId', 'name'])

        const edges = db.createObjectStore('edges', { keyPath: 'id' })
        edges.createIndex('by-repo', 'repoId')
        edges.createIndex('by-from', 'fromId')
        edges.createIndex('by-to', 'toId')

        const jobs = db.createObjectStore('jobs', { keyPath: 'id' })
        jobs.createIndex('by-repo', 'repoId')

        // Phase 1 creates the full v1 store set so later phases add no
        // migrations; these stay empty until their phase ships.
        const chunks = db.createObjectStore('chunks', { keyPath: 'id' })
        chunks.createIndex('by-repo', 'repoId')
        chunks.createIndex('by-file', 'fileId')

        const conversations = db.createObjectStore('conversations', { keyPath: 'id' })
        conversations.createIndex('by-repo', 'repoId')

        const messages = db.createObjectStore('messages', { keyPath: 'id' })
        messages.createIndex('by-conversation', 'conversationId')

        for (const name of [
          'communities', 'graphMetrics', 'flows', 'rationaleNotes',
          'summaries', 'tours', 'analyses',
        ]) {
          const store = db.createObjectStore(name, { keyPath: 'id' })
          store.createIndex('by-repo', 'repoId')
        }

        db.createObjectStore('settings', { keyPath: 'key' })
      },
    })
  }
  return dbPromise
}

export async function putAll<T>(storeName: string, rows: T[]): Promise<void> {
  if (rows.length === 0) return
  const db = await getDB()
  const tx = db.transaction(storeName, 'readwrite')
  for (const row of rows) void tx.store.put(row)
  await tx.done
}

export async function countByRepo(storeName: string, repoId: string): Promise<number> {
  const db = await getDB()
  const keys = (await db.getAllKeysFromIndex(storeName, 'by-repo', repoId)) as string[]
  return keys.length
}

// True when a failed write hit the browser's storage quota. IndexedDB raises
// this as a DOMException named QuotaExceededError.
export function isQuotaError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'QuotaExceededError'
}

export async function getAllByRepo<T>(storeName: string, repoId: string): Promise<T[]> {
  const db = await getDB()
  return (await db.getAllFromIndex(storeName, 'by-repo', repoId)) as T[]
}

export async function getRepo(id: string): Promise<RepoRec | undefined> {
  const db = await getDB()
  return (await db.get('repos', id)) as RepoRec | undefined
}

export async function listRepos(): Promise<RepoRec[]> {
  const db = await getDB()
  const all = (await db.getAll('repos')) as RepoRec[]
  return all.sort((a, b) => b.indexedAt - a.indexedAt)
}

export async function deleteRepo(repoId: string): Promise<void> {
  const db = await getDB()
  for (const store of [
    'repos', 'files', 'symbols', 'edges', 'jobs', 'chunks',
    'conversations', 'messages', 'communities', 'graphMetrics', 'flows',
    'rationaleNotes', 'summaries', 'tours', 'analyses',
  ]) {
    const tx = db.transaction(store, 'readwrite')
    if (store === 'repos') {
      void tx.store.delete(repoId)
    } else if (store === 'messages') {
      // messages are keyed by conversation: delete them through the repo's
      // conversation ids so nothing orphaned survives eviction.
      const convTx = db.transaction('conversations', 'readonly')
      const conversationIds = (await convTx.store.index('by-repo').getAllKeys(repoId)) as string[]
      await convTx.done
      for (const conversationId of conversationIds) {
        const messageKeys = (await tx.store.index('by-conversation').getAllKeys(conversationId)) as string[]
        for (const key of messageKeys) void tx.store.delete(key)
      }
    } else {
      const keys = (await tx.store.index('by-repo').getAllKeys(repoId)) as string[]
      for (const key of keys) void tx.store.delete(key)
    }
    await tx.done
  }
}

export async function updateJob(job: JobRec): Promise<void> {
  const db = await getDB()
  await db.put('jobs', job)
}

export async function putRepo(repo: RepoRec): Promise<void> {
  const db = await getDB()
  await db.put('repos', repo)
}

export async function getSetting(key: string): Promise<string | null> {
  const db = await getDB()
  const row = (await db.get('settings', key)) as SettingRec | undefined
  return row?.value ?? null
}

export async function putSetting(key: string, value: string): Promise<void> {
  const db = await getDB()
  await db.put('settings', { key, value })
}

export function fileId(repoId: string, path: string): string {
  return `${repoId}:file:${path}`
}

export function symbolId(repoId: string, path: string, name: string, startLine: number): string {
  return `${repoId}:sym:${path}#${name}@${startLine}`
}

export function edgeId(repoId: string, fromId: string, toId: string, type: string): string {
  return `${repoId}:edge:${type}:${fromId}->${toId}`
}
