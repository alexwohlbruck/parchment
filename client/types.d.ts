import 'vue-router'

export {}

// TODO: This isn't working
declare module 'vue-router' {
  interface RouteMeta {
    auth?: boolean
    isAdmin?: boolean
    layout?: 'floating' | 'sidebar'
    modal?: boolean
  }
}
