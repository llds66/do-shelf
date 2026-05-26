import browser from 'webextension-polyfill'

interface OpenManagerPageMessage {
  type: 'open-manager-page'
  view?: 'bookmarks' | 'categories' | 'settings'
}

function isOpenManagerPageMessage(message: unknown): message is OpenManagerPageMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    message.type === 'open-manager-page'
  )
}

// only on dev mode
if (import.meta.hot) {
  // @ts-expect-error for background HMR
  import('/@vite/client')
  // load latest content script
  import('./contentScriptHMR')
}

browser.runtime.onInstalled.addListener((): void => {
  console.log('DoShelf installed')
})

browser.action.onClicked.addListener((): void => {
  void browser.runtime.openOptionsPage()
})

browser.runtime.onMessage.addListener((message) => {
  if (!isOpenManagerPageMessage(message)) return undefined

  const managerPath = message.view
    ? `dist/manager/index.html?view=${encodeURIComponent(message.view)}`
    : 'dist/manager/index.html'

  return browser.tabs.create({
    url: browser.runtime.getURL(managerPath),
  })
})
