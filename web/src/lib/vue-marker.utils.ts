import { createApp, Component, App } from 'vue'
import { i18n } from '@/lib/i18n'
import router from '@/router'

/**
 * Convert a Vue component to a DOM element for use as a map marker.
 *
 * Each marker is its own Vue app, so it inherits NOTHING from the main app's
 * plugins — a marker component calling `useI18n()` or `useRouter()` throws at
 * setup ("Need to install with `app.use` function"). The same instances are
 * installed here so marker components can be written like any other
 * component. Pinia needs no install: `createPinia()` sets the active pinia
 * globally, so `useStore()` resolves without app context.
 *
 * Markers are mounted from map initialization, so a throw here used to
 * propagate into `style.load` and abort every later step — the saved places
 * source and layers among them, which left the map with no saved place
 * markers at all. A marker that can't mount is contained to itself: it draws
 * nothing, and the rest of the map still comes up.
 */
export function createVueMarkerElement(
  component: Component,
  props: Record<string, any> = {},
): HTMLElement {
  // Create a container element
  const container = document.createElement('div')

  // Create a Vue app instance with the component
  const app: App = createApp(component, props)
  app.use(i18n)
  app.use(router)

  try {
    // Mount the app to the container
    app.mount(container)
    // Store the app instance on the element for cleanup
    ;(container as any)._vueApp = app
  } catch (error) {
    console.error('Failed to mount map marker component:', error)
  }

  return container
}

/**
 * Clean up a Vue marker element
 */
export function destroyVueMarkerElement(element: HTMLElement): void {
  const app = (element as any)._vueApp
  if (app) {
    app.unmount()
    delete (element as any)._vueApp
  }
}
