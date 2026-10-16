import { describe, expect, test } from 'bun:test'
import { diffWanted } from './incremental'

describe('diffWanted', () => {
  test('identical trees reuse everything', () => {
    const wanted = [
      { path: 'a.js', sha: '1' },
      { path: 'b.js', sha: '2' },
    ]
    const stored = [
      { path: 'a.js', contentHash: '1' },
      { path: 'b.js', contentHash: '2' },
    ]
    expect(diffWanted(wanted, stored)).toEqual({ toDownload: [], reusable: ['a.js', 'b.js'], removed: 0 })
  })

  test('changed sha and new paths download, untouched reuse', () => {
    const wanted = [
      { path: 'a.js', sha: '1' }, // unchanged
      { path: 'b.js', sha: '3' }, // changed
      { path: 'c.js', sha: '4' }, // new
    ]
    const stored = [
      { path: 'a.js', contentHash: '1' },
      { path: 'b.js', contentHash: '2' },
    ]
    const diff = diffWanted(wanted, stored)
    expect(diff.toDownload.sort()).toEqual(['b.js', 'c.js'])
    expect(diff.reusable).toEqual(['a.js'])
    expect(diff.removed).toBe(0)
  })

  test('stored paths missing upstream count as removed', () => {
    const wanted = [{ path: 'a.js', sha: '1' }]
    const stored = [
      { path: 'a.js', contentHash: '1' },
      { path: 'old.js', contentHash: '9' },
    ]
    expect(diffWanted(wanted, stored)).toEqual({ toDownload: [], reusable: ['a.js'], removed: 1 })
  })

  test('no stored files means a full download', () => {
    const wanted = [{ path: 'a.js', sha: '1' }]
    expect(diffWanted(wanted, []).toDownload).toEqual(['a.js'])
  })

  test('an empty sha never matches, forcing a fresh download', () => {
    const wanted = [{ path: 'a.js', sha: '' }]
    const stored = [{ path: 'a.js', contentHash: '' }]
    expect(diffWanted(wanted, stored).toDownload).toEqual(['a.js'])
  })
})
