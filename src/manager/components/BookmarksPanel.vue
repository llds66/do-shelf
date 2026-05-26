<script setup lang="ts">
import Sortable from 'sortablejs'
import browser from 'webextension-polyfill'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useManagerData } from '../useManagerData'
import { ALL_CATEGORY_VIEW_ID, type BookmarkRecord } from '~/shared/bookmarks'
import {
  deleteBookmark,
  removeBookmarkFromCategory,
  reorderBookmarksInCategory,
  saveBookmarkInCategories,
} from '~/shared/storage'

const BOOKMARK_ACTION_OPTIONS = [
  { label: '打开链接', key: 'open' },
  { label: '复制链接', key: 'copy' },
  { label: '编辑分类', key: 'edit-categories' },
] as const

type BookmarkActionKey = (typeof BOOKMARK_ACTION_OPTIONS)[number]['key']

const {
  categories,
  categoriesWithCounts,
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
const showEditCategoriesModal = ref(false)
const showBookmarkSearch = ref(false)
const bookmarkSearchKeyword = ref('')
const editingBookmarkId = ref('')
const editingCategoryIds = ref<string[]>([])
const bookmarkListRef = ref<HTMLElement | null>(null)
const bookmarkListItems = ref<BookmarkRecord[]>([])
const isReorderingBookmarks = ref(false)
const isSavingCategoryEdit = ref(false)
const categoryNamesById = computed(
  () => new Map(categories.value.map((category) => [category.id, category.name] as const)),
)
const isAllCategoryViewSelected = computed(() => selectedCategoryId.value === ALL_CATEGORY_VIEW_ID)
const normalizedBookmarkSearchKeyword = computed(() =>
  bookmarkSearchKeyword.value.trim().toLocaleLowerCase(),
)
const hasBookmarkSearchKeyword = computed(() => Boolean(normalizedBookmarkSearchKeyword.value))
const bookmarkSearchPlaceholder = computed(() =>
  selectedCategory.value ? `搜索「${selectedCategory.value.name}」中的收藏` : '搜索分类中的收藏',
)
const filteredBookmarks = computed(() => {
  const keyword = normalizedBookmarkSearchKeyword.value
  if (!keyword) return selectedBookmarks.value

  return selectedBookmarks.value.filter((bookmark) =>
    bookmark.title.toLocaleLowerCase().includes(keyword),
  )
})
const emptyDescription = computed(() => {
  if (hasBookmarkSearchKeyword.value) return '没有找到匹配的收藏'
  return selectedCategory.value ? '当前分类暂无收藏' : '无'
})
const canDragSortBookmarks = computed(
  () =>
    !isAllCategoryViewSelected.value &&
    !hasBookmarkSearchKeyword.value &&
    bookmarkListItems.value.length > 1,
)
const editingBookmark = computed(() =>
  shelfData.value.bookmarks.find((bookmark) => bookmark.id === editingBookmarkId.value),
)
const displayCategories = computed(() => categories.value)
let bookmarkListSortable: Sortable | null = null

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

  if (action === 'edit-categories') {
    openEditCategoriesModal(bookmark)
    return
  }

  if (action === 'copy') await copyBookmarkUrl(bookmark.url)
}

function toggleBookmarkSearch() {
  showBookmarkSearch.value = !showBookmarkSearch.value

  if (!showBookmarkSearch.value) bookmarkSearchKeyword.value = ''
}

function syncBookmarkListItems() {
  bookmarkListItems.value = [...filteredBookmarks.value]
}

function destroyBookmarkListSortable() {
  bookmarkListSortable?.destroy()
  bookmarkListSortable = null
}

async function handleBookmarkSortChange(oldIndex: number, newIndex: number) {
  if (
    isReorderingBookmarks.value ||
    oldIndex === newIndex ||
    isAllCategoryViewSelected.value ||
    hasBookmarkSearchKeyword.value
  )
    return

  const nextItems = [...bookmarkListItems.value]
  const [movedBookmark] = nextItems.splice(oldIndex, 1)
  if (!movedBookmark) return

  nextItems.splice(newIndex, 0, movedBookmark)
  bookmarkListItems.value = nextItems
  isReorderingBookmarks.value = true

  try {
    await reorderBookmarksInCategory(
      selectedCategoryId.value,
      nextItems.map((bookmark) => bookmark.id),
    )
    await refreshData()
    showSuccessMessage('当前分类中的收藏顺序已更新')
  } catch {
    syncBookmarkListItems()
    showErrorMessage('收藏排序更新失败')
  } finally {
    isReorderingBookmarks.value = false
  }
}

function setupBookmarkListSortable() {
  if (!bookmarkListRef.value || !canDragSortBookmarks.value) return

  destroyBookmarkListSortable()

  bookmarkListSortable = Sortable.create(bookmarkListRef.value, {
    animation: 180,
    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    handle: '.bookmark-drag-handle',
    draggable: '.bookmark-list-item',
    ghostClass: 'bookmark-sort-ghost',
    chosenClass: 'bookmark-sort-chosen',
    dragClass: 'bookmark-sort-drag',
    onEnd: (event: { oldIndex?: number; newIndex?: number }) => {
      if (event.oldIndex == null || event.newIndex == null) return
      void handleBookmarkSortChange(event.oldIndex, event.newIndex)
    },
  })
}

function getBookmarkCategoryIds(bookmarkId: string) {
  return shelfData.value.categoryBookmarks
    .filter((relation) => relation.bookmarkId === bookmarkId)
    .sort((left, right) => left.order - right.order)
    .map((relation) => relation.categoryId)
}

function resetEditCategoriesState() {
  showEditCategoriesModal.value = false
  editingBookmarkId.value = ''
  editingCategoryIds.value = []
}

function openEditCategoriesModal(bookmark: BookmarkRecord) {
  editingBookmarkId.value = bookmark.id
  editingCategoryIds.value = getBookmarkCategoryIds(bookmark.id)
  showEditCategoriesModal.value = true
}

function closeEditCategoriesModal() {
  if (isSavingCategoryEdit.value) return
  resetEditCategoriesState()
}

function isEditingCategorySelected(categoryId: string) {
  return editingCategoryIds.value.includes(categoryId)
}

function updateEditingCategorySelection(categoryId: string, checked: boolean) {
  if (isSavingCategoryEdit.value) return

  if (checked) {
    editingCategoryIds.value = Array.from(new Set([...editingCategoryIds.value, categoryId]))
    return
  }

  editingCategoryIds.value = editingCategoryIds.value.filter((id) => id !== categoryId)
}

function toggleEditingCategorySelection(categoryId: string) {
  updateEditingCategorySelection(categoryId, !isEditingCategorySelected(categoryId))
}

function getCategoryDisplayName(category: { name: string }) {
  return category.name
}

function getBookmarkCategoryNames(bookmarkId: string) {
  return getBookmarkCategoryIds(bookmarkId)
    .map((categoryId) => categoryNamesById.value.get(categoryId))
    .filter((name): name is string => Boolean(name))
}

async function handleConfirmEditCategories() {
  const bookmark = editingBookmark.value
  if (!bookmark || isSavingCategoryEdit.value) return

  isSavingCategoryEdit.value = true

  try {
    const nextCategoryIds = [...editingCategoryIds.value]

    if (!nextCategoryIds.length) {
      await deleteBookmark(bookmark.id)
      await refreshData()
      showSuccessMessage('已取消收藏')
      resetEditCategoriesState()
      return
    }

    await saveBookmarkInCategories({
      bookmarkId: bookmark.id,
      title: bookmark.title,
      url: bookmark.url,
      faviconUrl: bookmark.faviconUrl,
      categoryIds: nextCategoryIds,
    })

    await refreshData()
    showSuccessMessage('收藏分类已更新')
    resetEditCategoriesState()
  } finally {
    isSavingCategoryEdit.value = false
  }
}

watch(
  [filteredBookmarks, canDragSortBookmarks],
  async () => {
    syncBookmarkListItems()

    if (!canDragSortBookmarks.value) {
      destroyBookmarkListSortable()
      return
    }

    await nextTick()
    setupBookmarkListSortable()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  destroyBookmarkListSortable()
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

      <n-button secondary class="shrink-0" @click="toggleBookmarkSearch">
        <template #icon>
          <div class="i-lucide-search h-[16px] w-[16px] text-[16px]" />
        </template>
        {{ showBookmarkSearch ? '关闭搜索' : '搜索' }}
      </n-button>
    </div>

    <div v-if="showBookmarkSearch" class="mt-4">
      <n-input
        v-model:value="bookmarkSearchKeyword"
        clearable
        size="large"
        round
        :placeholder="bookmarkSearchPlaceholder"
      >
        <template #prefix>
          <div class="i-lucide-search h-[16px] w-[16px] text-[16px] text-neutral-500" />
        </template>
      </n-input>
    </div>
  </div>

  <n-scrollbar class="min-h-0 flex-1 py-5">
    <section v-if="bookmarkListItems.length" class="flex flex-col gap-3">
      <div ref="bookmarkListRef" class="flex flex-col gap-3">
        <n-card
          v-for="bookmark in bookmarkListItems"
          :key="bookmark.id"
          class="bookmark-list-item"
          :bordered="false"
          content-class="!p-0"
        >
          <div class="flex items-center gap-3 px-4 py-3">
            <button
              v-if="!isAllCategoryViewSelected"
              type="button"
              class="bookmark-drag-handle inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/8 bg-white/3 text-neutral-400 transition hover:border-white/14 hover:text-neutral-200"
              :class="
                canDragSortBookmarks
                  ? 'cursor-grab active:cursor-grabbing'
                  : 'cursor-not-allowed opacity-60'
              "
              :disabled="!canDragSortBookmarks || isReorderingBookmarks"
              :aria-label="hasBookmarkSearchKeyword ? '搜索结果中暂不支持排序' : '拖动排序'"
              :title="hasBookmarkSearchKeyword ? '搜索结果中暂不支持排序' : '拖动排序'"
            >
              <div class="i-lucide-grip h-[16px] w-[16px] text-[16px]" />
            </button>

            <img
              v-if="bookmark.faviconUrl"
              :src="bookmark.faviconUrl"
              alt=""
              class="h-5 w-5 shrink-0 rounded-sm"
            />

            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <n-button
                  text
                  class="min-w-0 flex-1 justify-start !px-0 text-left !text-[15px] !font-700 !text-neutral-300 hover:text-neutral-100!"
                  @click="openBookmark(bookmark.url)"
                >
                  <n-ellipsis>
                    {{ bookmark.title }}
                  </n-ellipsis>
                </n-button>

                <div
                  v-if="getBookmarkCategoryNames(bookmark.id).length"
                  class="flex flex-wrap gap-1.5"
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
      </div>
    </section>

    <section v-else class="flex min-h-full items-center justify-center py-10">
      <n-empty :description="emptyDescription" />
    </section>
  </n-scrollbar>

  <n-modal
    :show="showEditCategoriesModal"
    preset="card"
    class="edit-categories-modal w-[min(520px,calc(100vw-32px))]"
    :bordered="false"
    title="编辑分类"
    segmented
    @update:show="(show: boolean) => !show && closeEditCategoriesModal()"
  >
    <div class="flex flex-col gap-5">
      <div class="flex flex-wrap gap-2">
        <div
          v-for="category in displayCategories"
          :key="`edit-category-${category.id}`"
          class="inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm text-neutral-100 transition"
          :class="
            isEditingCategorySelected(category.id)
              ? 'border-white/30 bg-white/12'
              : 'border-white/8 bg-white/4'
          "
          :style="{
            cursor: isSavingCategoryEdit ? 'default' : 'pointer',
            opacity: isSavingCategoryEdit ? '0.72' : '1',
          }"
          @click="toggleEditingCategorySelection(category.id)"
        >
          <n-checkbox
            :checked="isEditingCategorySelected(category.id)"
            :disabled="isSavingCategoryEdit"
            @click.stop
            @update:checked="
              (checked: boolean) => updateEditingCategorySelection(category.id, checked)
            "
          />
          <span>{{ category.name }}</span>
        </div>
      </div>

      <div class="flex items-center justify-end gap-2">
        <n-button :disabled="isSavingCategoryEdit" @click="closeEditCategoriesModal">
          取消
        </n-button>
        <n-button
          type="primary"
          :loading="isSavingCategoryEdit"
          @click="handleConfirmEditCategories"
        >
          确认
        </n-button>
      </div>
    </div>
  </n-modal>
</template>

<style scoped>
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

.bookmark-list-item {
  will-change: transform;
}

.bookmark-list-item.bookmark-sort-ghost {
  border-color: rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.08);
  opacity: 0.72;
}

.bookmark-list-item.bookmark-sort-chosen {
  border-color: rgba(255, 255, 255, 0.22);
  background: rgba(255, 255, 255, 0.08);
  box-shadow: 0 20px 36px rgba(0, 0, 0, 0.18);
}

.bookmark-list-item.bookmark-sort-drag {
  opacity: 0.98;
}

:deep(.n-tabs .n-tabs-nav.n-tabs-nav--line-type.n-tabs-nav--top .n-tabs-nav-scroll-content) {
  border-bottom: none;
}

:deep(.n-tabs .n-tabs-pane-wrapper) {
  display: none;
}
</style>
