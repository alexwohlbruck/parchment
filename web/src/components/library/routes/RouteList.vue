<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { RouteIcon } from 'lucide-vue-next'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SearchIcon, ArrowUpDownIcon, PlusIcon } from 'lucide-vue-next'
import RouteCard from '@/components/library/routes/RouteCard.vue'
import { fuzzyFilter } from '@/lib/utils'
import { AppRoute } from '@/router'
import type { Route } from '@/types/routes.types'

const props = defineProps<{
  routes: Route[]
  loading?: boolean
}>()

const router = useRouter()
const { t } = useI18n()

const searchQuery = ref('')
const sortBy = ref<'name' | 'createdAt' | 'updatedAt' | 'distance'>('updatedAt')
const sortOrder = ref<'asc' | 'desc'>('desc')

function routeDistance(r: Route): number {
  return r.distance ?? r.body?.stats?.distance ?? 0
}

const activeRoutes = computed(() => props.routes.filter(r => !r.archivedAt))

const filteredRoutes = computed(() => {
  let result = searchQuery.value
    ? fuzzyFilter(activeRoutes.value, searchQuery.value, {
        keys: ['name', 'description'],
        preserveOrder: true,
      })
    : activeRoutes.value

  result = [...result].sort((a, b) => {
    let comparison = 0
    if (sortBy.value === 'name') {
      comparison = (a.name || '').localeCompare(b.name || '')
    } else if (sortBy.value === 'updatedAt') {
      comparison =
        new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
    } else if (sortBy.value === 'createdAt') {
      comparison =
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    } else if (sortBy.value === 'distance') {
      comparison = routeDistance(a) - routeDistance(b)
    }
    return sortOrder.value === 'asc' ? comparison : -comparison
  })

  return result
})

function toggleSortOrder() {
  sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
}

function setSortBy(field: 'name' | 'createdAt' | 'updatedAt' | 'distance') {
  if (sortBy.value === field) {
    toggleSortOrder()
  } else {
    sortBy.value = field
    sortOrder.value = field === 'name' ? 'asc' : 'desc'
  }
}

function createRoute() {
  router.push({ name: AppRoute.ROUTE_BUILDER })
}
</script>

<template>
  <div class="h-full flex flex-col gap-2">
    <!-- Header -->
    <div>
      <div class="relative flex items-center gap-2">
        <div class="relative flex-1">
          <SearchIcon
            class="absolute left-2.5 top-3 size-4 text-muted-foreground"
          />
          <Input
            v-model="searchQuery"
            class="w-full pl-8"
            :placeholder="t('library.search.routes')"
          />
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button variant="outline" size="icon" class="h-10 w-10">
              <ArrowUpDownIcon class="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              :class="{ 'font-medium': sortBy === 'name' }"
              @click="setSortBy('name')"
            >
              {{ t('general.name') }}
              {{ sortBy === 'name' ? (sortOrder === 'asc' ? '↑' : '↓') : '' }}
            </DropdownMenuItem>
            <DropdownMenuItem
              :class="{ 'font-medium': sortBy === 'updatedAt' }"
              @click="setSortBy('updatedAt')"
            >
              {{ t('general.lastModified') }}
              {{ sortBy === 'updatedAt' ? (sortOrder === 'asc' ? '↑' : '↓') : '' }}
            </DropdownMenuItem>
            <DropdownMenuItem
              :class="{ 'font-medium': sortBy === 'distance' }"
              @click="setSortBy('distance')"
            >
              {{ t('library.sort.distance') }}
              {{ sortBy === 'distance' ? (sortOrder === 'asc' ? '↑' : '↓') : '' }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="outline"
          size="icon"
          class="h-10 w-10"
          @click="createRoute"
        >
          <PlusIcon class="h-4 w-4" />
        </Button>
      </div>
    </div>

    <div v-if="loading" class="flex-1 flex items-center justify-center">
      <Spinner />
    </div>

    <div
      v-else-if="filteredRoutes.length === 0"
      class="flex-1 flex items-center justify-center"
    >
      <EmptyState
        :icon="RouteIcon"
        :title="
          searchQuery
            ? t('library.empty.searchResults', {
                entityPlural: t('library.entities.routes.title.plural'),
              })
            : t('library.empty.noRoutes')
        "
      >
        <Button v-if="searchQuery" size="sm" variant="outline" @click="searchQuery = ''">
          {{ t('general.clearSearch') }}
        </Button>
      </EmptyState>
    </div>

    <div v-else class="flex flex-col gap-2 pb-4 flex-1">
      <RouteCard
        v-for="route in filteredRoutes"
        :key="route.id"
        :route="route"
        class="w-full"
      />
    </div>
  </div>
</template>
