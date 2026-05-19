import { type App as VueApp, createApp } from 'vue'
import browser from 'webextension-polyfill'
import 'uno.css'
import App from './views/App.vue'
import { setupApp } from '~/logic/common-setup'

const ROOT_ID = 'do-shelf-root'
const OVERLAY_ROOT_ID = 'do-shelf-overlay-root'
const STYLE_ID = 'do-shelf-content-style'
type StyleMountTarget = HTMLElement

let app: VueApp<Element> | null = null
let buttonContainer: HTMLElement | null = null
let overlayContainer: HTMLElement | null = null
let lastUrl = location.href

function isLinuxDoTopicPage() {
  return location.hostname === 'linux.do' && location.pathname.startsWith('/t/')
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

watchUrlChange()
