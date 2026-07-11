<script setup lang="ts">
import Sortable from 'sortablejs'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useManagerData } from '../useManagerData'
import { ALL_CATEGORY_VIEW_ID, type CategoryWithCount } from '~/shared/bookmarks'
import { addCategory, removeCategory, renameCategory, reorderCategories } from '~/shared/storage'

const {
  categoriesWithCounts,
  isDefaultCategory,
  refreshData,
  selectedCategoryId,
  showErrorMessage,
  showSuccessMessage,
} = useManagerData()

const newCategory = ref('')
const categoryManagerListRef = ref<HTMLElement | null>(null)
const managerCategoryItems = ref<CategoryWithCount[]>([])
const isAddingCategory = ref(false)
const isReorderingCategories = ref(false)
const deletingCategoryId = ref('')
const showRenameModal = ref(false)
const renamingCategoryId = ref('')
const renamingCategoryName = ref('')
const isRenamingCategory = ref(false)
const managerCategories = computed(() =>
  categoriesWithCounts.value.filter((category) => category.id !== ALL_CATEGORY_VIEW_ID),
)
let categoryManagerSortable: Sortable | null = null
const canConfirmRename = computed(() => {
  const nextName = renamingCategoryName.value.trim()
  if (!nextName) return false

  const currentCategory = managerCategoryItems.value.find(
    (category) => category.id === renamingCategoryId.value,
  )

  return Boolean(currentCategory && currentCategory.name !== nextName)
})

function syncManagerCategoryItems() {
  managerCategoryItems.value = [...managerCategories.value]
}

function destroyCategoryManagerSortable() {
  categoryManagerSortable?.destroy()
  categoryManagerSortable = null
}

async function handleCategorySortChange(oldIndex: number, newIndex: number) {
  if (isReorderingCategories.value || oldIndex === newIndex) return

  const nextItems = [...managerCategoryItems.value]
  const [movedCategory] = nextItems.splice(oldIndex, 1)
  if (!movedCategory) return

  nextItems.splice(newIndex, 0, movedCategory)
  managerCategoryItems.value = nextItems
  isReorderingCategories.value = true

  try {
    await reorderCategories(nextItems.map((category) => category.id))
    await refreshData()
    showSuccessMessage('分类顺序已更新')
  } catch {
    syncManagerCategoryItems()
    showErrorMessage('分类排序更新失败')
  } finally {
    isReorderingCategories.value = false
  }
}

function setupCategoryManagerSortable() {
  if (!categoryManagerListRef.value) return

  destroyCategoryManagerSortable()

  categoryManagerSortable = Sortable.create(categoryManagerListRef.value, {
    animation: 180,
    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    handle: '.category-manager-drag-handle',
    draggable: '.category-manager-item',
    ghostClass: 'category-manager-sort-ghost',
    chosenClass: 'category-manager-sort-chosen',
    dragClass: 'category-manager-sort-drag',
    onEnd: (event: { oldIndex?: number; newIndex?: number }) => {
      if (event.oldIndex == null || event.newIndex == null) return
      void handleCategorySortChange(event.oldIndex, event.newIndex)
    },
  })
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

function openRenameModal(category: CategoryWithCount) {
  renamingCategoryId.value = category.id
  renamingCategoryName.value = category.name
  showRenameModal.value = true
}

function closeRenameModal() {
  if (isRenamingCategory.value) return

  showRenameModal.value = false
  renamingCategoryId.value = ''
  renamingCategoryName.value = ''
}

async function handleConfirmRename() {
  if (!canConfirmRename.value || isRenamingCategory.value) return

  isRenamingCategory.value = true

  try {
    const renamedCategory = await renameCategory(
      renamingCategoryId.value,
      renamingCategoryName.value,
    )
    if (!renamedCategory) {
      showErrorMessage('分类名称无效、重复，或该分类不支持修改')
      return
    }

    await refreshData()
    showSuccessMessage('分类名称已更新')
    closeRenameModal()
  } finally {
    isRenamingCategory.value = false
  }
}

watch(
  managerCategories,
  async () => {
    syncManagerCategoryItems()
    await nextTick()
    setupCategoryManagerSortable()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  destroyCategoryManagerSortable()
})
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col py-5">
    <div class="flex flex-col gap-5">
      <div class="flex flex-col gap-3 rounded-[28px] border">
        <div class="flex flex-col gap-2 sm:flex-row">
          <n-input
            v-model:value="newCategory"
            maxlength="24"
            placeholder="输入新分类名称"
            @keydown.enter.prevent="handleAddCategory"
          />
          <n-button
            secondary
            :loading="isAddingCategory"
            :disabled="!newCategory.trim()"
            @click="handleAddCategory"
          >
            新增分类
          </n-button>
        </div>
      </div>
    </div>

    <n-scrollbar class="min-h-0 flex-1 py-5">
      <div class="category-manager-scroll pr-1">
        <div ref="categoryManagerListRef" class="flex flex-col gap-2">
          <div
            v-for="category in managerCategoryItems"
            :key="category.id"
            class="category-manager-item flex items-center justify-between gap-2.5 rounded-2xl border border-white/8 bg-white/4 px-3 py-2 transition-colors"
          >
            <div class="min-w-0 flex items-center gap-2.5">
              <button
                type="button"
                class="category-manager-drag-handle inline-flex h-7 w-7 shrink-0 cursor-grab items-center justify-center rounded-full border border-white/8 bg-white/3 text-neutral-400 transition hover:border-white/14 hover:text-neutral-200 active:cursor-grabbing"
                :disabled="isReorderingCategories"
                aria-label="拖动排序"
                title="拖动排序"
              >
                <div class="i-lucide-grip h-[10px] w-[10px] text-[10px]" />
              </button>

              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <div class="truncate text-[14px] font-700 text-white">{{ category.name }}</div>
                  <div class="shrink-0 text-[12px] text-neutral-500">{{ category.count }} 条</div>
                  <n-tag v-if="isDefaultCategory(category.id)" size="small" round :bordered="false">
                    预设
                  </n-tag>
                </div>
              </div>
            </div>

            <div class="flex shrink-0 items-center gap-1">
              <n-button
                v-if="!isDefaultCategory(category.id)"
                text
                quaternary
                circle
                class="!h-7 !w-7 !text-neutral-300 hover:!text-white"
                :disabled="isReorderingCategories"
                @click="openRenameModal(category)"
              >
                <div class="i-lucide-pencil h-[16px] w-[16px] text-[16px]" />
              </n-button>
              <n-popconfirm
                v-if="!isDefaultCategory(category.id)"
                positive-text="确认"
                negative-text="取消"
                @positive-click="handleDeleteCategory(category)"
              >
                <template #trigger>
                  <n-button
                    text
                    type="error"
                    quaternary
                    circle
                    class="!h-7 !w-7 !text-neutral-300 hover:!text-white"
                    :disabled="isReorderingCategories"
                    :loading="deletingCategoryId === category.id"
                  >
                    <div class="i-lucide-trash-2 h-[16px] w-[16px] text-[16px]" />
                  </n-button>
                </template>
                删除分类“{{ category.name }}”？若相关收藏不再属于其他分类，它们会被一并删除。
              </n-popconfirm>
            </div>
          </div>
        </div>
      </div>
    </n-scrollbar>

    <n-modal
      :show="showRenameModal"
      preset="card"
      class="w-[min(420px,calc(100vw-32px))]"
      :bordered="false"
      title="修改分类名称"
      segmented
      @update:show="(show: boolean) => !show && closeRenameModal()"
    >
      <div class="flex flex-col gap-4">
        <n-input
          v-model:value="renamingCategoryName"
          maxlength="24"
          placeholder="输入新的分类名称"
          :disabled="isRenamingCategory"
          @keydown.enter.prevent="handleConfirmRename"
        />

        <div class="flex items-center justify-end gap-2">
          <n-button :disabled="isRenamingCategory" @click="closeRenameModal">取消</n-button>
          <n-button
            type="primary"
            :loading="isRenamingCategory"
            :disabled="!canConfirmRename"
            @click="handleConfirmRename"
          >
            确认修改
          </n-button>
        </div>
      </div>
    </n-modal>
  </div>
</template>

<style scoped>
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

.category-manager-item {
  will-change: transform;
}

.category-manager-item.category-manager-sort-ghost {
  border-color: rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.08);
  opacity: 0.72;
}

.category-manager-item.category-manager-sort-chosen {
  border-color: rgba(255, 255, 255, 0.22);
  background: rgba(255, 255, 255, 0.08);
  box-shadow: 0 18px 36px rgba(0, 0, 0, 0.18);
}

.category-manager-item.category-manager-sort-drag {
  opacity: 0.98;
}
</style>
