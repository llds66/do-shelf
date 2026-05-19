<script setup lang="ts">
import browser from 'webextension-polyfill'
import { computed, onMounted, ref } from 'vue'
import { useManagerData } from '../useManagerData'
import {
  ALL_CATEGORY_VIEW_ID,
  type BookmarkRecord,
  type CategoryWithCount,
} from '~/shared/bookmarks'
import {
  addCategory,
  deleteBookmark,
  removeBookmarkFromCategory,
  removeCategory,
} from '~/shared/storage'

const BOOKMARK_ACTION_OPTIONS = [
  { label: '打开链接', key: 'open' },
  { label: '复制链接', key: 'copy' },
] as const

type BookmarkActionKey = (typeof BOOKMARK_ACTION_OPTIONS)[number]['key']

const {
  categories,
  categoriesWithCounts,
  isDefaultCategory,
  refreshData,
  shelfData,
  selectedBookmarks,
  selectedCategory,
  selectedCategoryId,
  showErrorMessage,
  showSuccessMessage,
  tabsRenderKey,
} = useManagerData()

const removingBookmarkId = ref('')
const removingFromCategoryBookmarkId = ref('')
const showCategoryManager = ref(false)
const newCategory = ref('')
const isAddingCategory = ref(false)
const deletingCategoryId = ref('')
const managerCategories = computed(() =>
  categoriesWithCounts.value.filter((category) => category.id !== ALL_CATEGORY_VIEW_ID),
)
const categoryNamesById = computed(
  () => new Map(categories.value.map((category) => [category.id, category.name] as const)),
)
const isAllCategoryViewSelected = computed(() => selectedCategoryId.value === ALL_CATEGORY_VIEW_ID)

async function openBookmark(url: string) {
  await browser.tabs.create({ url })
}

async function copyBookmarkUrl(url: string) {
  try {
    await navigator.clipboard.writeText(url)
    showSuccessMessage('链接已复制')
  } catch {
    showErrorMessage('复制失败')
  }
}

async function handleDeleteBookmark(bookmarkId: string) {
  if (removingBookmarkId.value || removingFromCategoryBookmarkId.value) return

  removingBookmarkId.value = bookmarkId

  try {
    await deleteBookmark(bookmarkId)
    await refreshData()
    showSuccessMessage('已成功移除')
  } finally {
    removingBookmarkId.value = ''
  }
}

async function handleRemoveBookmarkFromCurrentCategory(bookmarkId: string) {
  if (
    removingBookmarkId.value ||
    removingFromCategoryBookmarkId.value ||
    isAllCategoryViewSelected.value
  )
    return

  removingFromCategoryBookmarkId.value = bookmarkId

  try {
    const result = await removeBookmarkFromCategory(selectedCategoryId.value, bookmarkId)
    if (!result.removed) {
      showErrorMessage('当前分类移除失败')
      return
    }

    await refreshData()
    showSuccessMessage('已成功移除')
  } finally {
    removingFromCategoryBookmarkId.value = ''
  }
}

async function handleBookmarkAction(action: string, bookmark: BookmarkRecord) {
  if (action === 'open') {
    await openBookmark(bookmark.url)
    return
  }

  if (action === 'copy') await copyBookmarkUrl(bookmark.url)
}

function openCategoryManager() {
  showCategoryManager.value = true
}

function openCategoryManagerFromUrl() {
  const params = new URLSearchParams(window.location.search)
  if (params.get('openCategoryManager') !== '1') return

  showCategoryManager.value = true
  params.delete('openCategoryManager')

  const nextSearch = params.toString()
  const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`
  window.history.replaceState({}, '', nextUrl)
}

function getCategoryDisplayName(category: CategoryWithCount) {
  return category.name
}

function getBookmarkCategoryNames(bookmarkId: string) {
  return shelfData.value.categoryBookmarks
    .filter((relation) => relation.bookmarkId === bookmarkId)
    .sort((left, right) => left.order - right.order)
    .map((relation) => categoryNamesById.value.get(relation.categoryId))
    .filter((name): name is string => Boolean(name))
}

async function handleAddCategory() {
  const nextCategory = newCategory.value.trim()
  if (!nextCategory || isAddingCategory.value) return

  isAddingCategory.value = true

  try {
    const category = await addCategory(nextCategory)
    if (!category) {
      showErrorMessage('分类已存在或名称无效')
      return
    }

    newCategory.value = ''
    await refreshData()
    selectedCategoryId.value = category.id
    showSuccessMessage('分类已添加')
  } finally {
    isAddingCategory.value = false
  }
}

async function handleDeleteCategory(category: CategoryWithCount) {
  if (deletingCategoryId.value) return

  deletingCategoryId.value = category.id

  try {
    const result = await removeCategory(category.id)
    if (!result) {
      showErrorMessage('预设分类不能删除')
      return
    }

    await refreshData()

    showSuccessMessage(`分类已删除，移除了 ${result.removedRelationCount} 条归属`)
  } finally {
    deletingCategoryId.value = ''
  }
}

onMounted(() => {
  openCategoryManagerFromUrl()
})
</script>

<template>
  <div class="pt-3">
    <div class="bookmarks-tabs flex items-center gap-3">
      <div
        class="min-w-0 flex-1 rounded-3xl border border-white/8 bg-white/2 backdrop-blur-xl px-4 py-1"
      >
        <n-tabs :key="tabsRenderKey" v-model:value="selectedCategoryId" type="line" animated>
          <n-tab-pane
            v-for="category in categoriesWithCounts"
            :key="category.id"
            :name="category.id"
          >
            <template #tab>
              <div class="flex items-baseline gap-1">
                <span>{{ getCategoryDisplayName(category) }}</span>
                <span class="text-[11px] text-neutral-500"> ({{ category.count }}) </span>
              </div>
            </template>
          </n-tab-pane>
        </n-tabs>
      </div>

      <n-button secondary class="shrink-0" @click="openCategoryManager">
        <template #icon>
          <div class="i-lucide-settings-2 h-[16px] w-[16px] text-[16px]" />
        </template>
        分类管理
      </n-button>
    </div>
  </div>

  <n-scrollbar class="min-h-0 flex-1 py-5">
    <section v-if="selectedBookmarks.length" class="flex flex-col gap-3">
      <n-card
        v-for="bookmark in selectedBookmarks"
        :key="bookmark.id"
        :bordered="false"
        content-class="!p-0"
      >
        <div class="flex items-center gap-3 px-4 py-3">
          <img
            v-if="bookmark.faviconUrl"
            :src="bookmark.faviconUrl"
            alt=""
            class="h-5 w-5 shrink-0 rounded-sm"
          />

          <div class="min-w-0 flex-1">
            <n-button
              text
              class="w-full justify-start !px-0 text-left !text-[15px] !font-700 !text-neutral-300 hover:text-neutral-100!"
              @click="openBookmark(bookmark.url)"
            >
              <n-ellipsis>
                {{ bookmark.title }}
              </n-ellipsis>
            </n-button>

            <div
              v-if="getBookmarkCategoryNames(bookmark.id).length"
              class="mt-2 flex flex-wrap gap-1.5"
            >
              <n-tag
                v-for="categoryName in getBookmarkCategoryNames(bookmark.id)"
                :key="`${bookmark.id}-${categoryName}`"
                size="small"
                round
                :bordered="false"
                class="bg-white/8!"
              >
                {{ categoryName }}
              </n-tag>
            </div>
          </div>

          <div class="flex shrink-0 items-center gap-2">
            <n-dropdown
              trigger="click"
              :options="BOOKMARK_ACTION_OPTIONS"
              @select="(key: string) => handleBookmarkAction(key as BookmarkActionKey, bookmark)"
            >
              <n-button
                text
                quaternary
                circle
                class="!h-8 !w-8 !text-neutral-300 hover:!text-white"
              >
                <div class="i-lucide-ellipsis h-[18px] w-[18px] text-[18px]" />
              </n-button>
            </n-dropdown>

            <n-popconfirm
              v-if="!isAllCategoryViewSelected"
              positive-text="确认"
              :negative-text="null"
              @positive-click="handleRemoveBookmarkFromCurrentCategory(bookmark.id)"
            >
              <template #trigger>
                <n-button
                  text
                  quaternary
                  circle
                  class="!h-8 !w-8 !text-neutral-300 hover:!text-white"
                  :loading="removingFromCategoryBookmarkId === bookmark.id"
                >
                  <div class="i-lucide-trash-2 h-[18px] w-[18px] text-[18px]" />
                </n-button>
              </template>
              该标签将从此分类移除
            </n-popconfirm>

            <n-popconfirm
              v-else
              positive-text="确认"
              :negative-text="null"
              @positive-click="handleDeleteBookmark(bookmark.id)"
            >
              <template #trigger>
                <n-button
                  text
                  type="error"
                  quaternary
                  circle
                  class="!h-8 !w-8 !text-neutral-300 hover:!text-white"
                  :loading="removingBookmarkId === bookmark.id"
                >
                  <div class="i-lucide-trash-2 h-[18px] w-[18px] text-[18px]" />
                </n-button>
              </template>
              该收藏将从所有分类移除
            </n-popconfirm>
          </div>
        </div>
      </n-card>
    </section>

    <section v-else class="flex min-h-full items-center justify-center py-10">
      <n-empty :description="selectedCategory ? '当前分类暂无收藏' : '无'" />
    </section>
  </n-scrollbar>

  <n-modal
    v-model:show="showCategoryManager"
    preset="card"
    class="category-manager-modal h-[560px] w-[min(680px,calc(100vw-32px))]"
    :bordered="false"
    title="分类管理"
    segmented
  >
    <div class="flex flex-col gap-5">
      <div class="flex gap-2">
        <n-input
          v-model:value="newCategory"
          maxlength="24"
          placeholder="新分类名称"
          @keydown.enter.prevent="handleAddCategory"
        />
        <n-button type="primary" round :loading="isAddingCategory" @click="handleAddCategory">
          新增
        </n-button>
      </div>

      <div class="category-manager-scroll h-[400px] overflow-y-auto pr-1">
        <div class="flex flex-col gap-1.5">
          <div
            v-for="category in managerCategories"
            :key="category.id"
            class="flex items-center justify-between gap-2 rounded-xl border border-white/8 bg-white/4 px-3 py-2.5"
          >
            <div class="min-w-0 flex items-center gap-2.5">
              <div class="truncate text-[14px] font-700 text-white">
                {{ getCategoryDisplayName(category) }}
              </div>
              <div class="shrink-0 text-[12px] text-neutral-400">{{ category.count }} 条</div>
            </div>

            <div class="flex shrink-0 items-center gap-1.5">
              <n-tag v-if="isDefaultCategory(category.id)" size="small" round :bordered="false">
                预设
              </n-tag>
              <n-popconfirm
                v-else
                positive-text="确认"
                negative-text="取消"
                @positive-click="handleDeleteCategory(category)"
              >
                <template #trigger>
                  <n-button
                    text
                    type="error"
                    size="small"
                    :loading="deletingCategoryId === category.id"
                  >
                    删除
                  </n-button>
                </template>
                删除分类“{{ category.name }}”？若相关收藏不再属于其他分类，它们会被一并删除。
              </n-popconfirm>
            </div>
          </div>
        </div>
      </div>
    </div>
  </n-modal>
</template>

<style scoped>
.category-manager-modal :deep(.n-card) {
  height: 100%;
}

.category-manager-modal :deep(.n-card__content) {
  height: 100%;
}

.bookmarks-tabs :deep(.v-x-scroll) {
  padding-bottom: 2px;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.28) transparent;
}

.bookmarks-tabs :deep(.v-x-scroll::-webkit-scrollbar) {
  width: 8px;
  height: 6px;
}

.bookmarks-tabs :deep(.v-x-scroll::-webkit-scrollbar-track) {
  background: transparent;
}

.bookmarks-tabs :deep(.v-x-scroll::-webkit-scrollbar-thumb) {
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.28);
}

.category-manager-scroll {
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.28) transparent;
}

.category-manager-scroll::-webkit-scrollbar {
  width: 6px;
}

.category-manager-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.category-manager-scroll::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.28);
}

:deep(.n-tabs .n-tabs-nav.n-tabs-nav--line-type.n-tabs-nav--top .n-tabs-nav-scroll-content) {
  border-bottom: none;
}

:deep(.n-tabs .n-tabs-pane-wrapper) {
  display: none;
}
</style>
