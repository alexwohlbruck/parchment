<script setup lang="ts">
import { computed, watch } from 'vue'
import RouteCard from '@/components/library/routes/RouteCard.vue'
import { useRoutesStore } from '@/stores/library/routes.store'
import { useRoutesService } from '@/services/library/routes.service'

const props = defineProps<{ id: string }>()

const routesStore = useRoutesStore()
const routesService = useRoutesService()
const route = computed(() => routesStore.getRouteById(props.id))

watch(
  () => props.id,
  id => {
    if (!routesStore.getRouteById(id)) void routesService.fetchRouteById(id)
  },
  { immediate: true },
)
</script>

<template>
  <RouteCard v-if="route" :route="route" />
</template>
