<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { RouteIcon, PlusIcon } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { useRoutesService } from '@/services/library/routes.service'
import { useRoutesStore } from '@/stores/library/routes.store'
import RoutesList from '@/components/library/RoutesList.vue'

const routesService = useRoutesService()
const routesStore = useRoutesStore()
const { routes } = storeToRefs(routesStore)
const loadingRoutes = ref(true)

onMounted(async () => {
  loadingRoutes.value = true
  await routesService.fetchRoutes()
  loadingRoutes.value = false
})

const showEmptyState = computed(
  () => !loadingRoutes.value && routes.value.length === 0,
)
const loading = computed(
  () => loadingRoutes.value && routes.value.length === 0,
)
</script>

<template>
  <div class="h-full flex flex-col">
    <div
      v-if="showEmptyState"
      class="flex-1 flex flex-col items-center gap-3 mt-32"
    >
      <RouteIcon class="size-12 text-muted-foreground" />
      <p class="text-muted-foreground text-sm">You have no routes yet</p>
      <Button variant="outline" size="sm" class="gap-1.5" as-child>
        <RouterLink :to="{ name: 'route-builder' }">
          <PlusIcon class="size-3" />
          Create route
        </RouterLink>
      </Button>
    </div>

    <RoutesList v-else :routes="routes" :loading="loading" class="flex-1" />
  </div>
</template>
