<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { AppRoute } from '@/router'
import EmptyState from '@/components/library/EmptyState.vue'
import { RouteIcon, Layers3Icon, MapIcon } from 'lucide-vue-next'

const route = useRoute()

const icon = computed(() => {
  if (route.name === AppRoute.LIBRARY_ROUTES) return RouteIcon
  if (route.name === AppRoute.LIBRARY_LAYERS) return Layers3Icon
  if (route.name === AppRoute.LIBRARY_MAPS) return MapIcon
  return MapIcon
})

const entityId = computed(() => {
  const routeToEntityId = {
    [AppRoute.LIBRARY_ROUTES]: 'routes',
    [AppRoute.LIBRARY_LAYERS]: 'layers',
    [AppRoute.LIBRARY_MAPS]: 'maps',
  }

  return (
    routeToEntityId[route.name as keyof typeof routeToEntityId] || 'unknown'
  )
})
</script>

<template>
  <div class="h-full flex items-start justify-center p-4">
    <EmptyState :icon="icon" :entity-id="entityId" />
  </div>
</template>
