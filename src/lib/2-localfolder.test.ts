import { describe, expect, test } from 'bun:test'
import { hashText, isLocalRepoUrl, localRepoUrl, readLocalEntries, walkLocalFolder } from './localfolder'

// Fake File System Access handles: plain objects with the two surface areas
// the walk uses - kind/name on entries, values() on directories, getFile()
// on files. This mirrors exactly what the browser API returns.
function fakeFile(name: string, text: string, lastModified = 1000) {
  return {
    kind: 'file' as const,
    name,
    getFile: async () => new File([text], name, { lastModified }),
  }
}
function fakeDir(name: string, children: ReturnType<typeof fakeFile> | (ReturnType<typeof fakeFile> | ReturnType<typeof fakeDir>)[]) {
  return {
    kind: 'directory' as const,
    name,
    values: async function* () {
      for (const child of children) yield child
    },
  }
}

describe('walkLocalFolder', () => {
  test('enumerates files recursively with relative POSIX paths', async () => {
    const root = fakeDir('app', [
      fakeDir('src', [fakeFile('index.ts', 'a'), fakeFile('util.ts', 'bb')]),
      fakeFile('readme.md', 'ccc'),
    ]) as unknown as FileSystemDirectoryHandle
    const walked = await walkLocalFolder(root)
    expect(walked.map((w) => w.path)).toEqual(['src/index.ts', 'src/util.ts', 'readme.md'])
    expect(walked.map((w) => w.size)).toEqual([1, 2, 3])
    expect(walked[0].lastModified).toBe(1000)
  })

  test('prunes hidden and vendored directories before enumerating them', async () => {
    const root = fakeDir('app', [
      fakeDir('node_modules', [fakeFile('dep.js', 'x')]),
      fakeDir('.git', [fakeFile('HEAD', 'x')]),
      fakeDir('dist', [fakeFile('bundle.js', 'x')]),
      fakeDir('src', [fakeFile('index.ts', 'x')]),
    ]) as unknown as FileSystemDirectoryHandle
    const walked = await walkLocalFolder(root)
    expect(walked.map((w) => w.path)).toEqual(['src/index.ts'])
  })

  test('reports a live count while walking', async () => {
    const root = fakeDir('app', [fakeFile('a.ts', 'x'), fakeFile('b.ts', 'x'), fakeFile('c.ts', 'x')]) as unknown as FileSystemDirectoryHandle
    const counts: number[] = []
    await walkLocalFolder(root, (count) => counts.push(count))
    expect(counts).toEqual([1, 2, 3])
  })
})

describe('readLocalEntries', () => {
  test('reads text and computes a stable content hash per file', async () => {
    const walked = await walkLocalFolder(fakeDir('app', [fakeFile('a.ts', 'hello'), fakeFile('b.ts', 'hello')]) as unknown as FileSystemDirectoryHandle)
    const entries = await readLocalEntries(walked)
    expect(entries).toHaveLength(2)
    expect(entries[0].text).toBe('hello')
    // Same content hashes identically - this is what part 2's re-scan diff
    // relies on.
    expect(entries[0].sha).toBe(entries[1].sha)
    expect(entries[0].sha).toMatch(/^[0-9a-f]{64}$/)
    // Different content hashes differently.
    const other = await readLocalEntries(await walkLocalFolder(fakeDir('app', [fakeFile('c.ts', 'world')]) as unknown as FileSystemDirectoryHandle))
    expect(other[0].sha).not.toBe(entries[0].sha)
  })
})

describe('hashText', () => {
  test('matches the known SHA-256 of an empty string', async () => {
    expect(await hashText('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })
})

describe('local repo urls', () => {
  test('round trip and detection', () => {
    expect(localRepoUrl('my-app')).toBe('local:my-app')
    expect(isLocalRepoUrl('local:my-app')).toBe(true)
    expect(isLocalRepoUrl('https://github.com/owner/repo')).toBe(false)
  })
})
