import { describe, expect, it } from 'bun:test'
import {
  classifyChanges,
  diffManifest,
  hashText,
  type LocalManifestEntry,
  type WalkedFile,
} from './localfolder'
import { startLocalWatch, type WatchState } from './localwatch'

// Fake File System Access handles over an in-memory file map - enough of the
// surface (values/getFile/queryPermission) for the walker and the session.
type FakeFile = { content: string; mtime: number }

function fakeDir(files: Record<string, FakeFile>, perm: () => PermissionState = () => 'granted') {
  return {
    kind: 'directory',
    name: 'fake',
    values: async function* () {
      for (const [name, f] of Object.entries(files)) {
        yield {
          kind: 'file',
          name,
          getFile: async () => new File([f.content], name, { lastModified: f.mtime }),
        }
      }
    },
    queryPermission: async () => perm(),
    requestPermission: async () => perm(),
  } as unknown as FileSystemDirectoryHandle
}

const walkedOf = (files: Record<string, FakeFile>): WalkedFile[] =>
  Object.entries(files).map(([path, f]) => ({ path, size: f.content.length, lastModified: f.mtime }))

describe('diffManifest', () => {
  const m = (path: string, size = 1, lastModified = 1, sha = 's'): LocalManifestEntry => ({ path, size, lastModified, sha })

  it('partitions walked files into added, candidates and unchanged', () => {
    const manifest = [m('a.ts', 10, 100), m('b.ts', 20, 100)]
    const walked: WalkedFile[] = [
      { path: 'a.ts', size: 10, lastModified: 100 },
      { path: 'b.ts', size: 20, lastModified: 200 },
      { path: 'c.ts', size: 1, lastModified: 1 },
    ]
    const diff = diffManifest(manifest, walked)
    expect(diff.unchanged.map((w) => w.path)).toEqual(['a.ts'])
    expect(diff.candidates.map((w) => w.path)).toEqual(['b.ts'])
    expect(diff.added.map((w) => w.path)).toEqual(['c.ts'])
    expect(diff.removed).toEqual([])
  })

  it('marks manifest paths missing from the walk as removed', () => {
    const diff = diffManifest([m('gone.ts')], [])
    expect(diff.removed.map((e) => e.path)).toEqual(['gone.ts'])
  })
})

describe('classifyChanges', () => {
  it('treats a hash match as touched and a hash mismatch as modified', async () => {
    const old = 'hello'
    const manifest: LocalManifestEntry[] = [
      { path: 'a.ts', size: old.length, lastModified: 100, sha: await hashText(old) },
      { path: 'b.ts', size: 3, lastModified: 100, sha: await hashText('bbb') },
    ]
    const walked: WalkedFile[] = [
      { path: 'a.ts', size: old.length, lastModified: 200 },
      { path: 'b.ts', size: 3, lastModified: 200 },
    ]
    const diff = diffManifest(manifest, walked)
    const reads = new Map([
      ['a.ts', { sha: await hashText(old) }],
      ['b.ts', { sha: await hashText('ccc') }],
    ])
    const cls = classifyChanges(diff, manifest, reads)
    expect(cls.touched.map((w) => w.path)).toEqual(['a.ts'])
    expect(cls.modified.map((w) => w.path)).toEqual(['b.ts'])
  })

  it('detects a rename when an added file matches a removed sha and size', async () => {
    const text = 'renamed content'
    const s = await hashText(text)
    const manifest: LocalManifestEntry[] = [{ path: 'old.ts', size: text.length, lastModified: 100, sha: s }]
    const walked: WalkedFile[] = [{ path: 'new.ts', size: text.length, lastModified: 5 }]
    const diff = diffManifest(manifest, walked)
    const cls = classifyChanges(diff, manifest, new Map([['new.ts', { sha: s }]]))
    expect(cls.renamed.map((r) => `${r.from}->${r.to.path}`)).toEqual(['old.ts->new.ts'])
    expect(cls.stillAdded).toEqual([])
    expect(cls.stillRemoved).toEqual([])
  })
})

describe('startLocalWatch', () => {
  const manifestFor = async (files: Record<string, FakeFile>): Promise<LocalManifestEntry[]> =>
    Promise.all(
      Object.entries(files).map(async ([path, f]) => ({
        path,
        size: f.content.length,
        lastModified: f.mtime,
        sha: await hashText(f.content),
      })),
    )

  it('stays quiet on unchanged scans and updates after a change plus a quiet scan', async () => {
    const files: Record<string, FakeFile> = { 'a.ts': { content: 'export const a = 1', mtime: 1000 } }
    const updates: { entries: number; modified: string[] }[] = []
    const session = startLocalWatch({
      handle: fakeDir(files),
      manifest: await manifestFor(files),
      onState: () => {},
      onChanges: () => {},
      runUpdate: async (entries, summary) => {
        updates.push({ entries: entries.length, modified: summary.modified })
        return { ok: true }
      },
    })

    await session.tick() // joins the initial baseline scan
    await session.tick()
    expect(updates).toEqual([]) // quiet scans: nothing changed
    expect(session.state.kind).toBe('watching')

    files['a.ts'] = { content: 'export const a = 2', mtime: 2000 }
    await session.tick() // detects the change, starts the debounce
    expect(updates).toEqual([])
    expect(session.pending?.modified).toEqual(['a.ts'])
    await session.tick() // quiet scan ends the debounce and fires
    expect(updates).toEqual([{ entries: 1, modified: ['a.ts'] }])
    expect(session.state.kind).toBe('watching')
    expect(session.pending).toBeNull()

    // The adopted manifest is the new baseline: another scan is quiet.
    await session.tick()
    expect(updates).toHaveLength(1)
    session.stop()
  })

  it('detects additions and deletions in the same update', async () => {
    const files: Record<string, FakeFile> = { 'a.ts': { content: 'a', mtime: 1 }, 'b.ts': { content: 'b', mtime: 1 } }
    const summaries: { added: string[]; removed: string[] }[] = []
    const session = startLocalWatch({
      handle: fakeDir(files),
      manifest: await manifestFor(files),
      onState: () => {},
      onChanges: () => {},
      runUpdate: async (_entries, summary) => {
        summaries.push({ added: summary.added, removed: summary.removed })
        return { ok: true }
      },
    })
    await session.tick() // baseline
    delete files['b.ts']
    files['c.ts'] = { content: 'c', mtime: 5 }
    await session.tick() // detect
    await session.tick() // quiet -> fire
    expect(summaries).toEqual([{ added: ['c.ts'], removed: ['b.ts'] }])
    session.stop()
  })

  it('re-detects and retries the update when the pipeline run fails', async () => {
    const files: Record<string, FakeFile> = { 'a.ts': { content: 'v1', mtime: 1 } }
    let calls = 0
    const session = startLocalWatch({
      handle: fakeDir(files),
      manifest: await manifestFor(files),
      onState: () => {},
      onChanges: () => {},
      runUpdate: async () => {
        calls += 1
        return calls === 1 ? { ok: false, error: 'boom' } : { ok: true }
      },
    })
    await session.tick() // baseline
    files['a.ts'] = { content: 'v2', mtime: 2 }
    await session.tick() // detect
    await session.tick() // fire -> fails, keeps watching
    expect(calls).toBe(1)
    expect(session.state.kind).toBe('watching')
    await session.tick() // re-detect against the old manifest
    await session.tick() // quiet -> retry fires
    expect(calls).toBe(2)
    expect(session.pending).toBeNull()
    session.stop()
  })

  it('moves to needs-permission when the browser asks, and resumes on allow()', async () => {
    const files: Record<string, FakeFile> = { 'a.ts': { content: 'a', mtime: 1 } }
    let perm: PermissionState = 'prompt'
    const states: WatchState['kind'][] = []
    const session = startLocalWatch({
      handle: fakeDir(files, () => perm),
      manifest: await manifestFor(files),
      onState: (s) => states.push(s.kind),
      onChanges: () => {},
      runUpdate: async () => ({ ok: true }),
    })
    await session.tick()
    expect(session.state.kind).toBe('needs-permission')
    perm = 'granted'
    await session.allow()
    expect(session.state.kind).toBe('watching')
    expect(states).toContain('needs-permission')
    session.stop()
  })

  it('stops as denied when permission is revoked', async () => {
    const files: Record<string, FakeFile> = { 'a.ts': { content: 'a', mtime: 1 } }
    const session = startLocalWatch({
      handle: fakeDir(files, () => 'denied'),
      manifest: await manifestFor(files),
      onState: () => {},
      onChanges: () => {},
      runUpdate: async () => ({ ok: true }),
    })
    await session.tick()
    expect(session.state.kind).toBe('denied')
  })
})
