<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { RouteIcon, PlusIcon } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { capitalize } from '@/lib/string.utils'
import { useConnectivity } from '@/composables/useConnectivity'
import { useRoutesService } from '@/services/library/routes.service'
import { useRoutesStore } from '@/stores/library/routes.store'
import RouteList from '@/components/library/routes/RouteList.vue'

const { t } = useI18n()
const routesService = useRoutesService()
const routesStore = useRoutesStore()
const { routes } = storeToRefs(routesStore)
const { isOffline, onReconnected } = useConnectivity()
const loadingRoutes = ref(true)

async function load() {
  loadingRoutes.value = true
  await routesService.fetchRoutes()
  loadingRoutes.value = false
}

onMounted(load)
onReconnected(load)

const showEmptyState = computed(
  () => !loadingRoutes.value && routes.value.length === 0,
)
// No cached routes and no way to fetch them — offline, not "no routes yet".
const showOffline = computed(() => showEmptyState.value && isOffline.value)
const loading = computed(
  () => loadingRoutes.value && routes.value.length === 0,
)
</script>

<template>
  <div class="min-h-full flex flex-col">
    <EmptyState
      v-if="showEmptyState"
      :icon="RouteIcon"
      :title="
        capitalize(
          t('library.empty.message', {
            entityPlural: t('library.entities.routes.title.plural'),
          }),
        )
      "
      :offline="showOffline"
      offline-actions
      class="mt-24"
      @retry="load"
    >
      <Button variant="outline" size="sm" class="gap-1.5" as-child>
        <RouterLink :to="{ name: 'route-builder' }">
          <PlusIcon class="size-3" />
          {{
            capitalize(
              t('library.empty.action', {
                entitySingular: t('library.entities.routes.title.singular'),
              }),
            )
          }}
        </RouterLink>
      </Button>
    </EmptyState>

    <RouteList v-else :routes="routes" :loading="loading" class="flex-1" />
  </div>
</template>
