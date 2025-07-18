<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useResponsive } from '@/lib/utils'

import Navigation from './Navigation.vue'
import SettingsPage from './SettingsPage.vue'

const router = useRouter()
const { isMobileScreen } = useResponsive()

const isRootSettingsPage = computed(() => {
  return router.currentRoute.value.path === '/settings'
})
</script>

<template>
  <div class="flex overflow-y-hidden gap-4">
    <Navigation v-if="isRootSettingsPage || !isMobileScreen" />
    <SettingsPage v-if="!isRootSettingsPage || !isMobileScreen" />
  </div>
</template>
