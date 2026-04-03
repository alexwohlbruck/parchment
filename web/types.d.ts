import 'vue-router'
import '@tanstack/vue-table'

export {}

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
