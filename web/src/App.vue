<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useAppStore } from '@/stores/app.store'
import { useAuthStore } from '@/stores/auth.store'
import { useThemeStore } from '@/stores/theme.store'
import { useCommandService } from '@/services/command.service'
import { useAuthService } from '@/services/auth.service'
import { useIntegrationService } from '@/services/integration.service'
import { useCategoryStore } from '@/stores/category.store'
import { useCategoryPaletteStore } from '@/stores/category-palette.store'
import { useLayersStore } from '@/stores/layers.store'
import { useResponsive } from '@/lib/utils'
import { isTauri } from '@/lib/api'
import { useExternalLink } from '@/composables/useExternalLink'
import { useFriendLocationsLayer } from '@/composables/useFriendLocationsLayer'

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
const categoryPaletteStore = useCategoryPaletteStore()
const layersStore = useLayersStore()
const appStore = useAppStore()
const friendLocationsLayer = useFriendLocationsLayer()
const { isMobileScreen } = useResponsive()
const { openExternalLink } = useExternalLink()

const { dialogs } = appStore
const navMini = ref(true)
const viewRef = ref()

const hideUI = ref(true)
const authStore = useAuthStore()

// We don't use computed value here, it was causing a layout shift
watch(route, () => {
  hideUI.value = route.meta?.hideUI ?? false
})

// Global click handler for external links
function handleExternalLinkClick(event: MouseEvent) {
  const target = event.target as HTMLElement
  // Find the closest anchor tag or element with href
  const anchor = target.closest('a[href]') as HTMLAnchorElement | null
  if (!anchor) return

  // Don't intercept router-link components (they have router-link-active class or are router-link elements)
  if (
    anchor.classList.contains('router-link-active') ||
    anchor.classList.contains('router-link-exact-active') ||
    anchor.tagName.toLowerCase() === 'router-link' ||
    anchor.closest('router-link')
  ) {
    return
  }

  const href = anchor.getAttribute('href')
  if (!href) return

  // Check if it's an external link
  const isExternal =
    href.startsWith('http://') ||
    href.startsWith('https://') ||
    href.startsWith('mailto:') ||
    href.startsWith('tel:') ||
    href.startsWith('//') // Protocol-relative URLs

  // Check if it's an internal route (starts with / but not http:// or https://)
  const isInternalRoute = href.startsWith('/') && !href.startsWith('//')

  // Don't intercept internal routes or anchors
  if (isInternalRoute || href.startsWith('#')) {
    return
  }

  // If it's external, prevent default and use opener
  if (isExternal) {
    event.preventDefault()
    event.stopPropagation()
    openExternalLink(href, anchor.target || '_blank')
  }
}

onMounted(async () => {
  // TODO: Use maplibre if not authed or not on paid plan
  commandService.bindAllHotkeysToCommands()
  themeStore.initAccentColor()
  await authService.getAuthenticatedUser()

  // Fetch configured integrations for all users (public fields only).
  // This provides Mapbox token, OSM server URL, etc. to the client.
  await integrationService.fetchConfiguredIntegrations()

  if (authStore.me) {
    // These calls return immediately if cached, refreshing data in background
    await integrationService.fetchAvailableIntegrations()
    // Load existing layers, then provision any missing defaults
    await layersStore.loadLayers()
    await layersStore.initializeDefaults()
    // Initialize categories and palette (returns from cache instantly if available)
    categoryStore.init()
    categoryPaletteStore.loadPalette()
    // Initialize friend locations layer (watches visibility and polls accordingly)
    friendLocationsLayer.initialize()
  }

  // Add global click handler for external links
  document.addEventListener('click', handleExternalLinkClick, true)
})

onUnmounted(() => {
  // Remove global click handler
  document.removeEventListener('click', handleExternalLinkClick, true)
  // Cleanup friend locations layer
  friendLocationsLayer.cleanup()
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
  <div
    class="safe-area-blur fixed top-0 left-0 right-0 h-[calc(env(safe-area-inset-top)*1.2)] pointer-events-none z-50"
  ></div>

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

  <div
    class="flex flex-row h-[100vh] items-stretch"
    :class="isTauri ? '' : 'bg-background'"
  >
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
    <main
      class="flex-1 h-full overflow-hidden"
      :class="isTauri ? '' : 'bg-background'"
    >
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

.safe-area-blur {
  backdrop-filter: blur(2px);
  background: hsl(var(--muted) / 0.3);
  mask-image: linear-gradient(to bottom, black 0%, black 50%, transparent 100%);
}
</style>
