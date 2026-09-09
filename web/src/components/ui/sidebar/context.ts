import { inject, provide, type InjectionKey, type Ref } from 'vue'

export interface SidebarContext {
  /** Icon-rail mode: labels are hidden, rows centre, tooltips take over. */
  collapsed: Ref<boolean>
  toggle: () => void
  /** True while a rail drag is in flight. */
  resizing: Ref<boolean>
  /**
   * Begin a rail drag. Resolves with whether the pointer actually moved, so
   * the caller can treat a press that went nowhere as a plain click.
   */
  startResize: (event: PointerEvent) => Promise<boolean>
}

const SIDEBAR_CONTEXT = Symbol('sidebar') as InjectionKey<SidebarContext>

export function provideSidebarContext(context: SidebarContext) {
  provide(SIDEBAR_CONTEXT, context)
}

export function useSidebar(): SidebarContext {
  const context = inject(SIDEBAR_CONTEXT, null)
  if (!context) {
    throw new Error('Sidebar parts must be rendered inside a <Sidebar>.')
  }
  return context
}
