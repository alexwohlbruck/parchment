import 'vue-router'
import '@tanstack/vue-table'
import type { SheetMeta } from '@/types/app.types'

export {}

declare module 'vue-router' {
  interface RouteMeta {
    auth?: boolean
    hideUI?: boolean
    dialog?: boolean
    transition?: string
    sheet?: SheetMeta
  }
}

declare module '@tanstack/vue-table' {
  interface ColumnMeta<TData extends RowData, TValue> {
    headerClass?: string
    cellClass?: string
  }
}
