<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useResponsive } from '@/lib/utils'

import Navigation from './Navigation.vue'
import SettingsPage from './SettingsPage.vue'

const router = useRouter()
const { isSmallScreen } = useResponsive()

const isRootSettingsPage = computed(() => {
  return router.currentRoute.value.path === '/settings'
})
</script>

<template>
  <div class="flex gap-4">
    <Navigation v-if="isRootSettingsPage || !isSmallScreen" />
    <SettingsPage v-if="!isRootSettingsPage || !isSmallScreen" />
  </div>
</template>
