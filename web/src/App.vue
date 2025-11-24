<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useAppStore } from '@/stores/app.store'
import { useAuthStore } from '@/stores/auth.store'
import { useThemeStore } from '@/stores/theme.store'
import { useCommandService } from '@/services/command.service'
import { useAuthService } from '@/services/auth.service'
import { useIntegrationService } from '@/services/integration.service'
import { useCategoryStore } from '@/stores/category.store'
import { useLayersStore } from '@/stores/layers.store'
import { useResponsive } from '@/lib/utils'

import DesktopNav from '@/components/navigation/DesktopNavigation.vue'
import MobileNav from '@/components/navigation/MobileNavigation.vue'
import DialogView from '@/views/DialogView.vue'
import HotkeysMenu from '@/components/HotkeysMenu.vue'
import { Toaster } from '@/components/ui/sonner'
import { TransitionSlide } from '@morev/vue-transitions'

const route = useRoute()
const themeStore = useThemeStore()
const commandService = useCommandService()
const authService = useAuthService()
const integrationService = useIntegrationService()
const categoryStore = useCategoryStore()
const layersStore = useLayersStore()
const appStore = useAppStore()
const { isMobileScreen } = useResponsive()

const { dialogs } = appStore
const navMini = ref(true)
const viewRef = ref()

const hideUI = ref(true)
const authStore = useAuthStore()

// We don't use computed value here, it was causing a layout shift
watch(route, () => {
  hideUI.value = route.meta?.hideUI ?? false
})

onMounted(async () => {
  // TODO: Use maplibre if not authed or not on paid plan
  commandService.bindAllHotkeysToCommands()
  themeStore.initAccentColor()
  await authService.getAuthenticatedUser()
  if (authStore.me) {
    await integrationService.fetchAvailableIntegrations()
    await integrationService.fetchConfiguredIntegrations()
    // Load existing layers first
    await layersStore.loadLayers()
    // Then populate any missing template layers
    await layersStore.populateUserLayerTemplates()
    // Initialize categories for offline search
    categoryStore.init()
  }
})

function afterNavTransition(value: boolean) {
  if (viewRef.value?.navTransitioning) {
    viewRef.value.navTransitioning(value)
  }
}

function beforeNavTransition(value: boolean) {
  if (viewRef.value?.navTransitioning) {
    viewRef.value.navTransitioning(value)
  }
}
</script>

<template>
  <!-- Popups and modals -->
  <Toaster richColors closeButton :duration="7000" position="bottom-center" />
  <HotkeysMenu />
  <DialogView></DialogView>

  <div v-for="dialog in dialogs" :key="dialog.id">
    <component
      :is="dialog.component"
      v-bind="dialog.props"
      @submit="async e => dialog.onSubmit(await e)"
      :loading="dialog.loading"
    />
  </div>

  <div class="flex flex-row h-dvh bg-background items-stretch">
    <!-- Desktop navigation -->
    <template v-if="!isMobileScreen">
      <transition-slide
        appear
        no-opacity
        :offset="['-130%', 0]"
        @after-enter="() => afterNavTransition(true)"
        @before-leave="() => beforeNavTransition(false)"
      >
        <DesktopNav v-if="!hideUI" v-model:mini="navMini" class="z-40 h-full" />
      </transition-slide>
    </template>

    <!-- Mobile navigation -->
    <template v-else-if="!hideUI">
      <MobileNav class="z-20" />
    </template>

    <!-- Main content -->
    <main class="flex-1">
      <router-view v-slot="{ Component }">
        <keep-alive include="Map">
          <component :is="Component" ref="viewRef" />
        </keep-alive>
      </router-view>
    </main>
  </div>
</template>

<style scoped>
.debug-rect {
  border: 2px dashed rgba(255, 0, 0, 0.7);
  background-color: rgba(255, 0, 0, 0.1);
}
</style>
