import { type Component, type ComputedRef, type InjectionKey, inject, provide, computed, shallowRef, type Raw, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

export interface SheetPage {
  /**
   * Unique identifier used as the `?view=` URL query value. Required so the
   * sub-page state is reflected in the URL and can be popped by the browser's
   * back button.
   */
  name: string
  component: Raw<Component>
  props?: Record<string, unknown>
  title?: string
  /**
   * Additional query params to merge into the URL alongside `view=name`.
   * Useful when one page handles multiple variants — e.g. the related-places
   * page distinguishing `children` vs `parent` via `strategy`.
   */
  query?: Record<string, string>
}

export interface SheetPageContext {
  pushPage: (page: SheetPage) => void
  popPage: () => void
  hasPages: ComputedRef<boolean>
}

export interface SheetPageHostContext extends SheetPageContext {
  activePage: ComputedRef<SheetPage | null>
  depth: ComputedRef<number>
  clearPages: () => void
}

const SHEET_PAGE_KEY: InjectionKey<SheetPageContext> = Symbol('sheetPage')

const VIEW_QUERY_KEY = 'view'

export function provideSheetPage(): SheetPageHostContext {
  const route = useRoute()
  const router = useRouter()
  const pageStack = shallowRef<SheetPage[]>([])

  const activePage = computed(() => pageStack.value.at(-1) ?? null)
  const hasPages = computed(() => pageStack.value.length > 0)
  const depth = computed(() => pageStack.value.length)

  function pushPage(page: SheetPage) {
    // Mutate the stack synchronously so the host re-renders immediately —
    // we don't want to wait on router.push for the slide animation to start.
    pageStack.value = [...pageStack.value, page]

    router.push({
      // Keep current path/params (route.fullPath would re-include the view we're
      // about to set, so spread query selectively).
      query: { ...route.query, [VIEW_QUERY_KEY]: page.name, ...(page.query || {}) },
    })
  }

  function popPage() {
    if (pageStack.value.length === 0) return
    // router.back walks one step in browser history — exactly what we want for
    // the sheet's back button so it stays in sync with the OS back gesture.
    // The route watcher below handles the actual stack pop on the resulting
    // route change, keeping a single source of truth for stack mutation.
    router.back()
  }

  function clearPages() {
    pageStack.value = []
  }

  /**
   * Reconcile the in-memory stack with the URL's `view` query whenever the
   * route changes. This handles:
   *   - browser back / forward buttons,
   *   - programmatic router pushes from elsewhere,
   *   - the `popPage` flow above (which router.back()s and lets us pop here).
   *
   * Internal `pushPage` already updated the stack before calling router.push,
   * so the post-push fire of this watcher is a no-op (top.name === view).
   */
  watch(
    () => route.query[VIEW_QUERY_KEY],
    view => {
      const viewName = typeof view === 'string' ? view : null
      const top = pageStack.value.at(-1)

      if (!viewName && pageStack.value.length > 0) {
        // URL no longer has a sub-page but the stack does — browser back, or
        // popPage. Pop one entry. (We pop only one rather than clearing so a
        // multi-deep stack walks back one level at a time.)
        pageStack.value = pageStack.value.slice(0, -1)
        return
      }

      if (viewName && (!top || top.name !== viewName)) {
        // URL says a sub-page is active but the stack doesn't match. Most
        // common cause: a hard refresh or deep link. We can't restore the
        // page component without a global registry, so we strip the view
        // query from the URL rather than leave a lying address bar. The
        // user keeps the main view; the URL becomes consistent.
        if (import.meta.env.DEV) {
          console.warn(
            `[useSheetPage] Deep-link to ?${VIEW_QUERY_KEY}=${viewName} can't be restored ` +
            `(no in-memory page matches). Stripping the query from the URL. ` +
            `If you need deep-link support, register a page factory.`,
          )
        }
        const { [VIEW_QUERY_KEY]: _omit, ...rest } = route.query
        router.replace({ query: rest })
      }
    },
  )

  /**
   * If the route's path changes (navigating to a different place, the map
   * root, etc.) drop the entire stack — we're leaving the host's scope.
   * Watch path rather than fullPath so query-only navigation (our own sub-page
   * push) doesn't tear down the stack.
   */
  watch(
    () => route.path,
    () => {
      pageStack.value = []
    },
  )

  const context: SheetPageContext = { pushPage, popPage, hasPages }
  provide(SHEET_PAGE_KEY, context)

  return { ...context, activePage, depth, clearPages }
}

export function useSheetPage(): SheetPageContext {
  const ctx = inject(SHEET_PAGE_KEY)
  if (!ctx) throw new Error('useSheetPage() called outside of SheetPageHost')
  return ctx
}
