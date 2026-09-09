declare module '@morev/vue-transitions'
declare module 'path'

declare global {
  interface Window {
    isTauri?: boolean
    __TAURI_METADATA__?: {
      platform: string
    }
  }
}

export {}
