import 'vue-router'
import '@tanstack/vue-table'

export {}

// TODO: This isn't file isn't being referenced, types not working

declare module 'vue-router' {
  interface RouteMeta {
    auth?: boolean
    isAdmin?: boolean
    hideUI?: boolean
    dialog?: boolean
  }
}

declare module '@tanstack/react-table' {
  interface ColumnMeta<TData extends RowData, TValue> {
    headerClass: string
    cellClass: string
  }
}
