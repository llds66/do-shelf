import browser from 'webextension-polyfill'
import {
  DEFAULT_CATEGORY_ID,
  DEFAULT_CATEGORIES,
  SHELF_DATA_KEY,
  SHELF_DATA_VERSION,
  buildBookmarkMap,
  createEmptyShelfData,
  getBookmarksByCategoryId,
  normalizeUrl,
  type BookmarkRecord,
  type CategoryBookmarkRecord,
  type CategoryRecord,
  type DoShelfData,
} from './bookmarks'

export interface RemoveCategoryResult {
  removedRelationCount: number
  removedBookmarkCount: number
}

export interface RemoveBookmarkFromCategoryResult {
  removed: boolean
  deletedBookmark: boolean
}

export interface SaveBookmarkInCategoriesInput {
  bookmarkId?: string
  title: string
  url: string
  faviconUrl?: string
  categoryIds: string[]
}

function buildDefaultFaviconUrl(url: string) {
  try {
    return new URL('/favicon.ico', url).toString()
  } catch {
    return undefined
  }
}

function buildGoogleFaviconUrl(url: string) {
  try {
    const domain = new URL(url).hostname
    if (!domain) return undefined
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`
  } catch {
    return undefined
  }
}

function resolveStoredFaviconUrl(url: string, faviconUrl?: string) {
  if (typeof faviconUrl === 'string' && faviconUrl.trim()) return faviconUrl.trim()

  return buildDefaultFaviconUrl(url) || buildGoogleFaviconUrl(url)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function sortCategories(categories: CategoryRecord[]) {
  return [...categories].sort((left, right) => {
    if (left.order !== right.order) return left.order - right.order
    return left.name.localeCompare(right.name, 'zh-CN')
  })
}

function getNextCategoryOrder(categories: CategoryRecord[]) {
  if (!categories.length) return 0
  return Math.max(...categories.map((category) => category.order)) + 1
}

function getNextCategoryBookmarkOrder(
  categoryId: string,
  categoryBookmarks: CategoryBookmarkRecord[],
) {
  const currentOrders = categoryBookmarks
    .filter((relation) => relation.categoryId === categoryId)
    .map((relation) => relation.order)

  if (!currentOrders.length) return 0

  return Math.min(...currentOrders) - 1
}

function createCategoryBookmarkRecord(input: {
  id?: string
  categoryId: string
  bookmarkId: string
  order: number
  createdAt: number
}) {
  return {
    id: input.id || crypto.randomUUID(),
    categoryId: input.categoryId,
    bookmarkId: input.bookmarkId,
    order: input.order,
    createdAt: input.createdAt,
  } satisfies CategoryBookmarkRecord
}

function normalizeBookmarks(rawBookmarks: unknown[]): {
  bookmarks: BookmarkRecord[]
  bookmarkIdAliases: Map<string, string>
} {
  const bookmarksByUrl = new Map<string, BookmarkRecord>()
  const bookmarkIdAliases = new Map<string, string>()

  for (const rawBookmark of rawBookmarks) {
    if (!rawBookmark || typeof rawBookmark !== 'object') continue

    const bookmark = rawBookmark as Partial<BookmarkRecord>
    const url = typeof bookmark.url === 'string' ? bookmark.url : ''
    if (!url) continue

    const normalizedUrl = normalizeUrl(url)
    const title =
      typeof bookmark.title === 'string' && bookmark.title.trim() ? bookmark.title : '未命名帖子'
    const createdAt = isFiniteNumber(bookmark.createdAt) ? bookmark.createdAt : Date.now()
    const updatedAt = isFiniteNumber(bookmark.updatedAt) ? bookmark.updatedAt : undefined
    const faviconUrl = resolveStoredFaviconUrl(url, bookmark.faviconUrl)
    const existing = bookmarksByUrl.get(normalizedUrl)

    if (!existing) {
      const nextBookmark: BookmarkRecord = {
        id: typeof bookmark.id === 'string' && bookmark.id ? bookmark.id : crypto.randomUUID(),
        title,
        url,
        normalizedUrl,
        faviconUrl,
        createdAt,
        updatedAt,
      }

      bookmarksByUrl.set(normalizedUrl, nextBookmark)

      if (typeof bookmark.id === 'string' && bookmark.id)
        bookmarkIdAliases.set(bookmark.id, nextBookmark.id)

      continue
    }

    const nextTimestamp = updatedAt ?? createdAt
    const currentTimestamp = existing.updatedAt ?? existing.createdAt

    if (nextTimestamp >= currentTimestamp) {
      existing.title = title
      existing.url = url
      existing.faviconUrl = faviconUrl
      existing.updatedAt = updatedAt ?? existing.updatedAt
    }

    existing.createdAt = Math.min(existing.createdAt, createdAt)

    if (updatedAt != null)
      existing.updatedAt =
        existing.updatedAt == null ? updatedAt : Math.max(existing.updatedAt, updatedAt)

    if (typeof bookmark.id === 'string' && bookmark.id)
      bookmarkIdAliases.set(bookmark.id, existing.id)
  }

  return {
    bookmarks: Array.from(bookmarksByUrl.values()),
    bookmarkIdAliases,
  }
}

function normalizeCategoryBookmarks(
  rawCategoryBookmarks: unknown[],
  categories: CategoryRecord[],
  bookmarkIdAliases: Map<string, string>,
  bookmarkIds: Set<string>,
) {
  const validCategoryIds = new Set(categories.map((category) => category.id))
  const relationsByPair = new Map<string, CategoryBookmarkRecord>()

  function setRelation(relation: CategoryBookmarkRecord) {
    const pairKey = `${relation.categoryId}::${relation.bookmarkId}`
    const existing = relationsByPair.get(pairKey)

    if (!existing) {
      relationsByPair.set(pairKey, relation)
      return
    }

    if (
      relation.order < existing.order ||
      (relation.order === existing.order && relation.createdAt < existing.createdAt)
    ) {
      relationsByPair.set(pairKey, relation)
    }
  }

  for (const [index, rawRelation] of rawCategoryBookmarks.entries()) {
    if (!rawRelation || typeof rawRelation !== 'object') continue

    const relation = rawRelation as Partial<CategoryBookmarkRecord>
    if (typeof relation.categoryId !== 'string' || typeof relation.bookmarkId !== 'string') continue

    const bookmarkId = bookmarkIdAliases.get(relation.bookmarkId) || relation.bookmarkId
    if (!bookmarkIds.has(bookmarkId)) continue

    const nextRelation = createCategoryBookmarkRecord({
      id: typeof relation.id === 'string' && relation.id ? relation.id : undefined,
      categoryId: relation.categoryId,
      bookmarkId,
      order: isFiniteNumber(relation.order) ? relation.order : index,
      createdAt: isFiniteNumber(relation.createdAt) ? relation.createdAt : Date.now(),
    })

    if (!validCategoryIds.has(relation.categoryId)) continue

    setRelation(nextRelation)
  }

  const groupedRelations = new Map<string, CategoryBookmarkRecord[]>()

  for (const relation of relationsByPair.values()) {
    const current = groupedRelations.get(relation.categoryId)
    if (current) current.push(relation)
    else groupedRelations.set(relation.categoryId, [relation])
  }

  const normalizedRelations: CategoryBookmarkRecord[] = []

  for (const category of sortCategories(categories)) {
    const relations = groupedRelations.get(category.id) || []

    relations
      .sort((left, right) => {
        if (left.order !== right.order) return left.order - right.order
        if (left.createdAt !== right.createdAt) return left.createdAt - right.createdAt
        return left.id.localeCompare(right.id)
      })
      .forEach((relation, index) => {
        normalizedRelations.push({
          ...relation,
          order: index,
        })
      })
  }

  return normalizedRelations
}

function normalizeShelfData(data: Partial<DoShelfData> | undefined): DoShelfData {
  const emptyData = createEmptyShelfData()
  const rawCategories = Array.isArray(data?.categories) ? data.categories : []
  const categoriesById = new Map<string, CategoryRecord>()

  for (const rawCategory of rawCategories) {
    if (!rawCategory || typeof rawCategory !== 'object') continue

    const category = rawCategory as Partial<CategoryRecord>
    if (typeof category.id !== 'string' || !category.id) continue
    if (typeof category.name !== 'string' || !category.name.trim()) continue

    categoriesById.set(category.id, {
      id: category.id,
      name: category.name.trim(),
      builtIn: Boolean(category.builtIn),
      order: isFiniteNumber(category.order) ? category.order : categoriesById.size,
      createdAt: isFiniteNumber(category.createdAt) ? category.createdAt : Date.now(),
      updatedAt: isFiniteNumber(category.updatedAt) ? category.updatedAt : undefined,
    })
  }

  for (const builtInCategory of DEFAULT_CATEGORIES) {
    const existingCategory = categoriesById.get(builtInCategory.id)

    categoriesById.set(builtInCategory.id, {
      id: builtInCategory.id,
      name: builtInCategory.name,
      builtIn: true,
      order: existingCategory?.order ?? builtInCategory.order,
      createdAt: existingCategory?.createdAt ?? builtInCategory.createdAt,
      updatedAt: existingCategory?.updatedAt,
    })
  }

  const categories = sortCategories(Array.from(categoriesById.values())).map((category, index) => ({
    ...category,
    order: index,
  }))

  const { bookmarks, bookmarkIdAliases } = normalizeBookmarks(
    Array.isArray(data?.bookmarks) ? data.bookmarks : [],
  )
  const bookmarkIds = new Set(bookmarks.map((bookmark) => bookmark.id))
  const categoryBookmarks = normalizeCategoryBookmarks(
    Array.isArray(data?.categoryBookmarks) ? data.categoryBookmarks : [],
    categories,
    bookmarkIdAliases,
    bookmarkIds,
  )
  const referencedBookmarkIds = new Set(categoryBookmarks.map((relation) => relation.bookmarkId))
  const normalizedBookmarks = bookmarks.filter((bookmark) => referencedBookmarkIds.has(bookmark.id))

  return {
    version: SHELF_DATA_VERSION,
    meta: typeof data?.meta === 'object' && data.meta ? data.meta : emptyData.meta,
    categories,
    bookmarks: normalizedBookmarks,
    categoryBookmarks,
    settings:
      typeof data?.settings === 'object' && data.settings ? data.settings : emptyData.settings,
  }
}

export async function getShelfData() {
  const result = await browser.storage.local.get(SHELF_DATA_KEY)
  const storedData = result[SHELF_DATA_KEY] as DoShelfData | undefined

  if (!storedData) {
    const emptyData = createEmptyShelfData()
    await browser.storage.local.set({
      [SHELF_DATA_KEY]: emptyData,
    })
    return emptyData
  }

  const normalizedData = normalizeShelfData(storedData)

  if (JSON.stringify(storedData) !== JSON.stringify(normalizedData)) {
    await browser.storage.local.set({
      [SHELF_DATA_KEY]: normalizedData,
    })
  }

  return normalizedData
}

export async function saveShelfData(data: DoShelfData) {
  const normalizedData = normalizeShelfData(data)

  await browser.storage.local.set({
    [SHELF_DATA_KEY]: normalizedData,
  })

  return normalizedData
}

export async function clearShelfData() {
  await browser.storage.local.remove(SHELF_DATA_KEY)
}

export async function getCategoryBookmarks(categoryId: string) {
  const data = await getShelfData()
  return getBookmarksByCategoryId(data, categoryId)
}

export async function getBookmarkByNormalizedUrl(url: string) {
  const normalizedUrl = normalizeUrl(url)
  const data = await getShelfData()

  return data.bookmarks.find((bookmark) => bookmark.normalizedUrl === normalizedUrl)
}

export async function addCategory(name: string) {
  const nextName = name.trim()
  if (!nextName) return null

  const data = await getShelfData()
  const exists = data.categories.some((category) => category.name === nextName)
  if (exists) return null

  const nextCategory: CategoryRecord = {
    id: crypto.randomUUID(),
    name: nextName,
    builtIn: false,
    order: getNextCategoryOrder(data.categories),
    createdAt: Date.now(),
  }

  data.categories.push(nextCategory)
  await saveShelfData(data)

  return nextCategory
}

export async function reorderCategories(categoryIds: string[]) {
  const data = await getShelfData()
  const uniqueCategoryIds = Array.from(new Set(categoryIds))
  const orderById = new Map(uniqueCategoryIds.map((categoryId, index) => [categoryId, index]))
  const orderedCategories = data.categories
    .filter((category) => orderById.has(category.id))
    .sort((left, right) => (orderById.get(left.id) ?? 0) - (orderById.get(right.id) ?? 0))
  const remainingCategories = sortCategories(
    data.categories.filter((category) => !orderById.has(category.id)),
  )
  const nextCategories = [...orderedCategories, ...remainingCategories]
  const updatedAt = Date.now()

  data.categories = nextCategories.map((category, index) => ({
    ...category,
    order: index,
    updatedAt,
  }))

  await saveShelfData(data)

  return data.categories
}

export async function reorderBookmarksInCategory(categoryId: string, bookmarkIds: string[]) {
  const data = await getShelfData()
  const currentRelations = data.categoryBookmarks
    .filter((relation) => relation.categoryId === categoryId)
    .sort((left, right) => {
      if (left.order !== right.order) return left.order - right.order
      if (left.createdAt !== right.createdAt) return left.createdAt - right.createdAt
      return left.id.localeCompare(right.id)
    })

  if (!currentRelations.length) return []

  const uniqueBookmarkIds = Array.from(new Set(bookmarkIds))
  const relationByBookmarkId = new Map(
    currentRelations.map((relation) => [relation.bookmarkId, relation] as const),
  )
  const orderedRelations = uniqueBookmarkIds
    .map((bookmarkId) => relationByBookmarkId.get(bookmarkId))
    .filter((relation): relation is CategoryBookmarkRecord => Boolean(relation))
  const remainingRelations = currentRelations.filter(
    (relation) => !uniqueBookmarkIds.includes(relation.bookmarkId),
  )
  const nextRelations = [...orderedRelations, ...remainingRelations].map((relation, index) => ({
    ...relation,
    order: index,
  }))

  data.categoryBookmarks = [
    ...data.categoryBookmarks.filter((relation) => relation.categoryId !== categoryId),
    ...nextRelations,
  ]

  await saveShelfData(data)

  return nextRelations
}

export async function removeCategory(categoryId: string) {
  const data = await getShelfData()
  const category = data.categories.find((item) => item.id === categoryId)

  if (!category || category.builtIn) return null

  const removedRelations = data.categoryBookmarks.filter(
    (relation) => relation.categoryId === categoryId,
  )
  const previousBookmarkCount = data.bookmarks.length
  const affectedBookmarkIds = new Set(removedRelations.map((relation) => relation.bookmarkId))
  const nextCategoryBookmarks = data.categoryBookmarks.filter(
    (relation) => relation.categoryId !== categoryId,
  )

  data.categories = data.categories.filter((item) => item.id !== categoryId)
  data.categoryBookmarks = nextCategoryBookmarks
  data.bookmarks = data.bookmarks.filter((bookmark) => {
    if (!affectedBookmarkIds.has(bookmark.id)) return true

    return nextCategoryBookmarks.some((relation) => relation.bookmarkId === bookmark.id)
  })
  const removedBookmarkCount = previousBookmarkCount - data.bookmarks.length

  await saveShelfData(data)

  return {
    removedRelationCount: removedRelations.length,
    removedBookmarkCount,
  } satisfies RemoveCategoryResult
}

export async function deleteBookmark(bookmarkId: string) {
  const data = await getShelfData()
  const exists = data.bookmarks.some((bookmark) => bookmark.id === bookmarkId)
  if (!exists) return false

  data.bookmarks = data.bookmarks.filter((bookmark) => bookmark.id !== bookmarkId)
  data.categoryBookmarks = data.categoryBookmarks.filter(
    (relation) => relation.bookmarkId !== bookmarkId,
  )

  await saveShelfData(data)
  return true
}

export async function removeBookmarkFromCategory(categoryId: string, bookmarkId: string) {
  const data = await getShelfData()
  const previousLength = data.categoryBookmarks.length

  data.categoryBookmarks = data.categoryBookmarks.filter(
    (relation) => !(relation.categoryId === categoryId && relation.bookmarkId === bookmarkId),
  )

  if (data.categoryBookmarks.length === previousLength) {
    return {
      removed: false,
      deletedBookmark: false,
    } satisfies RemoveBookmarkFromCategoryResult
  }

  const stillReferenced = data.categoryBookmarks.some(
    (relation) => relation.bookmarkId === bookmarkId,
  )
  if (!stillReferenced)
    data.bookmarks = data.bookmarks.filter((bookmark) => bookmark.id !== bookmarkId)

  await saveShelfData(data)

  return {
    removed: true,
    deletedBookmark: !stillReferenced,
  } satisfies RemoveBookmarkFromCategoryResult
}

export async function saveBookmarkInCategories(input: SaveBookmarkInCategoriesInput) {
  const data = await getShelfData()
  const validCategoryIds = new Set(data.categories.map((category) => category.id))
  const nextCategoryIds = Array.from(
    new Set(input.categoryIds.filter((categoryId) => validCategoryIds.has(categoryId))),
  )

  if (!nextCategoryIds.length && validCategoryIds.has(DEFAULT_CATEGORY_ID))
    nextCategoryIds.push(DEFAULT_CATEGORY_ID)

  const normalizedUrl = normalizeUrl(input.url)
  const now = Date.now()
  let bookmark =
    data.bookmarks.find((item) => item.id === input.bookmarkId) ||
    data.bookmarks.find((item) => item.normalizedUrl === normalizedUrl)

  if (!bookmark) {
    bookmark = {
      id: crypto.randomUUID(),
      title: input.title.trim() || '未命名帖子',
      url: input.url,
      normalizedUrl,
      faviconUrl: resolveStoredFaviconUrl(input.url, input.faviconUrl),
      createdAt: now,
    }
    data.bookmarks.push(bookmark)
  } else {
    bookmark.title = input.title.trim() || bookmark.title
    bookmark.url = input.url
    bookmark.normalizedUrl = normalizedUrl
    bookmark.faviconUrl = resolveStoredFaviconUrl(input.url, input.faviconUrl)
    bookmark.updatedAt = now
  }

  const selectedCategoryIdSet = new Set(nextCategoryIds)

  data.categoryBookmarks = data.categoryBookmarks.filter((relation) => {
    if (relation.bookmarkId !== bookmark.id) return true
    return selectedCategoryIdSet.has(relation.categoryId)
  })

  const existingCategoryIds = new Set(
    data.categoryBookmarks
      .filter((relation) => relation.bookmarkId === bookmark.id)
      .map((relation) => relation.categoryId),
  )

  for (const categoryId of nextCategoryIds) {
    if (existingCategoryIds.has(categoryId)) continue

    data.categoryBookmarks.push({
      id: crypto.randomUUID(),
      categoryId,
      bookmarkId: bookmark.id,
      order: getNextCategoryBookmarkOrder(categoryId, data.categoryBookmarks),
      createdAt: now,
    })
  }

  await saveShelfData(data)

  return bookmark
}

export async function getBookmarkCategoryIds(bookmarkId: string) {
  const data = await getShelfData()

  return data.categoryBookmarks
    .filter((relation) => relation.bookmarkId === bookmarkId)
    .sort((left, right) => left.order - right.order)
    .map((relation) => relation.categoryId)
}

export async function getBookmarksByNormalizedUrlMap() {
  const data = await getShelfData()
  return new Map(data.bookmarks.map((bookmark) => [bookmark.normalizedUrl, bookmark] as const))
}

export async function getCategoryBookmarkMap() {
  const data = await getShelfData()
  const bookmarkMap = buildBookmarkMap(data.bookmarks)
  const categoryMap = new Map<string, BookmarkRecord[]>()

  for (const relation of [...data.categoryBookmarks].sort(
    (left, right) => left.order - right.order,
  )) {
    const bookmark = bookmarkMap.get(relation.bookmarkId)
    if (!bookmark) continue

    const bookmarks = categoryMap.get(relation.categoryId)
    if (bookmarks) bookmarks.push(bookmark)
    else categoryMap.set(relation.categoryId, [bookmark])
  }

  return categoryMap
}
