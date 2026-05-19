import browser from 'webextension-polyfill'

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
  if (!message || typeof message !== 'object' || !('type' in message)) return undefined
  if (message.type !== 'open-manager-page') return undefined

  return browser.tabs.create({
    url: browser.runtime.getURL('dist/manager/index.html?openCategoryManager=1'),
  })
})
