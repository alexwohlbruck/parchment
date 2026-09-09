import {
  type Component,
  type InjectionKey,
  type Raw,
  type Ref,
  computed,
  inject,
  provide,
  ref,
} from 'vue'

/**
 * A place-detail tab contributed at runtime by a widget. Widgets that used to
 * push a full-screen sub-page (Related places, Visit history, Departures) now
 * register a tab instead — the panel renders it inline and reflects it in the
 * URL. `component` + `props` are rendered inside the tab's content (embedded).
 */
export interface PlaceTab {
  /** Stable id, also the `?tab=` value (e.g. 'visits', 'related:parent'). */
  id: string
  label: string
  component: Raw<Component>
  props?: Record<string, unknown>
  /** Lower sorts first in the tab bar. */
  order?: number
}

interface PlaceTabsContext {
  register: (tab: PlaceTab) => void
  unregister: (id: string) => void
  /** Switch to a tab (used by a widget's "more" affordance). */
  activate: (id: string) => void
}

const KEY: InjectionKey<PlaceTabsContext> = Symbol('placeTabs')

/**
 * Set up the registry in the place panel. Returns the reactive, sorted tab
 * list for the panel to render. `activate` is supplied by the panel (it owns
 * the router sync).
 */
export function providePlaceTabs(opts: {
  activate: (id: string) => void
}): { tabs: Ref<PlaceTab[]> } {
  const map = ref<Map<string, PlaceTab>>(new Map())

  const register = (tab: PlaceTab) => {
    map.value.set(tab.id, tab)
    map.value = new Map(map.value) // reassign so the computed re-evaluates
  }
  const unregister = (id: string) => {
    if (map.value.delete(id)) map.value = new Map(map.value)
  }

  const tabs = computed(() =>
    [...map.value.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
  )

  provide(KEY, { register, unregister, activate: opts.activate })
  return { tabs }
}

/**
 * Used by widgets to contribute a tab. Falls back to no-ops when rendered
 * outside a place panel so a widget can never crash for lack of a provider.
 */
export function usePlaceTabs(): PlaceTabsContext {
  return (
    inject(KEY, null) ?? {
      register: () => {},
      unregister: () => {},
      activate: () => {},
    }
  )
}
