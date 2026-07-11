import browser from 'webextension-polyfill'
import { SHELF_DATA_VERSION, type DoShelfData } from './bookmarks'
import { buildShelfDataForImportByCategory, parseImportedShelfData } from './import-export'

export const WEBDAV_SETTINGS_KEY = 'do-shelf:webdav-settings'
export const WEBDAV_DIRECTORY_NAME = 'do-shelf'
export const WEBDAV_FILE_NAME = 'do-shelf.json'

export interface WebDavSettings {
  serverUrl: string
  username: string
  password: string
}

export function normalizeWebDavSettings(settings: unknown): WebDavSettings {
  const raw =
    typeof settings === 'object' && settings !== null && !Array.isArray(settings)
      ? (settings as Record<string, unknown>)
      : {}

  return {
    serverUrl: typeof raw.serverUrl === 'string' ? raw.serverUrl.trim() : '',
    username: typeof raw.username === 'string' ? raw.username.trim() : '',
    password: typeof raw.password === 'string' ? raw.password : '',
  }
}

export function validateWebDavSettings(settings: WebDavSettings) {
  if (!settings.serverUrl || !settings.username || !settings.password)
    throw new Error('请完整填写服务器地址、账号和密码/应用授权码')

  const url = new URL(settings.serverUrl)
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('服务器地址仅支持 HTTP 或 HTTPS')
}

function normalizeServerUrl(serverUrl: string) {
  return `${serverUrl.replace(/\/+$/, '')}/`
}

function buildAuthorization(settings: WebDavSettings) {
  const bytes = new TextEncoder().encode(`${settings.username}:${settings.password}`)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `Basic ${btoa(binary)}`
}

function getRemoteUrls(settings: WebDavSettings) {
  const serverUrl = normalizeServerUrl(settings.serverUrl)
  const directoryUrl = new URL(`${WEBDAV_DIRECTORY_NAME}/`, serverUrl).toString()
  const fileUrl = new URL(`${WEBDAV_DIRECTORY_NAME}/${WEBDAV_FILE_NAME}`, serverUrl).toString()
  return { directoryUrl, fileUrl }
}

export async function getWebDavSettings() {
  const result = await browser.storage.local.get(WEBDAV_SETTINGS_KEY)
  return normalizeWebDavSettings(result[WEBDAV_SETTINGS_KEY])
}

export async function saveWebDavSettings(settings: WebDavSettings) {
  const normalized = normalizeWebDavSettings(settings)
  validateWebDavSettings(normalized)
  const origin = `${new URL(normalized.serverUrl).origin}/*`
  const granted = await browser.permissions.request({ origins: [origin] })
  if (!granted) throw new Error('未获得 WebDAV 服务器访问权限')

  await browser.storage.local.set({ [WEBDAV_SETTINGS_KEY]: normalized })
  return normalized
}

function createSyncPayload(data: DoShelfData) {
  return {
    version: SHELF_DATA_VERSION,
    meta: {
      exportedAt: Date.now(),
    },
    categories: data.categories,
    bookmarks: data.bookmarks,
    categoryBookmarks: data.categoryBookmarks,
    tombstones: data.tombstones,
  }
}

async function ensureRemoteDirectory(directoryUrl: string, authorization: string) {
  const directoryResponse = await fetch(directoryUrl, {
    method: 'MKCOL',
    headers: { Authorization: authorization },
  })

  if (!directoryResponse.ok && directoryResponse.status !== 405) {
    throw new Error(`创建 WebDAV 文件夹失败（HTTP ${directoryResponse.status}）`)
  }
}

async function downloadRemoteData(fileUrl: string, authorization: string) {
  const response = await fetch(fileUrl, {
    method: 'GET',
    headers: {
      Authorization: authorization,
      Accept: 'application/json',
    },
  })

  if (response.status === 404) return { data: null, etag: null, exists: false }
  if (!response.ok) throw new Error(`下载 WebDAV 数据失败（HTTP ${response.status}）`)

  return {
    data: parseImportedShelfData(await response.text()),
    etag: response.headers.get('ETag'),
    exists: true,
  }
}

export function mergeRemoteData(localData: DoShelfData, remoteData: DoShelfData | null) {
  if (!remoteData) return localData

  const merged = buildShelfDataForImportByCategory({
    currentData: localData,
    importedData: remoteData,
    categoryIds: remoteData.categories.map((category) => category.id),
    strategy: 'merge',
  })
  merged.tombstones = {
    categories: mergeTombstoneMaps(
      localData.tombstones.categories,
      remoteData.tombstones.categories,
    ),
    bookmarks: mergeTombstoneMaps(localData.tombstones.bookmarks, remoteData.tombstones.bookmarks),
    categoryBookmarks: mergeTombstoneMaps(
      localData.tombstones.categoryBookmarks,
      remoteData.tombstones.categoryBookmarks,
    ),
  }

  merged.categories = merged.categories.filter((category) => {
    if (category.builtIn) return true
    return (
      (merged.tombstones.categories[category.id] || 0) < (category.updatedAt ?? category.createdAt)
    )
  })
  const categoryIds = new Set(merged.categories.map((category) => category.id))
  merged.bookmarks = merged.bookmarks.filter(
    (bookmark) =>
      (merged.tombstones.bookmarks[bookmark.id] || 0) < (bookmark.updatedAt ?? bookmark.createdAt),
  )
  const bookmarkIds = new Set(merged.bookmarks.map((bookmark) => bookmark.id))
  merged.categoryBookmarks = merged.categoryBookmarks.filter(
    (relation) =>
      categoryIds.has(relation.categoryId) &&
      bookmarkIds.has(relation.bookmarkId) &&
      (merged.tombstones.categoryBookmarks[relation.id] || 0) <
        (relation.updatedAt ?? relation.createdAt),
  )
  const referencedBookmarkIds = new Set(
    merged.categoryBookmarks.map((relation) => relation.bookmarkId),
  )
  merged.bookmarks = merged.bookmarks.filter((bookmark) => referencedBookmarkIds.has(bookmark.id))
  return merged
}

function mergeTombstoneMaps(...maps: Record<string, number>[]) {
  const merged: Record<string, number> = {}
  for (const map of maps)
    for (const [id, deletedAt] of Object.entries(map))
      merged[id] = Math.max(merged[id] || 0, deletedAt)
  return merged
}

function assertMergeIntegrity(localData: DoShelfData, mergedData: DoShelfData) {
  const mergedBookmarkIds = new Set(mergedData.bookmarks.map((bookmark) => bookmark.id))
  const missingLocalBookmarks = localData.bookmarks.filter((bookmark) => {
    const deletedAt = mergedData.tombstones.bookmarks[bookmark.id] || 0
    const updatedAt = bookmark.updatedAt ?? bookmark.createdAt
    return deletedAt < updatedAt && !mergedBookmarkIds.has(bookmark.id)
  })

  if (missingLocalBookmarks.length) {
    throw new Error(`同步已中止：合并结果异常，可能丢失 ${missingLocalBookmarks.length} 条本地收藏`)
  }
}

async function uploadMergedData(
  fileUrl: string,
  authorization: string,
  data: DoShelfData,
  etag: string | null,
  remoteExists: boolean,
) {
  return fetch(fileUrl, {
    method: 'PUT',
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json; charset=utf-8',
      ...(etag ? { 'If-Match': etag } : remoteExists ? {} : { 'If-None-Match': '*' }),
    },
    body: JSON.stringify(createSyncPayload(data), null, 2),
  })
}

export async function syncBookmarksWithWebDav(settings: WebDavSettings, localData: DoShelfData) {
  validateWebDavSettings(settings)
  const authorization = buildAuthorization(settings)
  const { directoryUrl, fileUrl } = getRemoteUrls(settings)
  await ensureRemoteDirectory(directoryUrl, authorization)

  let currentData = localData

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const remote = await downloadRemoteData(fileUrl, authorization)
    currentData = mergeRemoteData(currentData, remote.data)
    assertMergeIntegrity(localData, currentData)
    const uploadResponse = await uploadMergedData(
      fileUrl,
      authorization,
      currentData,
      remote.etag,
      remote.exists,
    )

    if (uploadResponse.ok) return currentData
    if (uploadResponse.status !== 412 || attempt === 1)
      throw new Error(`同步数据失败（HTTP ${uploadResponse.status}）`)
  }

  return currentData
}
