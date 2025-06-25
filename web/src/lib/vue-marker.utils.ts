import { createApp, Component, App } from 'vue'

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
