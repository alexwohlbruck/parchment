import { createApp, Component, App } from 'vue'
import { i18n } from '@/lib/i18n'

/**
 * Convert a Vue component to a DOM element for use as a map marker.
 *
 * Each marker is its own tiny Vue app, mounted outside the main one, so it
 * inherits none of its plugins. i18n has to be installed explicitly or any
 * marker calling `useI18n()` throws on setup — and the throw escapes into
 * whatever was iterating markers, which is how owning a single tracker once
 * took out every initializer queued behind the marker layers: bookmarks,
 * notes, timeline and the portolan ribbons all silently vanished. Pinia needs
 * no such wiring: stores resolve through the globally active instance.
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

  // Mount the app to the container
  app.mount(container)

  // Store the app instance on the element for cleanup
  ;(container as any)._vueApp = app

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
