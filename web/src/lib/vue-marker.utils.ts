import { createApp, Component, App } from 'vue'
import { i18n } from '@/lib/i18n'

/**
 * Convert a Vue component to a DOM element for use as a map marker
 */
export function createVueMarkerElement(
  component: Component,
  props: Record<string, any> = {},
): HTMLElement {
  // Create a container element
  const container = document.createElement('div')

  // Create a Vue app instance with the component
  const app: App = createApp(component, props)

  // A marker is its own app, so it inherits nothing from the main one: any
  // component calling useI18n() throws on mount, and the throw escapes into
  // whatever was iterating markers. That killed every initializer queued
  // after the marker layers in onStyleLoad — bookmarks, notes, timeline and
  // the portolan ribbons all silently vanished for any account that owned a
  // tracker. Markers need the same translations as the rest of the app.
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
