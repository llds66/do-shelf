# DoShelf 存储说明

## 存储方式

本项目当前只使用浏览器扩展的 `browser.storage.local`，并统一存储在一个 key 中：

- `do-shelf:data`

对应常量定义位于 [src/shared/bookmarks.ts](c:/dev/do-shelf/src/shared/bookmarks.ts:1)。

## 根结构

`do-shelf:data` 对应一份完整 JSON：

```ts
interface DoShelfData {
  version: 2
  meta: {
    exportedAt?: number
    appVersion?: string
  }
  categories: CategoryRecord[]
  bookmarks: BookmarkRecord[]
  categoryBookmarks: CategoryBookmarkRecord[]
  settings?: Record<string, unknown>
}
```

字段：

- `version`: 当前数据结构版本号
- `meta`: 元信息对象
- `categories`: 分类列表
- `bookmarks`: 书签列表
- `categoryBookmarks`: 分类与书签的关系列表
- `settings`: 预留设置字段，可选

## 分类结构

```ts
interface CategoryRecord {
  id: string
  name: string
  builtIn: boolean
  order: number
  createdAt: number
  updatedAt?: number
}
```

字段：

- `id`: 分类唯一标识
- `name`: 分类名称
- `builtIn`: 是否为内置分类
- `order`: 分类排序值
- `createdAt`: 创建时间
- `updatedAt`: 更新时间，可选

当前内置真实分类：

```json
[
  {
    "id": "category-preset-default",
    "name": "默认",
    "builtIn": true,
    "order": 0,
    "createdAt": 0
  }
]
```

## 书签结构

```ts
interface BookmarkRecord {
  id: string
  title: string
  url: string
  normalizedUrl: string
  faviconUrl?: string
  createdAt: number
  updatedAt?: number
}
```

字段：

- `id`: 书签唯一标识
- `title`: 书签标题
- `url`: 原始链接
- `normalizedUrl`: 标准化链接
- `faviconUrl`: 站点图标地址，可选
- `createdAt`: 创建时间
- `updatedAt`: 更新时间，可选

## 分类与书签关系结构

```ts
interface CategoryBookmarkRecord {
  id: string
  categoryId: string
  bookmarkId: string
  order: number
  createdAt: number
}
```

字段：

- `id`: 关系唯一标识
- `categoryId`: 分类 id
- `bookmarkId`: 书签 id
- `order`: 书签在分类内的排序值
- `createdAt`: 关系创建时间

## 示例

```json
{
  "version": 2,
  "meta": {},
  "categories": [
    {
      "id": "category-preset-default",
      "name": "默认",
      "builtIn": true,
      "order": 0,
      "createdAt": 0
    },
    {
      "id": "category-work",
      "name": "工作",
      "builtIn": false,
      "order": 1,
      "createdAt": 1747123200000
    }
  ],
  "bookmarks": [
    {
      "id": "bookmark-001",
      "title": "DoShelf 项目",
      "url": "https://github.com/example/do-shelf#readme",
      "normalizedUrl": "https://github.com/example/do-shelf",
      "faviconUrl": "https://github.com/favicon.ico",
      "createdAt": 1747123200000
    }
  ],
  "categoryBookmarks": [
    {
      "id": "relation-001",
      "categoryId": "category-preset-default",
      "bookmarkId": "bookmark-001",
      "order": 0,
      "createdAt": 1747123200000
    },
    {
      "id": "relation-002",
      "categoryId": "category-work",
      "bookmarkId": "bookmark-001",
      "order": 0,
      "createdAt": 1747126800000
    }
  ],
  "settings": {}
}
```
