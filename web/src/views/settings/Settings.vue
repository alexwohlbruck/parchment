<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useResponsive } from '@/lib/utils'
import { useSettingsScrollTarget } from '@/composables/useSettingsScrollTarget'

import Navigation from './Navigation.vue'
import SettingsPage from './SettingsPage.vue'

const router = useRouter()
const { isMobileScreen } = useResponsive()

// Settings is rendered twice for the same route — once inside the dialog
// and once inside the map's LeftSheet (the LeftSheet sits off-screen via
// transform, but its DOM is still live). We pin every DOM query to THIS
// Settings instance via a root ref so the composable doesn't accidentally
// pick up the hidden copy.
const settingsRoot = ref<HTMLElement | null>(null)

useSettingsScrollTarget(settingsRoot)

const isRootSettingsPage = computed(() => {
  return router.currentRoute.value.path === '/settings'
})
</script>

<template>
  <div ref="settingsRoot" class="flex overflow-y-hidden gap-4 h-full">
    <Navigation v-if="isRootSettingsPage || !isMobileScreen" />
    <SettingsPage v-if="!isRootSettingsPage || !isMobileScreen" />
  </div>
</template>
