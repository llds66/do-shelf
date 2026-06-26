import { type App as VueApp, createApp } from 'vue'
import browser from 'webextension-polyfill'
import 'uno.css'
import App from './views/App.vue'
import { setupApp } from '~/logic/common-setup'
import {
  EXTENSION_SETTINGS_KEY,
  getExtensionSettings,
  normalizeExtensionSettings,
} from '~/shared/settings'
import { CONCISE_MODE_CLASS, pageEnhancementStyleText } from './pageEnhancementStyles'

const ROOT_ID = 'do-shelf-root'
const OVERLAY_ROOT_ID = 'do-shelf-overlay-root'
const STYLE_ID = 'do-shelf-content-style'
const ENHANCEMENT_STYLE_ID = 'do-shelf-enhancement-style'
const SIDEBAR_MANAGER_ENTRY_ID = 'do-shelf-sidebar-manager-entry'
const SIDEBAR_MANAGER_ENTRY_NAME = 'doshelf-bookmarks'
type StyleMountTarget = HTMLElement

let app: VueApp<Element> | null = null
let buttonContainer: HTMLElement | null = null
let overlayContainer: HTMLElement | null = null
let lastUrl = location.href

function isLinuxDoTopicPage() {
  return location.hostname === 'linux.do' && location.pathname.startsWith('/t/')
}

function isLinuxDoPage() {
  return location.hostname === 'linux.do'
}

function getPageTitle() {
  const heading = document.querySelector('h1')?.textContent?.trim()
  if (heading) return heading

  const ogTitle = document
    .querySelector<HTMLMetaElement>('meta[property="og:title"]')
    ?.content?.trim()
  if (ogTitle) return ogTitle

  return document.title.replace(/\s*-\s*Linux Do\s*$/i, '').trim()
}

function findNativeMountPoint(): HTMLElement | null {
  return document.querySelector<HTMLElement>('#topic-title .title-wrapper h1')
}

function findCommunitySidebarList(): HTMLUListElement | null {
  return (
    document.querySelector<HTMLUListElement>('ul#sidebar-section-content-community') ||
    document.querySelector<HTMLUListElement>('#sidebar-section-content-community ul')
  )
}

async function openManagerPage() {
  try {
    await browser.runtime.sendMessage({ type: 'open-manager-page', view: 'bookmarks' })
  } catch {
    window.open(
      browser.runtime.getURL('dist/manager/index.html?view=bookmarks'),
      '_blank',
      'noopener',
    )
  }
}

function createSidebarManagerEntry() {
  const item = document.createElement('li')
  item.id = SIDEBAR_MANAGER_ENTRY_ID
  item.className = 'sidebar-section-link-wrapper'
  item.dataset.listItemName = SIDEBAR_MANAGER_ENTRY_NAME

  const link = document.createElement('a')
  link.className = 'ember-view sidebar-section-link sidebar-row'
  link.href = browser.runtime.getURL('dist/manager/index.html?view=bookmarks')

  const icon = document.createElement('span')
  icon.className = 'sidebar-section-link-prefix icon i-material-symbols-kid-star-outline'

  const text = document.createElement('span')
  text.className = 'sidebar-section-link-content-text'
  text.textContent = 'Doshelf 收藏'

  link.append(icon, text)

  link.addEventListener('click', (event) => {
    event.preventDefault()
    void openManagerPage()
  })

  item.append(link)

  return item
}

function ensureSidebarManagerEntry() {
  if (!isLinuxDoPage() || !document.body) return
  if (document.getElementById(SIDEBAR_MANAGER_ENTRY_ID)) return

  const list = findCommunitySidebarList()
  if (!list) return

  ensureContentStyle()
  list.append(createSidebarManagerEntry())
}

function mountInlineButton(root: HTMLElement, mountPoint: HTMLElement) {
  const titleLink = mountPoint.querySelector<HTMLElement>('a')
  mountPoint.style.display = 'block'

  if (titleLink) {
    titleLink.style.display = 'inline'
    titleLink.insertAdjacentElement('afterend', root)
  } else {
    mountPoint.append(root)
  }
}

function teardownDoShelf() {
  app?.unmount()
  app = null
  buttonContainer?.remove()
  overlayContainer?.remove()
  buttonContainer = null
  overlayContainer = null
}

function ensureContentStyle() {
  if (document.getElementById(STYLE_ID)) return

  const styleEl = document.createElement('link')
  styleEl.id = STYLE_ID
  styleEl.setAttribute('rel', 'stylesheet')
  styleEl.setAttribute('href', browser.runtime.getURL('dist/contentScripts/style.css'))
  document.head.appendChild(styleEl)
}

function ensureEnhancementStyle() {
  if (document.getElementById(ENHANCEMENT_STYLE_ID)) return

  const styleEl = document.createElement('style')
  styleEl.id = ENHANCEMENT_STYLE_ID
  styleEl.textContent = pageEnhancementStyleText
  document.head.appendChild(styleEl)
}

function applyConciseMode(enabled: boolean) {
  document.documentElement.classList.toggle(CONCISE_MODE_CLASS, enabled && isLinuxDoPage())
}

async function syncEnhancementSettings() {
  const settings = await getExtensionSettings()

  ensureEnhancementStyle()
  applyConciseMode(settings.conciseMode)
}

function handleSettingsStorageChange(
  changes: Record<string, browser.Storage.StorageChange>,
  areaName: string,
) {
  if (areaName !== 'local' || !changes[EXTENSION_SETTINGS_KEY]) return

  const settings = normalizeExtensionSettings(changes[EXTENSION_SETTINGS_KEY].newValue)

  ensureEnhancementStyle()
  applyConciseMode(settings.conciseMode)
}

function createButtonContainer() {
  const host = document.createElement('span')
  host.id = ROOT_ID
  host.style.display = 'inline-flex'
  host.style.alignItems = 'center'
  host.style.lineHeight = '1'
  host.style.verticalAlign = '0em'
  host.style.position = 'relative'
  host.style.zIndex = '2147483647'

  const root = document.createElement('span')

  host.appendChild(root)

  return {
    host,
    root,
  }
}

function createOverlayContainer() {
  const host = document.createElement('div')
  host.id = OVERLAY_ROOT_ID
  host.style.position = 'fixed'
  host.style.inset = '0'
  host.style.pointerEvents = 'none'
  host.style.zIndex = '2147483647'

  const root = document.createElement('div')
  root.style.width = '100%'
  root.style.height = '100%'
  host.appendChild(root)
  document.body.appendChild(host)

  return {
    host,
    root,
  }
}

function setupDoShelf() {
  teardownDoShelf()
  void syncEnhancementSettings()
  ensureSidebarManagerEntry()

  if (!document.body || !isLinuxDoTopicPage()) return

  ensureContentStyle()

  const mountPoint = findNativeMountPoint()
  if (!mountPoint) return

  const { host, root } = createButtonContainer()
  const { host: overlayHost, root: overlayRoot } = createOverlayContainer()

  mountInlineButton(host, mountPoint)

  const vueApp = createApp(App, {
    pageTitle: getPageTitle(),
    pageUrl: location.href,
    overlayTarget: overlayRoot,
    styleMountTarget: document.head as StyleMountTarget,
  })

  setupApp(vueApp)
  vueApp.mount(root)

  app = vueApp
  buttonContainer = host
  overlayContainer = overlayHost
}

function scheduleSetup() {
  window.setTimeout(() => {
    if (location.href !== lastUrl) lastUrl = location.href
    setupDoShelf()
  }, 300)
}

function handleUrlChange() {
  ensureSidebarManagerEntry()

  if (location.href === lastUrl) return

  lastUrl = location.href
  scheduleSetup()
}

function watchUrlChange() {
  const observer = new MutationObserver(handleUrlChange)
  const target = document.body ?? document.documentElement

  observer.observe(target, {
    childList: true,
    subtree: true,
  })

  window.addEventListener('popstate', handleUrlChange)
  window.addEventListener('hashchange', handleUrlChange)

  const originalPushState = history.pushState.bind(history)
  history.pushState = (...args) => {
    originalPushState(...args)
    handleUrlChange()
  }

  const originalReplaceState = history.replaceState.bind(history)
  history.replaceState = (...args) => {
    originalReplaceState(...args)
    handleUrlChange()
  }
}

if (document.readyState === 'loading')
  window.addEventListener('DOMContentLoaded', setupDoShelf, { once: true })
else setupDoShelf()

browser.storage.onChanged.addListener(handleSettingsStorageChange)
watchUrlChange()
