import browser from 'webextension-polyfill'

export const EXTENSION_SETTINGS_KEY = 'do-shelf:settings'

export interface DoShelfSettings {
  conciseMode: boolean
}

export function createDefaultExtensionSettings(): DoShelfSettings {
  return {
    conciseMode: false,
  }
}

export function normalizeExtensionSettings(settings: unknown): DoShelfSettings {
  const rawSettings =
    typeof settings === 'object' && settings !== null && !Array.isArray(settings) ? settings : {}
  const rawRecord = rawSettings as Record<string, unknown>

  return {
    ...createDefaultExtensionSettings(),
    conciseMode: rawRecord.conciseMode === true,
  }
}

export async function getExtensionSettings() {
  const result = await browser.storage.local.get(EXTENSION_SETTINGS_KEY)
  const storedSettings = result[EXTENSION_SETTINGS_KEY]
  const normalizedSettings = normalizeExtensionSettings(storedSettings)

  if (JSON.stringify(storedSettings) !== JSON.stringify(normalizedSettings)) {
    await browser.storage.local.set({
      [EXTENSION_SETTINGS_KEY]: normalizedSettings,
    })
  }

  return normalizedSettings
}

export async function saveExtensionSettings(settings: DoShelfSettings) {
  const normalizedSettings = normalizeExtensionSettings(settings)

  await browser.storage.local.set({
    [EXTENSION_SETTINGS_KEY]: normalizedSettings,
  })

  return normalizedSettings
}
