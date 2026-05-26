<script setup lang="ts">
import browser from 'webextension-polyfill'
import { darkTheme } from 'naive-ui'
import { onMounted, ref } from 'vue'
import BookmarksPanel from './components/BookmarksPanel.vue'
import CategoryManagerPanel from './components/CategoryManagerPanel.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import { provideManagerData } from './useManagerData'
import logoUrl from '~/assets/logo.png'
import { appThemeOverrides } from '~/theme/naive'

const NAV_ITEMS = [
  { label: '收藏夹', key: 'bookmarks' },
  { label: '分类管理', key: 'categories' },
  { label: '设置', key: 'settings' },
] as const
type NavKey = (typeof NAV_ITEMS)[number]['key']

const activeView = ref<NavKey>('bookmarks')
const menuOptions = NAV_ITEMS.map((item) => ({
  label: item.label,
  key: item.key,
}))
const appVersion = browser.runtime.getManifest().version || '0.0.0'

provideManagerData()

function isNavKey(value: string): value is NavKey {
  return NAV_ITEMS.some((item) => item.key === value)
}

function syncActiveViewFromUrl() {
  const params = new URLSearchParams(window.location.search)
  const view = params.get('view')

  if (view && isNavKey(view)) activeView.value = view

  if (view) {
    params.delete('view')

    const nextSearch = params.toString()
    const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`
    window.history.replaceState({}, '', nextUrl)
  }
}

onMounted(() => {
  syncActiveViewFromUrl()
})
</script>

<template>
  <n-config-provider :theme="darkTheme" :theme-overrides="appThemeOverrides">
    <main
      class="fixed py-5 inset-0 overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(126,180,255,0.14),_transparent_36%),linear-gradient(180deg,_#10141c_0%,_#0b0e14_100%)] text-neutral-100"
    >
      <div class="mx-auto flex h-full max-w-[1360px] flex-col px-5 lg:px-8">
        <div
          class="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-5 lg:grid-cols-[280px_minmax(0,1fr)] lg:grid-rows-1"
        >
          <section
            class="flex min-h-0 flex-col overflow-hidden rounded-3xl border border-white/8 bg-white/5 backdrop-blur-xl"
          >
            <div class="px-3 py-3 lg:hidden">
              <div class="rounded-2xl p-2">
                <n-tabs
                  v-model:value="activeView"
                  type="segment"
                  animated
                  pane-wrapper-style="display: none"
                  class="manager-mobile-tabs"
                >
                  <n-tab-pane
                    v-for="item in NAV_ITEMS"
                    :key="item.key"
                    :name="item.key"
                    :tab="item.label"
                  />
                </n-tabs>
              </div>
            </div>

            <div class="hidden px-3 py-3 lg:block">
              <n-menu
                v-model:value="activeView"
                :options="menuOptions"
                :indent="18"
                :icon-size="18"
                class="p-2"
              />
            </div>

            <div class="mt-auto hidden px-5 pb-3 lg:block">
              <a
                href="https://doshelf.llds.cloud/"
                target="_blank"
                rel="noopener noreferrer"
                class="project-link no-underline flex items-center justify-center gap-3 text-[13px] text-neutral-400"
              >
                <img :src="logoUrl" alt="DoShelf logo" class="h-6 w-6 rounded-md object-cover" />
                <span class="mt-1 font-700 text-neutral-300">DoShelf</span>
                <span class="mt-1 text-[11px] text-neutral-500">v{{ appVersion }}</span>
              </a>
            </div>
          </section>

          <section
            class="flex min-h-0 flex-col overflow-hidden rounded-3xl border border-white/8 bg-white/5 backdrop-blur-xl px-5"
          >
            <template v-if="activeView === 'bookmarks'">
              <BookmarksPanel />
            </template>

            <template v-else-if="activeView === 'categories'">
              <CategoryManagerPanel />
            </template>

            <template v-else>
              <SettingsPanel />
            </template>
          </section>
        </div>
      </div>
    </main>
  </n-config-provider>
</template>

<style scoped>
:deep(.manager-mobile-tabs .n-tabs-nav) {
  --n-tab-border-radius: 14px;
}

.project-link {
  transition:
    color 160ms ease,
    opacity 160ms ease;
}

.project-link:hover {
  color: white;
  opacity: 0.96;
}
</style>
