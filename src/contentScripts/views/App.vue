<script setup lang="ts">
import type { MessageApi } from 'naive-ui'
import { createDiscreteApi, darkTheme } from 'naive-ui'
import browser from 'webextension-polyfill'
import type { CSSProperties } from 'vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { createEmptyShelfData, normalizeUrl, type DoShelfData } from '~/shared/bookmarks'
import { deleteBookmark, getShelfData, saveBookmarkInCategories } from '~/shared/storage'
import { appThemeOverrides } from '~/theme/naive'

const props = defineProps<{
  pageTitle: string
  pageUrl: string
  overlayTarget: HTMLElement | null
  styleMountTarget: ParentNode | null
}>()

const PANEL_Z_INDEX = 2147483647
const BUTTON_BOX_SIZE = '1.5em'
const BUTTON_ICON_SIZE = '1.2em'

const shelfData = ref<DoShelfData>(createEmptyShelfData())
const selectedCategoryIds = ref<string[]>([])
const isOpen = ref(false)
const isSaving = ref(false)
let messageApi: MessageApi | null = null
let messageApiUnmount: (() => void) | null = null

const categories = computed(() => shelfData.value.categories)
const displayCategories = computed(() => categories.value)
const currentBookmark = computed(() => {
  const normalizedUrl = normalizeUrl(props.pageUrl)
  return shelfData.value.bookmarks.find((bookmark) => bookmark.normalizedUrl === normalizedUrl)
})
const currentCategoryIds = computed(() => {
  if (!currentBookmark.value) return []

  return shelfData.value.categoryBookmarks
    .filter((relation) => relation.bookmarkId === currentBookmark.value?.id)
    .sort((left, right) => left.order - right.order)
    .map((relation) => relation.categoryId)
})
const buttonTitle = '选择收藏分类'
const canConfirmSave = computed(() => true)
const providerStyle = computed(
  (): CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    flexShrink: '0',
    verticalAlign: 'baseline',
  }),
)
const triggerStyle = computed(
  (): CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: '0',
    height: '1em',
    position: 'relative',
    zIndex: PANEL_Z_INDEX.toString(),
  }),
)
const buttonStyle = computed(
  (): CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    lineHeight: '1',
    width: BUTTON_BOX_SIZE,
    height: BUTTON_BOX_SIZE,
    minWidth: BUTTON_BOX_SIZE,
    minHeight: BUTTON_BOX_SIZE,
    padding: '0',
    fontSize: 'inherit',
    flexShrink: '0',
    background: 'transparent',
    color: 'inherit',
  }),
)
const iconStyle = computed(
  (): CSSProperties => ({
    display: 'block',
    width: BUTTON_ICON_SIZE,
    height: BUTTON_ICON_SIZE,
    fontSize: BUTTON_ICON_SIZE,
    color: 'currentColor',
    lineHeight: '1',
    flexShrink: '0',
    opacity: currentBookmark.value ? '0.98' : '0.66',
    transition: 'opacity 160ms ease, transform 160ms ease',
  }),
)
const overlayStyle = computed(
  (): CSSProperties => ({
    zIndex: PANEL_Z_INDEX.toString(),
    background: 'rgba(3, 7, 18, 0.48)',
    backdropFilter: 'blur(10px)',
  }),
)
const cardStyle = computed(
  (): CSSProperties => ({
    width: 'min(340px, calc(100vw - 40px))',
    maxWidth: '100%',
    boxShadow: '0 24px 64px rgba(0, 0, 0, 0.38)',
    transform: 'translateY(-2vh)',
  }),
)

function showSuccessMessage(content: string) {
  messageApi?.success(content, {
    keepAliveOnHover: true,
    duration: 1800,
  })
}

function setupMessageApi() {
  const discreteApi = createDiscreteApi(['message'], {
    configProviderProps: {
      theme: darkTheme,
      themeOverrides: appThemeOverrides,
      preflightStyleDisabled: true,
      namespace: 'do-shelf',
      styleMountTarget: props.styleMountTarget,
    },
    messageProviderProps: {
      placement: 'top',
      to: document.body,
      keepAliveOnHover: true,
    },
  })

  messageApi = discreteApi.message
  messageApiUnmount = discreteApi.unmount
}

async function refreshState() {
  shelfData.value = await getShelfData()
}

function resetFormState() {
  selectedCategoryIds.value = currentCategoryIds.value.length ? [...currentCategoryIds.value] : []
}

function isCategorySelected(categoryId: string) {
  return selectedCategoryIds.value.includes(categoryId)
}

function updateCategorySelection(categoryId: string, checked: boolean) {
  if (isSaving.value) return

  if (checked) {
    selectedCategoryIds.value = Array.from(new Set([...selectedCategoryIds.value, categoryId]))

    return
  }

  selectedCategoryIds.value = selectedCategoryIds.value.filter((id) => id !== categoryId)
}

function toggleCategorySelection(categoryId: string) {
  updateCategorySelection(categoryId, !isCategorySelected(categoryId))
}

async function openManagerPage() {
  try {
    await browser.runtime.sendMessage({ type: 'open-manager-page' })
    closePanel()
  } catch {
    showSuccessMessage('打开分类管理失败')
  }
}

function closePanel() {
  isOpen.value = false
  resetFormState()
}

function handlePanelVisibilityChange(show: boolean) {
  isOpen.value = show

  if (!show) resetFormState()
}

function getDeclaredFaviconUrl(pageUrl: string) {
  const selectors = [
    'link[rel="icon"]',
    'link[rel="shortcut icon"]',
    'link[rel="apple-touch-icon"]',
    'link[rel="apple-touch-icon-precomposed"]',
    'link[rel~="icon"]',
  ]

  for (const selector of selectors) {
    const element = document.querySelector<HTMLLinkElement>(selector)
    const href = element?.getAttribute('href')?.trim()
    if (!href) continue

    try {
      return new URL(href, pageUrl).toString()
    } catch {
      continue
    }
  }

  return undefined
}

function getDefaultFaviconUrl(pageUrl: string) {
  try {
    return new URL('/favicon.ico', pageUrl).toString()
  } catch {
    return undefined
  }
}

function getGoogleFaviconUrl(pageUrl: string) {
  try {
    const domain = new URL(pageUrl).hostname
    if (!domain) return undefined
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`
  } catch {
    return undefined
  }
}

function resolvePageFaviconUrl(pageUrl: string) {
  return (
    getDeclaredFaviconUrl(pageUrl) || getDefaultFaviconUrl(pageUrl) || getGoogleFaviconUrl(pageUrl)
  )
}

async function confirmSave() {
  if (!canConfirmSave.value || isSaving.value) return

  isSaving.value = true

  try {
    const previousBookmark = currentBookmark.value
    const nextCategoryIds = [...selectedCategoryIds.value]

    if (!nextCategoryIds.length) {
      if (previousBookmark) {
        await deleteBookmark(previousBookmark.id)
        showSuccessMessage('已取消收藏')
      }

      closePanel()
      await refreshState()
      return
    }

    await saveBookmarkInCategories({
      bookmarkId: previousBookmark?.id,
      title: props.pageTitle || '未命名帖子',
      url: props.pageUrl,
      faviconUrl: resolvePageFaviconUrl(props.pageUrl),
      categoryIds: nextCategoryIds,
    })

    showSuccessMessage(previousBookmark ? '收藏分类已更新' : '收藏成功')
    closePanel()
    await refreshState()
  } finally {
    isSaving.value = false
  }
}

function togglePanel() {
  const nextOpen = !isOpen.value
  handlePanelVisibilityChange(nextOpen)

  if (!nextOpen) return
  resetFormState()
}

function handleStorageChange(
  changes: Record<string, browser.Storage.StorageChange>,
  areaName: string,
) {
  if (areaName !== 'local' || !changes['do-shelf:data']) return

  void refreshState()
}

onMounted(async () => {
  setupMessageApi()
  await refreshState()
  resetFormState()
  browser.storage.onChanged.addListener(handleStorageChange)
})

onBeforeUnmount(() => {
  browser.storage.onChanged.removeListener(handleStorageChange)
  messageApiUnmount?.()
  messageApi = null
  messageApiUnmount = null
})
</script>

<template>
  <n-config-provider
    :theme="darkTheme"
    :theme-overrides="appThemeOverrides"
    :style-mount-target="props.styleMountTarget"
    :style="providerStyle"
    namespace="do-shelf"
    preflight-style-disabled
  >
    <span :style="triggerStyle">
      <n-button
        text
        quaternary
        circle
        size="small"
        :loading="isSaving"
        :title="buttonTitle"
        :aria-label="buttonTitle"
        :style="buttonStyle"
        class="bookmark-trigger"
        @click="togglePanel"
      >
        <template v-if="!isSaving" #icon>
          <div v-if="currentBookmark" class="i-material-symbols-kid-star" :style="iconStyle" />
          <div v-else class="i-material-symbols-kid-star-outline" :style="iconStyle" />
        </template>
      </n-button>

      <n-modal
        :show="isOpen"
        preset="card"
        :bordered="false"
        size="small"
        title="收藏至"
        class="bookmark-modal"
        content-style="padding: 16px;"
        :style="cardStyle"
        :overlay-style="overlayStyle"
        to="body"
        :z-index="PANEL_Z_INDEX"
        @update:show="handlePanelVisibilityChange"
      >
        <div style="margin-bottom: 16px">
          <div style="display: flex; flex-wrap: wrap; gap: 8px">
            <div
              v-for="category in displayCategories"
              :key="category.id"
              :style="{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 12px',
                borderRadius: '999px',
                background: isCategorySelected(category.id)
                  ? 'rgba(230, 237, 243, 0.12)'
                  : 'rgba(255, 255, 255, 0.04)',
                border: isCategorySelected(category.id)
                  ? '1px solid rgba(230, 237, 243, 0.28)'
                  : '1px solid rgba(255, 255, 255, 0.08)',
                color: '#fafafa',
                cursor: isSaving ? 'default' : 'pointer',
                whiteSpace: 'nowrap',
                transition: 'background 160ms ease, border-color 160ms ease',
                opacity: isSaving ? '0.72' : '1',
              }"
              @click="toggleCategorySelection(category.id)"
            >
              <n-checkbox
                :checked="isCategorySelected(category.id)"
                :disabled="isSaving"
                @click.stop
                @update:checked="
                  (checked: boolean) => updateCategorySelection(category.id, checked)
                "
              />
              <span>{{ category.name }}</span>
            </div>
          </div>
        </div>

        <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px">
          <button
            type="button"
            class="category-manager-link"
            :disabled="isSaving"
            @click="openManagerPage"
          >
            管理你的分类
          </button>

          <div style="display: flex; justify-content: flex-end; gap: 8px">
            <n-button size="small" :disabled="isSaving" @click="closePanel">取消</n-button>
            <n-button
              type="primary"
              size="small"
              :disabled="!canConfirmSave || isSaving"
              @click="confirmSave"
            >
              确认
            </n-button>
          </div>
        </div>
      </n-modal>
    </span>
  </n-config-provider>
</template>

<style scoped>
.bookmark-trigger {
  color: inherit !important;
}

.bookmark-trigger:hover:not(:disabled) :deep(.n-button__icon) {
  opacity: 1;
  transform: scale(1.06);
}

.category-manager-link {
  padding: 0;
  border: none;
  background: transparent;
  color: rgba(226, 232, 240, 0.76);
  font-size: 12px;
  line-height: 1.4;
  cursor: pointer;
  transition:
    color 160ms ease,
    opacity 160ms ease,
    text-shadow 160ms ease;
}

.category-manager-link:hover:not(:disabled) {
  color: rgba(255, 255, 255, 0.98);
  text-shadow: 0 0 14px rgba(255, 255, 255, 0.16);
}

.category-manager-link:disabled {
  cursor: default;
  opacity: 0.56;
}
</style>
