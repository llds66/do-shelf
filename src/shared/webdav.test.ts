import { describe, expect, it, vi } from 'vitest'
import type { DoShelfData } from './bookmarks'
import { mergeRemoteData } from './webdav'

vi.mock('webextension-polyfill', () => ({ default: {} }))

describe('mergeRemoteData', () => {
  it('keeps unrelated bookmarks when one bookmark is deleted locally', () => {
    const remote = {
      version: 3,
      meta: {},
      categories: [
        { id: 'category-preset-default', name: '默认', builtIn: true, order: 0, createdAt: 0 },
      ],
      bookmarks: [
        {
          id: 'b1',
          title: '1',
          url: 'https://a.com',
          normalizedUrl: 'https://a.com/',
          createdAt: 1,
        },
        {
          id: 'b2',
          title: '2',
          url: 'https://b.com',
          normalizedUrl: 'https://b.com/',
          createdAt: 1,
        },
      ],
      categoryBookmarks: [
        {
          id: 'r1',
          categoryId: 'category-preset-default',
          bookmarkId: 'b1',
          order: 0,
          createdAt: 1,
        },
        {
          id: 'r2',
          categoryId: 'category-preset-default',
          bookmarkId: 'b2',
          order: 1,
          createdAt: 1,
        },
      ],
      tombstones: { categories: {}, bookmarks: {}, categoryBookmarks: {} },
      settings: {},
    } satisfies DoShelfData
    const local: DoShelfData = {
      ...remote,
      bookmarks: [remote.bookmarks[1]],
      categoryBookmarks: [remote.categoryBookmarks[1]],
      tombstones: { categories: {}, bookmarks: { b1: 100 }, categoryBookmarks: { r1: 100 } },
    }

    const merged = mergeRemoteData(local, remote)
    expect(merged.bookmarks.map((bookmark) => bookmark.id)).toEqual(['b2'])
    expect(merged.categoryBookmarks.map((relation) => relation.id)).toEqual(['r2'])
  })
})
