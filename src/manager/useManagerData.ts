import type { MessageApi } from 'naive-ui'
import { createDiscreteApi, darkTheme } from 'naive-ui'
import browser from 'webextension-polyfill'
import {
  computed,
  inject,
  nextTick,
  onBeforeUnmount,
  onMounted,
  provide,
  ref,
  type ComputedRef,
  type InjectionKey,
  type Ref,
} from 'vue'
import {
  ALL_CATEGORY_VIEW_ID,
  ALL_CATEGORY_VIEW_NAME,
  createEmptyShelfData,
  getBookmarksByCategoryId,
  getCategoriesWithCounts,
  type BookmarkRecord,
  type CategoryRecord,
  type CategoryWithCount,
  type DoShelfData,
} from '~/shared/bookmarks'
import { getShelfData } from '~/shared/storage'
import { appThemeOverrides } from '~/theme/naive'

interface ManagerDataContext {
  shelfData: Ref<DoShelfData>
  categories: ComputedRef<CategoryRecord[]>
  categoriesWithCounts: ComputedRef<CategoryWithCount[]>
  selectedCategory: ComputedRef<CategoryWithCount | undefined>
  selectedCategoryId: Ref<string>
  tabsRenderKey: Ref<number>
  totalBookmarks: ComputedRef<number>
  totalCategories: ComputedRef<number>
  selectedBookmarks: ComputedRef<BookmarkRecord[]>
  bookmarkSearchSource: ComputedRef<BookmarkRecord[]>
  isDefaultCategory: (categoryId: string) => boolean
  refreshData: () => Promise<void>
  showSuccessMessage: (content: string) => void
  showErrorMessage: (content: string) => void
}

const managerDataKey: InjectionKey<ManagerDataContext> = Symbol('manager-data')

export function provideManagerData() {
  const shelfData = ref<DoShelfData>(createEmptyShelfData())
  const selectedCategoryId = ref<string>(ALL_CATEGORY_VIEW_ID)
  const tabsRenderKey = ref(0)
  let messageApi: MessageApi | null = null
  let messageApiUnmount: (() => void) | null = null

  const categories = computed(() => shelfData.value.categories)
  const categoriesWithCounts = computed(() => [
    {
      id: ALL_CATEGORY_VIEW_ID,
      name: ALL_CATEGORY_VIEW_NAME,
      builtIn: true,
      order: -1,
      createdAt: 0,
      count: shelfData.value.bookmarks.length,
    },
    ...getCategoriesWithCounts(shelfData.value),
  ])
  const selectedCategory = computed(() =>
    categoriesWithCounts.value.find((category) => category.id === selectedCategoryId.value),
  )
  const totalBookmarks = computed(() => shelfData.value.bookmarks.length)
  const totalCategories = computed(() => categories.value.length)
  const selectedBookmarks = computed(() => {
    if (selectedCategoryId.value === ALL_CATEGORY_VIEW_ID) return shelfData.value.bookmarks

    return getBookmarksByCategoryId(shelfData.value, selectedCategoryId.value)
  })
  const bookmarkSearchSource = computed(() => shelfData.value.bookmarks)

  function isDefaultCategory(categoryId: string) {
    return categories.value.some((category) => category.id === categoryId && category.builtIn)
  }

  function showSuccessMessage(content: string) {
    messageApi?.success(content, {
      duration: 1800,
      keepAliveOnHover: true,
    })
  }

  function showErrorMessage(content: string) {
    messageApi?.warning(content, {
      duration: 2200,
      keepAliveOnHover: true,
    })
  }

  function setupMessageApi() {
    const discreteApi = createDiscreteApi(['message'], {
      configProviderProps: {
        theme: darkTheme,
        themeOverrides: appThemeOverrides,
        preflightStyleDisabled: false,
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

  async function refreshData() {
    const nextShelfData = await getShelfData()

    shelfData.value = nextShelfData

    if (
      selectedCategoryId.value !== ALL_CATEGORY_VIEW_ID &&
      !nextShelfData.categories.some((category) => category.id === selectedCategoryId.value)
    )
      selectedCategoryId.value = ALL_CATEGORY_VIEW_ID

    await nextTick()
    tabsRenderKey.value += 1
  }

  function handleStorageChange(
    changes: Record<string, browser.Storage.StorageChange>,
    areaName: string,
  ) {
    if (areaName !== 'local' || !changes['do-shelf:data']) return

    void refreshData()
  }

  onMounted(async () => {
    setupMessageApi()
    await refreshData()
    browser.storage.onChanged.addListener(handleStorageChange)
  })

  onBeforeUnmount(() => {
    browser.storage.onChanged.removeListener(handleStorageChange)
    messageApiUnmount?.()
    messageApi = null
    messageApiUnmount = null
  })

  const context: ManagerDataContext = {
    shelfData,
    categories,
    categoriesWithCounts,
    selectedCategory,
    selectedCategoryId,
    tabsRenderKey,
    totalBookmarks,
    totalCategories,
    selectedBookmarks,
    bookmarkSearchSource,
    isDefaultCategory,
    refreshData,
    showSuccessMessage,
    showErrorMessage,
  }

  provide(managerDataKey, context)

  return context
}

export function useManagerData() {
  const context = inject(managerDataKey)

  if (!context) throw new Error('useManagerData must be used after provideManagerData')

  return context
}
