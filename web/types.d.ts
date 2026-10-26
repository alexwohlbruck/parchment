import 'vue-router'
import '@tanstack/vue-table'
import type { SheetMeta } from '@/types/app.types'

export {}

declare module 'vue-router' {
  interface RouteMeta {
    auth?: boolean
    hideUI?: boolean
    /** Replaces the rail, sheets and map chrome with the view's own full-screen UI. */
    immersive?: boolean
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
