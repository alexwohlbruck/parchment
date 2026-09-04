<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref, watch, watchEffect } from 'vue'
import { useRoute } from 'vue-router'
import { useAppStore } from '@/stores/app.store'
import { useAuthStore } from '@/stores/auth.store'
import { useIntegrationsStore } from '@/stores/integrations.store'
import { useThemeStore } from '@/stores/theme.store'
import { useCommandService } from '@/services/command.service'
import { useAuthService } from '@/services/auth.service'
import { useIntegrationService } from '@/services/integration.service'
import { useCategoryStore } from '@/stores/category.store'
import { useCategoryPaletteStore } from '@/stores/category-palette.store'
import { useLayersStore } from '@/stores/layers.store'
import { useBookmarksService } from '@/services/library/bookmarks.service'
import { useCollectionsService } from '@/services/library/collections.service'
import { useStorage } from '@vueuse/core'
import { useResponsive } from '@/lib/utils'
import { isTauri } from '@/lib/api'
import { useExternalLink } from '@/composables/useExternalLink'
import { useFriendLocationsLayer } from '@/composables/useFriendLocationsLayer'
import { useTrackerLocationsLayer } from '@/composables/useTrackerLocationsLayer'
import { useVehiclesStore } from '@/stores/vehicles.store'
import { useRecentsStore } from '@/stores/recents.store'
import { PermissionId } from '@/types/auth.types'
import {
  connect as realtimeConnect,
  disconnect as realtimeDisconnect,
} from '@/lib/realtime'
// Side-effect import: each store that cares about realtime calls
// `registerRealtimeHandlers` at import time, so we just need to make sure
// those modules run. A dedicated bootstrap file keeps the side-effect
// imports in one obvious place.
import '@/lib/realtime-bootstrap'

import { SIDEBAR_WIDTH } from '@/components/ui/sidebar'
import DesktopNav from '@/components/navigation/DesktopNavigation.vue'
import MobileNav from '@/components/navigation/MobileNavigation.vue'
import FeedbackDialog from '@/components/feedback/FeedbackDialog.vue'
import { useFeedback } from '@/composables/useFeedback'
import { useShakeGesture } from '@/composables/useShakeGesture'
import DialogView from '@/views/DialogView.vue'
import HotkeysMenu from '@/components/HotkeysMenu.vue'
import ImpersonationBanner from '@/components/ImpersonationBanner.vue'
import OnboardingDialog from '@/components/onboarding/OnboardingDialog.vue'
import KeyRestoreDialog from '@/components/onboarding/KeyRestoreDialog.vue'
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
const bookmarksService = useBookmarksService()
const collectionsService = useCollectionsService()
const appStore = useAppStore()
const friendLocationsLayer = useFriendLocationsLayer()
const trackerLocationsLayer = useTrackerLocationsLayer()
const vehiclesStore = useVehiclesStore()
const recentsStore = useRecentsStore()
const { isMobileScreen } = useResponsive()
const isDev = import.meta.env.DEV

// Shake to send feedback (mobile only). Opt-in via Settings → Behavior, which
// is also where iOS gets the user gesture it needs to grant motion access.
const feedbackDialogOpen = ref(false)
const { available: feedbackAvailable, ensureLoaded: loadFeedback } = useFeedback()
const shake = useShakeGesture(() => {
  if (feedbackAvailable.value) feedbackDialogOpen.value = true
})

watchEffect(() => {
  const wanted =
    isMobileScreen.value && appStore.shakeForFeedback && feedbackAvailable.value
  if (wanted && shake.canStartWithoutPrompt()) shake.start()
  else if (!wanted) shake.stop()
})

watch(
  () => appStore.shakeForFeedback,
  enabled => {
    if (enabled) loadFeedback()
  },
  { immediate: true },
)

// TEMPORARY: the building-lighting tuner, as a panel over the map. Opened from
// Settings → Developer, which is a dialog that covers the very thing being
// tuned. Async-imported behind the dev check so the chunk never ships.
const BuildingShadePopover = isDev
  ? defineAsyncComponent(() => import('@/components/map/dev/BuildingShadePopover.vue'))
  : null
const shadePopoverOpen = ref(
  isDev && sessionStorage.getItem('dev:shade-popover') === '1',
)
watch(
  () => route.fullPath,
  () => {
    if (isDev) shadePopoverOpen.value = sessionStorage.getItem('dev:shade-popover') === '1'
  },
)

const { openExternalLink } = useExternalLink()

const { dialogs } = appStore
// Collapsed by default, and remembered — the rail's width changes the map's
// viewport, so relearning it on every load is a visible layout shift.
const navCollapsed = useStorage('sidebar-collapsed', true)
// Width the user dragged the rail to, kept for the same reason.
const navWidth = useStorage('sidebar-width', SIDEBAR_WIDTH)
const viewRef = ref()

const hideUI = ref(true)
const authStore = useAuthStore()
const integrationsStore = useIntegrationsStore()

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

// Post-auth client bootstrap: load user-owned data and initialize the
// map/realtime layers. Runs once per authenticated session. Guarded so it
// can be safely invoked from both the initial mount (cached session) and the
// auth watcher (fresh sign-in) without double-executing.
let authBootstrapped = false
async function bootstrapAuthenticatedUser() {
  if (authBootstrapped || !authStore.me) return
  authBootstrapped = true

  // These calls return immediately if cached, refreshing data in background
  await integrationService.fetchAvailableIntegrations()
  // Load user-owned layers + default templates + user state sidecar
  await layersStore.loadLayers()
  // Hydrate the full bookmark list. Covers frequents (standalone, in no
  // collection) and everything the saved-places map layer draws, neither of
  // which the per-collection hydrate would surface.
  void bookmarksService.fetchBookmarks()
  // Collections are needed alongside them, not just on the library screen:
  // the map styles each saved place after its collection, and the layer
  // selector builds a toggle per collection. Without this a fresh device has
  // bookmarks whose collections it has never heard of, so they'd draw nowhere
  // and have no switch that could turn them on.
  void collectionsService.fetchCollections()
  // Fetch user vehicles for trip planning
  vehiclesStore.fetchVehicles()
  // Initialize categories and palette (returns from cache instantly if available)
  categoryStore.init()
  categoryPaletteStore.loadPalette()
  // Recents fill the search palette's idle state. Fetching + decrypting them
  // here means opening the palette renders from memory rather than waiting on
  // the encrypted blob.
  void recentsStore.ensureSearchesHydrated()
  void recentsStore.ensurePlacesHydrated()
  // Initialize friend locations layer (watches visibility and polls accordingly)
  // Requires social permissions — skip for free users to avoid 403s
  if (authService.hasPermission(PermissionId.SOCIAL_READ)) {
    friendLocationsLayer.initialize()
  }
  // Initialize tracker locations layer (handles marker click → detail navigation)
  trackerLocationsLayer.initialize()
  // Open the realtime WebSocket now that the user is known. Disconnects
  // and reconnects across signin/signout are handled by the auth watcher below.
  realtimeConnect()
}

onMounted(async () => {
  // TODO: Use maplibre if not authed or not on paid plan
  commandService.bindAllHotkeysToCommands()
  themeStore.initAccentColor()
  await authService.getAuthenticatedUser()

  // Fetch configured integrations for all users (public fields only).
  // This provides Mapbox token, OSM server URL, etc. to the client.
  await integrationService.fetchConfiguredIntegrations()

  // The *available* integrations list is the set a user could configure, so
  // it is authenticated. A signed-out visitor has none — and the map waits on
  // both lists before it will draw, so leaving it unset stranded anonymous
  // pages (a public canvas link) on the loading state forever. An empty list
  // is the correct answer for them, not a missing one.
  if (!authStore.me && !Array.isArray(integrationsStore.availableIntegrations)) {
    integrationsStore.availableIntegrations = []
  }

  // Bootstrap if the user is already known at mount (cached session). A fresh
  // sign-in leaves `me` null here and is handled by the auth watcher below.
  await bootstrapAuthenticatedUser()

  // Add global click handler for external links
  document.addEventListener('click', handleExternalLinkClick, true)
})

onUnmounted(() => {
  // Remove global click handler
  document.removeEventListener('click', handleExternalLinkClick, true)
  // Cleanup location layers
  friendLocationsLayer.cleanup()
  trackerLocationsLayer.cleanup()
  // Close the realtime socket. Any open socket for a stale session is
  // worse than no socket.
  realtimeDisconnect()
})

// Tie the authed bootstrap + realtime lifecycle to auth lifecycle. A fresh
// sign-in (or getting auth'd after an initial anonymous load) leaves `me` null
// at mount, so this watcher is what runs the bootstrap in that case — without
// it, layers and other user data only appear on the next full page reload.
// Signing out resets the guard so a subsequent sign-in re-bootstraps.
watch(
  () => authStore.me?.id,
  (id, previous) => {
    if (id && !previous) void bootstrapAuthenticatedUser()
    else if (!id && previous) {
      authBootstrapped = false
      realtimeDisconnect()
    }
  },
)

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
  <ImpersonationBanner v-if="isDev" />
  <component :is="BuildingShadePopover" v-if="shadePopoverOpen" />
  <OnboardingDialog v-if="authStore.needsOnboarding" />
  <KeyRestoreDialog v-else-if="authStore.me" />

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
        <DesktopNav
          v-if="!hideUI"
          v-model:collapsed="navCollapsed"
          v-model:width="navWidth"
          class="z-40 h-full"
        />
      </transition-slide>
    </template>

    <!-- Mobile navigation -->
    <template v-else-if="!hideUI">
      <MobileNav class="z-20" />
    </template>

    <FeedbackDialog v-if="isMobileScreen" v-model:open="feedbackDialogOpen" />

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
