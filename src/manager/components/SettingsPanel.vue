<script setup lang="ts">
import browser from 'webextension-polyfill'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useManagerData } from '../useManagerData'
import { SHELF_DATA_VERSION, type DoShelfData } from '~/shared/bookmarks'
import { clearShelfData, getShelfData, saveShelfData } from '~/shared/storage'
import NumberFlow from '@number-flow/vue'

const { totalBookmarks, totalCategories, refreshData, showErrorMessage, showSuccessMessage } =
  useManagerData()
const importInputRef = ref<HTMLInputElement | null>(null)
const clearConfirmText = ref('')
const isImporting = ref(false)
const isExporting = ref(false)
const isClearing = ref(false)
const animatedTotalCategories = ref(0)
const animatedTotalBookmarks = ref(0)
const showImportConfirm = ref(false)
const showClearConfirm = ref(false)
const pendingImportFilename = ref('')
const pendingImportData = ref<DoShelfData | null>(null)
const canConfirmClear = computed(() => clearConfirmText.value === 'do-shelf')
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

onMounted(() => {
  syncAnimatedTotals()
})

watch([totalCategories, totalBookmarks], () => {
  syncAnimatedTotals()
})

onBeforeUnmount(() => {
  if (animationFrameId !== null) cancelAnimationFrame(animationFrameId)
})

function buildExportFilename(exportedAt: number, appVersion: string) {
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

function buildExportData(data: DoShelfData, exportedAt: number, appVersion: string): DoShelfData {
  return {
    ...data,
    meta: {
      ...data.meta,
      exportedAt,
      appVersion,
    },
  }
}

function handleImportData() {
  if (isImporting.value) return

  importInputRef.value?.click()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseImportedShelfData(rawText: string) {
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

  return {
    version: parsed.version,
    meta: isRecord(parsed.meta) ? parsed.meta : {},
    categories: parsed.categories,
    bookmarks: parsed.bookmarks,
    categoryBookmarks: parsed.categoryBookmarks,
    settings: isRecord(parsed.settings) ? parsed.settings : {},
  } satisfies DoShelfData
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
    showImportConfirm.value = true
  } catch (error) {
    showErrorMessage(error instanceof Error ? error.message : '导入文件解析失败')
  }
}

function resetImportState() {
  showImportConfirm.value = false
  pendingImportFilename.value = ''
  pendingImportData.value = null
}

function openClearConfirm() {
  if (isClearing.value) return

  clearConfirmText.value = ''
  showClearConfirm.value = true
}

async function openExternalLink(url: string) {
  await browser.tabs.create({ url })
}

function resetClearState() {
  showClearConfirm.value = false
  clearConfirmText.value = ''
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
  if (!pendingImportData.value || isImporting.value) return

  isImporting.value = true

  try {
    await saveShelfData(pendingImportData.value)
    await refreshData()
    showSuccessMessage('导入成功')
    resetImportState()
  } catch {
    showErrorMessage('导入失败')
  } finally {
    isImporting.value = false
  }
}

async function handleExportData() {
  if (isExporting.value) return

  isExporting.value = true

  try {
    const data = await getShelfData()
    const exportedAt = Date.now()
    const appVersion = browser.runtime.getManifest().version || '0.0.0'
    const exportData = buildExportData(data, exportedAt, appVersion)
    const payload = JSON.stringify(exportData, null, 2)
    const blob = new Blob([payload], { type: 'application/json;charset=utf-8' })
    const objectUrl = URL.createObjectURL(blob)
    const anchor = document.createElement('a')

    anchor.href = objectUrl
    anchor.download = buildExportFilename(exportedAt, appVersion)
    anchor.click()

    URL.revokeObjectURL(objectUrl)
    showSuccessMessage('数据已导出')
  } finally {
    isExporting.value = false
  }
}
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
            <n-button secondary :loading="isImporting" @click="handleImportData">
              <template #icon>
                <div class="i-lucide-file-up h-[16px] w-[16px] text-[16px]" />
              </template>
              导入数据
            </n-button>
            <n-button secondary :loading="isExporting" @click="handleExportData">
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
                  'https://microsoftedge.microsoft.com/addons/detail/doshelf/bmloldgelbkhglnaoghflbfdbojogfjg',
                )
              "
            >
              <template #icon>
                <div class="i-logos-microsoft-edge h-[16px] w-[16px] text-[16px]" />
              </template>
              Edge扩展商店
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
    v-model:show="showImportConfirm"
    preset="card"
    class="w-[min(460px,calc(100vw-32px))]"
    :bordered="false"
    title="导入数据"
  >
    <div class="text-[14px] leading-6 text-neutral-300">
      当前阶段只支持全量覆盖导入，会清空现有数据，请谨慎操作
    </div>

    <div class="mt-3 text-[13px] leading-6 text-neutral-500">文件：{{ pendingImportFilename }}</div>

    <div class="mt-5 flex justify-end gap-3">
      <n-button :disabled="isImporting" @click="resetImportState">取消</n-button>
      <n-button type="primary" :loading="isImporting" @click="handleConfirmImport">
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
