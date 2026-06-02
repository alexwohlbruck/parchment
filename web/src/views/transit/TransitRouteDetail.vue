<script setup lang="ts">
/**
 * Transit Route Detail View
 *
 * Dedicated route at /transit/route/:feedId/:routeId
 * Renders the route detail panel in the left sheet.
 */
import { onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { useRouteDetailStore } from '@/stores/route-detail.store'
import RouteDetailPage from '@/components/place/pages/RouteDetailPage.vue'

const route = useRoute()
const store = useRouteDetailStore()

const feedId = route.params.feedId as string
const routeId = route.params.routeId as string
</script>

<template>
  <RouteDetailPage
    :feedId="feedId"
    :routeId="routeId"
  />
</template>
