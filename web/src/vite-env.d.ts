/// <reference types="vite/client" />

declare const __APP_VERSION__: string

// True iff maplibre-gl is aliased to the local variable-line-offset fork
// (build-time constant from web/vite.config.ts `define`).
declare const __MAPLIBRE_FORK__: boolean

declare module '*.svg?component' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent
  export default component
}

// Stub for Tauri geolocation plugin (not installed in web build)
declare module '@tauri-apps/plugin-geolocation' {
  interface WatchPositionOptions {
    enableHighAccuracy?: boolean
    timeout?: number
    maximumAge?: number
  }

  export function watchPosition(
    options: WatchPositionOptions,
    callback: (position: GeolocationPosition, error?: GeolocationPositionError) => void,
  ): Promise<number>

  export function clearWatch(watchId: number): void

  export function getCurrentPosition(options?: WatchPositionOptions): Promise<GeolocationPosition>
}
