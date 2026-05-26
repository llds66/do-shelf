<script setup lang="ts">
import NumberFlow from '@number-flow/vue'
import browser from 'webextension-polyfill'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useManagerData } from '../useManagerData'
import {
  buildCategorySelectionOptions,
  buildExportDataByCategoryIds,
  buildExportFilename,
  buildShelfDataForImportByCategory,
  parseImportedShelfData,
  type CategorySelectionOption,
  type ImportStrategy,
} from '~/shared/import-export'
import type { DoShelfData } from '~/shared/bookmarks'
import { clearShelfData, getShelfData, saveShelfData } from '~/shared/storage'

const {
  totalBookmarks,
  totalCategories,
  refreshData,
  shelfData,
  showErrorMessage,
  showSuccessMessage,
} = useManagerData()
const importInputRef = ref<HTMLInputElement | null>(null)
const clearConfirmText = ref('')
const isImporting = ref(false)
const isExporting = ref(false)
const isClearing = ref(false)
const animatedTotalCategories = ref(0)
const animatedTotalBookmarks = ref(0)
const showImportConfirm = ref(false)
const showExportConfirm = ref(false)
const showClearConfirm = ref(false)
const pendingImportFilename = ref('')
const pendingImportData = ref<DoShelfData | null>(null)
const exportCategoryIds = ref<string[]>([])
const importCategoryIds = ref<string[]>([])
const importStrategy = ref<ImportStrategy>('replace')
const canConfirmClear = computed(() => clearConfirmText.value === 'do-shelf')
const exportCategoryOptions = computed(() => buildCategorySelectionOptions(shelfData.value))
const importCategoryOptions = computed<CategorySelectionOption[]>(() =>
  pendingImportData.value ? buildCategorySelectionOptions(pendingImportData.value) : [],
)
const canConfirmImport = computed(
  () => Boolean(pendingImportData.value) && importCategoryIds.value.length > 0,
)
const canConfirmExport = computed(() => exportCategoryIds.value.length > 0)
const selectedExportCategoryLabels = computed(() =>
  exportCategoryOptions.value
    .filter((category) => exportCategoryIds.value.includes(category.id))
    .map((category) => category.name),
)
let animationFrameId: number | null = null

function syncAnimatedTotals() {
  if (typeof window === 'undefined') {
    animatedTotalCategories.value = totalCategories.value
    animatedTotalBookmarks.value = totalBookmarks.value
    return
  }

  if (animationFrameId !== null) cancelAnimationFrame(animationFrameId)

  animationFrameId = window.requestAnimationFrame(() => {
    animatedTotalCategories.value = totalCategories.value
    animatedTotalBookmarks.value = totalBookmarks.value
    animationFrameId = null
  })
}

function resetExportSelection() {
  exportCategoryIds.value = exportCategoryOptions.value.map((category) => category.id)
}

function resetImportOptions() {
  importCategoryIds.value = importCategoryOptions.value.map((category) => category.id)
  importStrategy.value = 'replace'
}

function updateSelectedCategoryIds(
  target: typeof exportCategoryIds | typeof importCategoryIds,
  id: string,
  checked: boolean,
) {
  const nextIds = new Set(target.value)

  if (checked) nextIds.add(id)
  else nextIds.delete(id)

  target.value = Array.from(nextIds)
}

function updateExportCategorySelection(id: string, checked: boolean) {
  updateSelectedCategoryIds(exportCategoryIds, id, checked)
}

function updateImportCategorySelection(id: string, checked: boolean) {
  updateSelectedCategoryIds(importCategoryIds, id, checked)
}

function openExportConfirm() {
  if (isExporting.value) return

  resetExportSelection()
  showExportConfirm.value = true
}

function resetExportState() {
  showExportConfirm.value = false
  exportCategoryIds.value = []
}

function openImportPicker() {
  if (isImporting.value) return

  importInputRef.value?.click()
}

function resetImportState() {
  showImportConfirm.value = false
  pendingImportFilename.value = ''
  pendingImportData.value = null
  importCategoryIds.value = []
  importStrategy.value = 'replace'
}

function openClearConfirm() {
  if (isClearing.value) return

  clearConfirmText.value = ''
  showClearConfirm.value = true
}

function resetClearState() {
  showClearConfirm.value = false
  clearConfirmText.value = ''
}

async function openExternalLink(url: string) {
  await browser.tabs.create({ url })
}

async function handleImportFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]

  input.value = ''

  if (!file || isImporting.value) return

  try {
    const rawText = await file.text()
    pendingImportData.value = parseImportedShelfData(rawText)
    pendingImportFilename.value = file.name
    resetImportOptions()
    showImportConfirm.value = true
  } catch (error) {
    showErrorMessage(error instanceof Error ? error.message : '导入文件解析失败')
  }
}

async function handleConfirmClear() {
  if (isClearing.value || clearConfirmText.value !== 'do-shelf') return

  isClearing.value = true

  try {
    await clearShelfData()
    await refreshData()
    showSuccessMessage('已清空标签数据')
    resetClearState()
  } catch {
    showErrorMessage('清空失败')
  } finally {
    isClearing.value = false
  }
}

async function handleConfirmImport() {
  if (!pendingImportData.value || isImporting.value || !canConfirmImport.value) return

  isImporting.value = true

  try {
    const currentData = await getShelfData()
    const nextData = buildShelfDataForImportByCategory({
      currentData,
      importedData: pendingImportData.value,
      categoryIds: importCategoryIds.value,
      strategy: importStrategy.value,
    })

    await saveShelfData(nextData)
    await refreshData()
    showSuccessMessage(
      importStrategy.value === 'replace' ? '按分类覆盖导入成功' : '按分类合并导入成功',
    )
    resetImportState()
  } catch (error) {
    showErrorMessage(error instanceof Error ? error.message : '导入失败')
  } finally {
    isImporting.value = false
  }
}

async function handleConfirmExport() {
  if (isExporting.value || !canConfirmExport.value) return

  isExporting.value = true

  try {
    const data = await getShelfData()
    const exportedAt = Date.now()
    const appVersion = browser.runtime.getManifest().version || '0.0.0'
    const exportData = buildExportDataByCategoryIds({
      data,
      categoryIds: exportCategoryIds.value,
      exportedAt,
      appVersion,
    })
    const payload = JSON.stringify(exportData, null, 2)
    const blob = new Blob([payload], { type: 'application/json;charset=utf-8' })
    const objectUrl = URL.createObjectURL(blob)
    const anchor = document.createElement('a')

    anchor.href = objectUrl
    anchor.download = buildExportFilename(exportedAt, appVersion)
    anchor.click()

    URL.revokeObjectURL(objectUrl)
    showSuccessMessage('按分类导出成功')
    resetExportState()
  } finally {
    isExporting.value = false
  }
}

onMounted(() => {
  syncAnimatedTotals()
})

watch([totalCategories, totalBookmarks], () => {
  syncAnimatedTotals()
})

onBeforeUnmount(() => {
  if (animationFrameId !== null) cancelAnimationFrame(animationFrameId)
})
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <input
      ref="importInputRef"
      type="file"
      accept=".json,application/json"
      class="hidden"
      @change="handleImportFileChange"
    />
    <n-scrollbar class="min-h-0 flex-1 py-5">
      <div class="grid gap-4">
        <n-card :bordered="false" title="数据">
          <template #header-extra>
            <div class="flex gap-2">
              <div class="text-[12px] font-700">
                <NumberFlow :value="animatedTotalCategories" /> 个分类
              </div>
              <div class="text-[12px] font-700">
                <NumberFlow :value="animatedTotalBookmarks" /> 条收藏
              </div>
            </div>
          </template>
          <div class="my-4 flex flex-wrap gap-4">
            <n-button secondary :loading="isImporting" @click="openImportPicker">
              <template #icon>
                <div class="i-lucide-file-up h-[16px] w-[16px] text-[16px]" />
              </template>
              导入数据
            </n-button>
            <n-button secondary :loading="isExporting" @click="openExportConfirm">
              <template #icon>
                <div class="i-lucide-file-down h-[16px] w-[16px] text-[16px]" />
              </template>
              导出数据
            </n-button>
            <n-button type="error" secondary :loading="isClearing" @click="openClearConfirm">
              <template #icon>
                <div class="i-lucide-trash-2 h-[16px] w-[16px] text-[16px]" />
              </template>
              清空全部数据
            </n-button>
          </div>
        </n-card>

        <n-card :bordered="false" title="相关链接">
          <div class="my-4 flex flex-wrap gap-4">
            <n-button secondary text @click="openExternalLink('https://doshelf.llds.cloud/')">
              <template #icon>
                <div class="i-lucide-link h-[16px] w-[16px] text-[16px]" />
              </template>
              官方网站
            </n-button>
            <n-button
              secondary
              text
              @click="
                openExternalLink(
                  'https://chromewebstore.google.com/detail/doshelf/cimpakecpbafknbammmnpiifekgjmbkl',
                )
              "
            >
              <template #icon>
                <div class="i-logos-chrome h-[16px] w-[16px] text-[16px]" />
              </template>
              Chrome 商店
            </n-button>
            <n-button
              secondary
              text
              @click="
                openExternalLink(
                  'https://microsoftedge.microsoft.com/addons/detail/doshelf/bmloldgelbkhglnaoghflbfdbojogfjg',
                )
              "
            >
              <template #icon>
                <div class="i-logos-microsoft-edge h-[16px] w-[16px] text-[16px]" />
              </template>
              Edge 商店
            </n-button>
            <n-button
              secondary
              text
              @click="openExternalLink('https://github.com/llds66/do-shelf')"
            >
              <template #icon>
                <div class="i-lucide-github h-[16px] w-[16px] text-[16px]" />
              </template>
              Github
            </n-button>
          </div>
        </n-card>
      </div>
    </n-scrollbar>

    <div class="px-5 pb-5 pt-2 text-center text-sm leading-6 text-neutral-500">
      <a
        href="https://github.com/llds66/do-shelf"
        target="_blank"
        rel="noopener noreferrer"
        class="mx-1 text-neutral-500 no-underline transition-colors duration-150 hover:text-neutral-300"
      >
        项目地址
      </a>
      | 基于
      <a
        href="https://github.com/antfu-collective/vitesse-webext"
        target="_blank"
        rel="noopener noreferrer"
        class="mx-1 text-neutral-500 no-underline transition-colors duration-150 hover:text-neutral-300"
      >
        vitesse-webext
      </a>
      |
      <a
        href="https://lsang.me"
        target="_blank"
        rel="noopener noreferrer"
        class="mx-1 text-neutral-500 no-underline transition-colors duration-150 hover:text-neutral-300"
      >
        @LsAng
      </a>
    </div>
  </div>

  <n-modal
    v-model:show="showExportConfirm"
    preset="card"
    class="w-[min(560px,calc(100vw-32px))]"
    :bordered="false"
    title="导出数据"
  >
    <div
      class="export-category-scroll mt-4 grid max-h-53 grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2"
    >
      <div
        v-for="category in exportCategoryOptions"
        :key="`export-${category.id}`"
        class="flex min-w-0 items-start justify-between rounded-2xl border border-white/8 bg-white/4 px-3 py-3"
      >
        <div class="flex min-w-0 items-center gap-2 pr-3">
          <div class="truncate text-[14px] text-neutral-200">{{ category.name }}</div>
          <div class="shrink-0 text-[12px] text-neutral-500">{{ category.count }} 条</div>
        </div>
        <n-checkbox
          :checked="exportCategoryIds.includes(category.id)"
          @update:checked="
            (checked: boolean) => updateExportCategorySelection(category.id, checked)
          "
        />
      </div>
    </div>

    <div class="mt-4 text-[13px] leading-6 text-neutral-500">
      已选择：{{ selectedExportCategoryLabels.join('、') || '未选择' }}
    </div>

    <div class="mt-5 flex justify-end gap-3">
      <n-button :disabled="isExporting" @click="resetExportState">取消</n-button>
      <n-button
        type="primary"
        :loading="isExporting"
        :disabled="!canConfirmExport"
        @click="handleConfirmExport"
      >
        确认导出
      </n-button>
    </div>
  </n-modal>

  <n-modal
    v-model:show="showImportConfirm"
    preset="card"
    class="w-[min(600px,calc(100vw-32px))]"
    :bordered="false"
    title="导入数据"
  >
    <div class="mt-3 text-[13px] leading-6 text-neutral-500">文件：{{ pendingImportFilename }}</div>

    <div
      class="export-category-scroll mt-4 grid max-h-53 grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2"
    >
      <div
        v-for="category in importCategoryOptions"
        :key="`import-${category.id}`"
        class="flex min-w-0 items-start justify-between rounded-2xl border border-white/8 bg-white/4 px-3 py-3"
      >
        <div class="flex min-w-0 items-center gap-2 pr-3">
          <div class="truncate text-[14px] text-neutral-200">{{ category.name }}</div>
          <div class="shrink-0 text-[12px] text-neutral-500">{{ category.count }} 条</div>
        </div>
        <n-checkbox
          :checked="importCategoryIds.includes(category.id)"
          @update:checked="
            (checked: boolean) => updateImportCategorySelection(category.id, checked)
          "
        />
      </div>
    </div>

    <div class="mt-4">
      <div class="mb-2 text-[13px] font-700 text-neutral-200">导入策略</div>
      <n-radio-group v-model:value="importStrategy" name="import-strategy">
        <div class="flex gap-2">
          <label
            class="flex cursor-pointer items-start gap-3 rounded-2xl border border-white/8 bg-white/4 px-3 py-3"
          >
            <n-radio value="replace" />
            <div>
              <div class="text-[14px] text-neutral-200">覆盖导入</div>
              <div class="mt-1 text-[12px] leading-5 text-neutral-500">整体替换当前本地书架</div>
            </div>
          </label>
          <label
            class="flex cursor-pointer items-start gap-3 rounded-2xl border border-white/8 bg-white/4 px-3 py-3"
          >
            <n-radio value="merge" />
            <div>
              <div class="text-[14px] text-neutral-200">合并导入</div>
              <div class="mt-1 text-[12px] leading-5 text-neutral-500">
                保留当前，合并导入内容。
              </div>
            </div>
          </label>
        </div>
      </n-radio-group>
    </div>

    <div class="mt-5 flex justify-end gap-3">
      <n-button :disabled="isImporting" @click="resetImportState">取消</n-button>
      <n-button
        type="primary"
        :loading="isImporting"
        :disabled="!canConfirmImport"
        @click="handleConfirmImport"
      >
        确认导入
      </n-button>
    </div>
  </n-modal>

  <n-modal
    v-model:show="showClearConfirm"
    preset="card"
    class="w-[min(460px,calc(100vw-32px))]"
    :bordered="false"
    title="清空全部数据"
  >
    <div class="text-[14px] leading-6 text-neutral-300">
      输入 <span class="font-700 text-white">do-shelf</span> 后点击确认，将清空本地标签数据。
    </div>

    <div class="mt-4">
      <n-input
        v-model:value="clearConfirmText"
        placeholder="请输入 do-shelf"
        :disabled="isClearing"
      />
    </div>

    <div class="mt-5 flex justify-end gap-3">
      <n-button :disabled="isClearing" @click="resetClearState">取消</n-button>
      <n-button
        type="error"
        strong
        :loading="isClearing"
        :disabled="!canConfirmClear"
        @click="handleConfirmClear"
      >
        确认
      </n-button>
    </div>
  </n-modal>
</template>

<style scoped>
.export-category-scroll {
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.28) transparent;
}

.export-category-scroll::-webkit-scrollbar {
  width: 6px;
}

.export-category-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.export-category-scroll::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.28);
}
</style>
