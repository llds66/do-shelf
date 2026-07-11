export const SHELF_DATA_VERSION = 3 as const
export const SHELF_DATA_KEY = 'do-shelf:data'

export const ALL_CATEGORY_VIEW_ID = 'all'
export const ALL_CATEGORY_VIEW_NAME = '全部'
export const DEFAULT_CATEGORY_ID = 'category-preset-default'
export const DEFAULT_CATEGORY_NAME = '默认'

export interface CategoryRecord {
  id: string
  name: string
  builtIn: boolean
  order: number
  createdAt: number
  updatedAt?: number
}

export interface BookmarkRecord {
  id: string
  title: string
  url: string
  normalizedUrl: string
  faviconUrl?: string
  createdAt: number
  updatedAt?: number
}

export interface CategoryBookmarkRecord {
  id: string
  categoryId: string
  bookmarkId: string
  order: number
  createdAt: number
  updatedAt?: number
}

export interface SyncTombstones {
  categories: Record<string, number>
  bookmarks: Record<string, number>
  categoryBookmarks: Record<string, number>
}

export interface DoShelfData {
  version: typeof SHELF_DATA_VERSION
  meta: {
    exportedAt?: number
    appVersion?: string
  }
  categories: CategoryRecord[]
  bookmarks: BookmarkRecord[]
  categoryBookmarks: CategoryBookmarkRecord[]
  tombstones: SyncTombstones
  settings?: Record<string, unknown>
}

export interface CategoryWithCount extends CategoryRecord {
  count: number
}

export const DEFAULT_CATEGORY_RECORD: CategoryRecord = {
  id: DEFAULT_CATEGORY_ID,
  name: DEFAULT_CATEGORY_NAME,
  builtIn: true,
  order: 0,
  createdAt: 0,
}

export const DEFAULT_CATEGORIES = [DEFAULT_CATEGORY_RECORD] as const

export function createEmptyShelfData(): DoShelfData {
  return {
    version: SHELF_DATA_VERSION,
    meta: {},
    categories: DEFAULT_CATEGORIES.map((category) => ({ ...category })),
    bookmarks: [],
    categoryBookmarks: [],
    tombstones: {
      categories: {},
      bookmarks: {},
      categoryBookmarks: {},
    },
    settings: {},
  }
}

export function normalizeUrl(url: string) {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return url
  }
}

export function buildCategoryMap(categories: CategoryRecord[]) {
  return new Map(categories.map((category) => [category.id, category] as const))
}

export function buildBookmarkMap(bookmarks: BookmarkRecord[]) {
  return new Map(bookmarks.map((bookmark) => [bookmark.id, bookmark] as const))
}

export function buildCategoryBookmarksMap(categoryBookmarks: CategoryBookmarkRecord[]) {
  const map = new Map<string, CategoryBookmarkRecord[]>()

  for (const relation of categoryBookmarks) {
    const relations = map.get(relation.categoryId)
    if (relations) relations.push(relation)
    else map.set(relation.categoryId, [relation])
  }

  for (const relations of map.values()) {
    relations.sort((left, right) => {
      if (left.order !== right.order) return left.order - right.order
      if (left.createdAt !== right.createdAt) return left.createdAt - right.createdAt
      return left.id.localeCompare(right.id)
    })
  }

  return map
}

export function getBookmarksByCategoryId(data: DoShelfData, categoryId: string) {
  const relations = buildCategoryBookmarksMap(data.categoryBookmarks).get(categoryId) || []
  const bookmarkMap = buildBookmarkMap(data.bookmarks)

  return relations
    .map((relation) => bookmarkMap.get(relation.bookmarkId))
    .filter((bookmark): bookmark is BookmarkRecord => Boolean(bookmark))
}

export function getCategoriesWithCounts(data: DoShelfData): CategoryWithCount[] {
  const counts = data.categoryBookmarks.reduce<Record<string, number>>((acc, relation) => {
    acc[relation.categoryId] = (acc[relation.categoryId] || 0) + 1
    return acc
  }, {})

  return [...data.categories]
    .sort((left, right) => {
      if (left.order !== right.order) return left.order - right.order
      return left.name.localeCompare(right.name, 'zh-CN')
    })
    .map((category) => ({
      ...category,
      count: counts[category.id] || 0,
    }))
}
