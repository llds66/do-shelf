import {
  SHELF_DATA_VERSION,
  normalizeUrl,
  type BookmarkRecord,
  type CategoryBookmarkRecord,
  type CategoryRecord,
  type DoShelfData,
} from './bookmarks'

export type ImportStrategy = 'replace' | 'merge'

export interface CategorySelectionOption {
  id: string
  name: string
  count: number
  builtIn: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function cloneCategories(categories: CategoryRecord[]) {
  return categories.map((category) => ({ ...category }))
}

function cloneBookmarks(bookmarks: BookmarkRecord[]) {
  return bookmarks.map((bookmark) => ({ ...bookmark }))
}

function cloneCategoryBookmarks(categoryBookmarks: CategoryBookmarkRecord[]) {
  return categoryBookmarks.map((relation) => ({ ...relation }))
}

function cloneSettings(settings: DoShelfData['settings']) {
  return isRecord(settings) ? { ...settings } : {}
}

function countBookmarksByCategory(categoryBookmarks: CategoryBookmarkRecord[]) {
  return categoryBookmarks.reduce<Record<string, number>>((acc, relation) => {
    acc[relation.categoryId] = (acc[relation.categoryId] || 0) + 1
    return acc
  }, {})
}

function buildCategoryScopedData(data: DoShelfData, categoryIds: string[]) {
  const selectedCategoryIdSet = new Set(categoryIds)
  const categories = cloneCategories(
    data.categories.filter((category) => selectedCategoryIdSet.has(category.id)),
  )
  const categoryBookmarks = cloneCategoryBookmarks(
    data.categoryBookmarks.filter((relation) => selectedCategoryIdSet.has(relation.categoryId)),
  )
  const referencedBookmarkIds = new Set(categoryBookmarks.map((relation) => relation.bookmarkId))
  const bookmarks = cloneBookmarks(
    data.bookmarks.filter((bookmark) => referencedBookmarkIds.has(bookmark.id)),
  )

  return {
    categories,
    bookmarks,
    categoryBookmarks,
  }
}

export function buildCategorySelectionOptions(data: DoShelfData) {
  const counts = countBookmarksByCategory(data.categoryBookmarks)

  return [...data.categories]
    .sort((left, right) => {
      if (left.order !== right.order) return left.order - right.order
      return left.name.localeCompare(right.name, 'zh-CN')
    })
    .map((category) => ({
      id: category.id,
      name: category.name,
      count: counts[category.id] || 0,
      builtIn: category.builtIn,
    }) satisfies CategorySelectionOption)
}

export function buildExportFilename(exportedAt: number, appVersion: string) {
  const now = new Date(exportedAt)
  const parts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ]

  return `do-shelf-export-v${appVersion}-${parts.join('')}.json`
}

export function parseImportedShelfData(rawText: string) {
  let parsed: unknown

  try {
    parsed = JSON.parse(rawText)
  } catch {
    throw new Error('导入文件不是合法的 JSON')
  }

  if (!isRecord(parsed)) throw new Error('导入数据格式不正确')

  if (parsed.version !== SHELF_DATA_VERSION)
    throw new Error(`仅支持导入 version = ${SHELF_DATA_VERSION} 的数据`)

  if (!Array.isArray(parsed.categories)) throw new Error('导入数据缺少 categories 数组')
  if (!Array.isArray(parsed.bookmarks)) throw new Error('导入数据缺少 bookmarks 数组')
  if (!Array.isArray(parsed.categoryBookmarks))
    throw new Error('导入数据缺少 categoryBookmarks 数组')
  if (parsed.settings != null && !isRecord(parsed.settings))
    throw new Error('导入数据中的 settings 必须是对象')

  return {
    version: parsed.version,
    meta: isRecord(parsed.meta) ? parsed.meta : {},
    categories: parsed.categories,
    bookmarks: parsed.bookmarks,
    categoryBookmarks: parsed.categoryBookmarks,
    settings: isRecord(parsed.settings) ? parsed.settings : {},
  } satisfies DoShelfData
}

export function buildExportDataByCategoryIds(input: {
  data: DoShelfData
  categoryIds: string[]
  exportedAt: number
  appVersion: string
}) {
  const { data, categoryIds, exportedAt, appVersion } = input
  const scopedData = buildCategoryScopedData(data, categoryIds)

  return {
    version: SHELF_DATA_VERSION,
    meta: {
      ...data.meta,
      exportedAt,
      appVersion,
    },
    categories: scopedData.categories,
    bookmarks: scopedData.bookmarks,
    categoryBookmarks: scopedData.categoryBookmarks,
    // 当前阶段导入导出都以分类为单位，设置不参与局部迁移
    settings: {},
  } satisfies DoShelfData
}

function mergeCategories(current: CategoryRecord[], imported: CategoryRecord[]) {
  const categoriesById = new Map(current.map((category) => [category.id, { ...category }] as const))

  for (const importedCategory of imported) {
    const existing = categoriesById.get(importedCategory.id)
    if (!existing) {
      categoriesById.set(importedCategory.id, { ...importedCategory })
      continue
    }

    const existingTimestamp = existing.updatedAt ?? existing.createdAt
    const importedTimestamp = importedCategory.updatedAt ?? importedCategory.createdAt

    if (importedTimestamp >= existingTimestamp) {
      categoriesById.set(importedCategory.id, {
        ...existing,
        ...importedCategory,
        createdAt: Math.min(existing.createdAt, importedCategory.createdAt),
      })
      continue
    }

    categoriesById.set(importedCategory.id, {
      ...existing,
      createdAt: Math.min(existing.createdAt, importedCategory.createdAt),
      updatedAt:
        existing.updatedAt == null
          ? importedCategory.updatedAt
          : importedCategory.updatedAt == null
            ? existing.updatedAt
            : Math.max(existing.updatedAt, importedCategory.updatedAt),
    })
  }

  return Array.from(categoriesById.values())
}

function mergeBookmarks(current: BookmarkRecord[], imported: BookmarkRecord[]) {
  const mergedBookmarks = cloneBookmarks(current)
  const bookmarkByNormalizedUrl = new Map(
    mergedBookmarks.map((bookmark) => [bookmark.normalizedUrl, bookmark] as const),
  )
  const bookmarkIdAliases = new Map<string, string>()

  for (const importedBookmark of imported) {
    const normalizedUrl =
      typeof importedBookmark.normalizedUrl === 'string' && importedBookmark.normalizedUrl
        ? importedBookmark.normalizedUrl
        : normalizeUrl(importedBookmark.url)
    const existing = bookmarkByNormalizedUrl.get(normalizedUrl)

    if (!existing) {
      const nextBookmark = {
        ...importedBookmark,
        normalizedUrl,
      }
      mergedBookmarks.push(nextBookmark)
      bookmarkByNormalizedUrl.set(normalizedUrl, nextBookmark)
      bookmarkIdAliases.set(importedBookmark.id, nextBookmark.id)
      continue
    }

    const existingTimestamp = existing.updatedAt ?? existing.createdAt
    const importedTimestamp =
      (isFiniteNumber(importedBookmark.updatedAt) ? importedBookmark.updatedAt : undefined) ??
      importedBookmark.createdAt

    if (importedTimestamp >= existingTimestamp) {
      existing.title = importedBookmark.title
      existing.url = importedBookmark.url
      existing.normalizedUrl = normalizedUrl
      existing.faviconUrl = importedBookmark.faviconUrl
      existing.updatedAt = importedBookmark.updatedAt ?? existing.updatedAt
    }

    existing.createdAt = Math.min(existing.createdAt, importedBookmark.createdAt)

    if (importedBookmark.updatedAt != null)
      existing.updatedAt =
        existing.updatedAt == null
          ? importedBookmark.updatedAt
          : Math.max(existing.updatedAt, importedBookmark.updatedAt)

    bookmarkIdAliases.set(importedBookmark.id, existing.id)
  }

  return {
    bookmarks: mergedBookmarks,
    bookmarkIdAliases,
  }
}

function mergeCategoryBookmarks(input: {
  currentRelations: CategoryBookmarkRecord[]
  importedRelations: CategoryBookmarkRecord[]
  validCategoryIds: Set<string>
  validBookmarkIds: Set<string>
  bookmarkIdAliases: Map<string, string>
}) {
  const { currentRelations, importedRelations, validCategoryIds, validBookmarkIds, bookmarkIdAliases } =
    input
  const relationByPair = new Map<string, CategoryBookmarkRecord>()

  function setRelation(relation: CategoryBookmarkRecord) {
    if (!validCategoryIds.has(relation.categoryId) || !validBookmarkIds.has(relation.bookmarkId))
      return

    const pairKey = `${relation.categoryId}::${relation.bookmarkId}`
    const existing = relationByPair.get(pairKey)
    if (!existing) {
      relationByPair.set(pairKey, { ...relation })
      return
    }

    if (
      relation.order < existing.order ||
      (relation.order === existing.order && relation.createdAt < existing.createdAt)
    )
      relationByPair.set(pairKey, { ...relation })
  }

  for (const relation of currentRelations) setRelation(relation)

  for (const relation of importedRelations) {
    const bookmarkId = bookmarkIdAliases.get(relation.bookmarkId) || relation.bookmarkId
    setRelation({
      ...relation,
      bookmarkId,
    })
  }

  return Array.from(relationByPair.values())
}

function mergeCategoryScopedData(currentData: DoShelfData, importedData: DoShelfData) {
  const categories = mergeCategories(currentData.categories, importedData.categories)
  const bookmarkMergeResult = mergeBookmarks(currentData.bookmarks, importedData.bookmarks)
  const categoryBookmarks = mergeCategoryBookmarks({
    currentRelations: currentData.categoryBookmarks,
    importedRelations: importedData.categoryBookmarks,
    validCategoryIds: new Set(categories.map((category) => category.id)),
    validBookmarkIds: new Set(bookmarkMergeResult.bookmarks.map((bookmark) => bookmark.id)),
    bookmarkIdAliases: bookmarkMergeResult.bookmarkIdAliases,
  })

  return {
    version: SHELF_DATA_VERSION,
    meta: { ...currentData.meta },
    categories,
    bookmarks: bookmarkMergeResult.bookmarks,
    categoryBookmarks,
    settings: cloneSettings(currentData.settings),
  } satisfies DoShelfData
}

export function buildShelfDataForImportByCategory(input: {
  currentData: DoShelfData
  importedData: DoShelfData
  categoryIds: string[]
  strategy: ImportStrategy
}) {
  const { currentData, importedData, categoryIds, strategy } = input

  if (!categoryIds.length) throw new Error('请至少选择一个分类')

  const scopedImportedData = buildExportDataByCategoryIds({
    data: importedData,
    categoryIds,
    exportedAt: importedData.meta.exportedAt ?? Date.now(),
    appVersion: importedData.meta.appVersion || '0.0.0',
  })

  if (strategy === 'replace') {
    return {
      version: SHELF_DATA_VERSION,
      meta: { ...currentData.meta },
      categories: scopedImportedData.categories,
      bookmarks: scopedImportedData.bookmarks,
      categoryBookmarks: scopedImportedData.categoryBookmarks,
      settings: cloneSettings(currentData.settings),
    } satisfies DoShelfData
  }

  return mergeCategoryScopedData(currentData, scopedImportedData)
}
