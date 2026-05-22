<script setup lang="ts" generic="TData, TValue">
import { computed, watch } from 'vue'
import type { ColumnDef, PaginationState } from '@tanstack/vue-table'
import {
  FlexRender,
  getCoreRowModel,
  getPaginationRowModel,
  useVueTable,
} from '@tanstack/vue-table'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
} from 'lucide-vue-next'
import { Caption } from '@/components/ui/typography'

const props = withDefaults(
  defineProps<{
    columns: ColumnDef<TData, TValue>[]
    data: TData[]
    onRowClick?: (row: TData) => void
    pageSize?: number
    // Server-side pagination: parent owns page state
    totalItems?: number
    currentPage?: number
  }>(),
  {
    pageSize: 0,
    totalItems: undefined,
    currentPage: undefined,
  },
)

const emit = defineEmits<{
  'update:page': [page: number]
}>()

const paginated = computed(() => props.pageSize > 0)
const isServerSide = computed(
  () => props.totalItems !== undefined && props.currentPage !== undefined,
)

const table = useVueTable({
  get data() {
    return props.data
  },
  get columns() {
    return props.columns
  },
  getCoreRowModel: getCoreRowModel(),
  ...(paginated.value && !isServerSide.value
    ? { getPaginationRowModel: getPaginationRowModel() }
    : {}),
  ...(paginated.value
    ? {
        initialState: {
          pagination: { pageIndex: 0, pageSize: props.pageSize },
        },
      }
    : {}),
  ...(isServerSide.value
    ? {
        manualPagination: true,
        get pageCount() {
          return Math.ceil((props.totalItems ?? 0) / props.pageSize)
        },
      }
    : {}),
})

// Sync server-side page from parent
watch(
  () => props.currentPage,
  (page) => {
    if (page !== undefined) {
      table.setPageIndex(page - 1)
    }
  },
)

const totalPages = computed(() => table.getPageCount())
const currentPageIndex = computed(() => table.getState().pagination.pageIndex)

function goToPage(page: number) {
  if (isServerSide.value) {
    emit('update:page', page + 1)
  } else {
    table.setPageIndex(page)
  }
}

function handleRowClick(event: MouseEvent, row: TData) {
  props.onRowClick?.(row)
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="border border-border rounded-md overflow-y-auto">
      <Table>
        <TableHeader>
          <TableRow
            v-for="headerGroup in table.getHeaderGroups()"
            :key="headerGroup.id"
          >
            <!-- TODO: Remove any type -->
            <TableHead
              v-for="header in headerGroup.headers"
              :key="header.id"
              :class="(header.column.columnDef.meta as any)?.headerClass"
            >
              <FlexRender
                v-if="!header.isPlaceholder"
                :render="header.column.columnDef.header"
                :props="header.getContext()"
              />
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <template v-if="table.getRowModel().rows?.length">
            <TableRow
              v-for="row in table.getRowModel().rows"
              :key="row.id"
              :data-state="row.getIsSelected() ? 'selected' : undefined"
              :class="{ 'cursor-pointer hover:bg-muted/50': onRowClick }"
              @click="handleRowClick($event, row.original)"
            >
              <!-- TODO: Remove any type -->
              <TableCell
                v-for="cell in row.getVisibleCells()"
                :key="cell.id"
                :class="(cell.column.columnDef.meta as any)?.cellClass"
              >
                <FlexRender
                  :render="cell.column.columnDef.cell"
                  :props="cell.getContext()"
                />
              </TableCell>
            </TableRow>
          </template>
          <template v-else>
            <TableRow>
              <TableCell :colSpan="columns.length" class="h-24 text-center">
                <!-- TODO: i18n -->
                No items.
              </TableCell>
            </TableRow>
          </template>
        </TableBody>
      </Table>
    </div>

    <!-- Pagination controls -->
    <div
      v-if="paginated && totalPages > 1"
      class="flex items-center justify-between px-1"
    >
      <Caption class="text-muted-foreground">
        Page {{ currentPageIndex + 1 }} of {{ totalPages }}
      </Caption>
      <div class="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon-sm"
          :disabled="!table.getCanPreviousPage()"
          @click="goToPage(0)"
        >
          <ChevronsLeftIcon class="size-4" />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          :disabled="!table.getCanPreviousPage()"
          @click="goToPage(currentPageIndex - 1)"
        >
          <ChevronLeftIcon class="size-4" />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          :disabled="!table.getCanNextPage()"
          @click="goToPage(currentPageIndex + 1)"
        >
          <ChevronRightIcon class="size-4" />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          :disabled="!table.getCanNextPage()"
          @click="goToPage(totalPages - 1)"
        >
          <ChevronsRightIcon class="size-4" />
        </Button>
      </div>
    </div>
  </div>
</template>
