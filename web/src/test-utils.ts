/**
 * Test utilities for mounting Vue components with Pinia and Router
 */
import { mount, VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia, Pinia } from 'pinia'
import { createRouter, createMemoryHistory, Router } from 'vue-router'
import type { Component } from 'vue'

/**
 * Create a test Pinia instance
 */
export function createTestPinia(): Pinia {
  const pinia = createPinia()
  setActivePinia(pinia)
  return pinia
}

/**
 * Create a test router with memory history
 */
export function createTestRouter(routes: any[] = []): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: routes.length > 0 ? routes : [
      { path: '/', component: { template: '<div>Home</div>' } },
    ],
  })
}

/**
 * Mount a component with Pinia and Router
 * 
 * @example
 * const wrapper = mountWithProviders(MyComponent, {
 *   props: { foo: 'bar' },
 *   pinia: createTestPinia(),
 *   router: createTestRouter(),
 * })
 */
export function mountWithProviders(
  component: Component,
  options: {
    props?: Record<string, any>
    pinia?: Pinia
    router?: Router
    global?: Record<string, any>
    [key: string]: any
  } = {}
): VueWrapper {
  const { pinia, router, global = {}, ...mountOptions } = options

  const plugins = []
  if (pinia) plugins.push(pinia)
  if (router) plugins.push(router)

  return mount(component, {
    ...mountOptions,
    global: {
      ...global,
      plugins: [...plugins, ...(global.plugins || [])],
    },
  })
}
