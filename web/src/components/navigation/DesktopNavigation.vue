<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { AppRoute } from '@/router'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { useCommandStore } from '@/stores/command.store'
import { useAppStore } from '@/stores/app.store'
import { capitalize } from '@/filters/text.filters'
import { isTauri, getIsTauri } from '@/lib/api'
import { useWindowSize } from '@vueuse/core'
import { useExternalLink } from '@/composables/useExternalLink'
import { useMapService } from '@/services/map.service'
import { useUpdater } from '@/composables/useUpdater'
import { appEventBus } from '@/lib/eventBus'

import { Button } from '@/components/ui/button'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
  SIDEBAR_WIDTH,
} from '@/components/ui/sidebar'
import ParchmentLogo from '@/assets/parchment.svg?component'
import AccountDropdown from '@/components/navigation/AccountDropdown.vue'
import {
  CornerUpRightIcon,
  SettingsIcon,
  PanelLeftIcon,
  LibraryIcon,
  MessageSquareQuoteIcon,
  SearchIcon,
  MegaphoneIcon,
  HistoryIcon,
  LayoutDashboardIcon,
  TelescopeIcon,
} from 'lucide-vue-next'
import UpdateBanner from '@/components/navigation/UpdateBanner.vue'
import { useHotkeys } from '@/composables/useHotkeys'
import { useFullscreen } from '@/composables/useFullscreen'
import { CommandName } from '@/stores/command.store'
import { HotkeyId } from '@/stores/hotkey.store'
import { Icon } from '@/types/app.types'
import { Hotkey } from '@/types/command.types'
import Palette from '@/components/palette/Palette.vue'
import { CommandDialog } from '@/components/ui/command'
import { useCommandService } from '@/services/command.service'
import ResponsiveHoverCard from '@/components/responsive/ResponsiveHoverCard.vue'

const router = useRouter()
const route = useRoute()
const { t } = useI18n()
const { openExternalLink } = useExternalLink()
const mapService = useMapService()
const { isFullscreen } = useFullscreen()
const commandService = useCommandService()
const commandStore = useCommandStore()
const appStore = useAppStore()

const collapsed = defineModel<boolean>('collapsed', { default: true })
const width = defineModel<number>('width', { default: SIDEBAR_WIDTH })
const sidebarRef = ref<InstanceType<typeof Sidebar> | null>(null)
const { width: windowWidth, height: windowHeight } = useWindowSize()
const paletteDialogOpen = ref(false)
const paletteDialogRef = ref<InstanceType<typeof Palette> | null>(null)

const isDashboard = computed(() => route.name === AppRoute.DASHBOARD)

// Shared by the binding below and the hint on the Settings row. Rows take the
// literal combo rather than a hotkey id because ids resolve from a registry
// that is only populated once the owning component has mounted.
const SETTINGS_HOTKEY: Hotkey = ['mod', ',']

const isTauriDesktop = ref(false)
const updateDismissed = ref(false)
// Set to true to force-show the update banner for debugging
const forceShowUpdateBanner = ref(false)
const { updateAvailable, checkForUpdates, installUpdate, installInProgress } =
  useUpdater()

useHotkeys([
  {
    id: HotkeyId.TOGGLE_NAV_MINI,
    key: ['s'],
    name: t('navigation.toggle'),
    description: t('navigation.toggleDescription'),
    handler: () => (collapsed.value = !collapsed.value),
  },
  {
    id: HotkeyId.COMMAND_PALETTE,
    key: ['mod', 'k'],
    name: t('palette.commands.search.name'),
    description: t('palette.commands.search.description'),
    handler: () => openPalette(),
  },
  {
    id: HotkeyId.OPEN_SETTINGS,
    key: SETTINGS_HOTKEY,
    name: t('settings.title'),
    description: t('settings.openHotkeyDescription'),
    handler: () => {
      const current = router.currentRoute.value
      if (current.matched.some(r => r.name === AppRoute.SETTINGS)) return
      router.push({ name: AppRoute.SETTINGS })
    },
  },
])

// ==================== MAP GEOMETRY ====================
//
// The map is a flex sibling of this rail, so every pixel the rail gives up
// belongs to the canvas. `Sidebar` reports its animated width on each frame
// of a collapse or expand; republishing bounds and resizing there keeps the
// map in lockstep with the animation instead of snapping at the end of it.

function publishBounds() {
  const el = sidebarRef.value?.$el as HTMLElement | undefined
  if (!el) return
  const rect = el.getBoundingClientRect()
  appStore.updateManualBounds('desktopNav', {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
  })
}

function handleSidebarResize() {
  publishBounds()
  mapService.resize()
}

watch([windowWidth, windowHeight], () => nextTick(publishBounds), {
  flush: 'post',
})

onMounted(async () => {
  // The obstructing-components map is keyed by name; we publish bounds
  // manually rather than letting it track the component, so the entry only
  // needs to exist.
  if (!appStore.getObstructingComponent('desktopNav')) {
    appStore.trackObstructingComponentWithKey('desktopNav', {} as any)
  }
  await nextTick()
  publishBounds()

  isTauriDesktop.value = await getIsTauri()
  if (isTauriDesktop.value) {
    void checkForUpdates()
  }
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    ;(
      window as unknown as {
        __parchmentForceShowUpdateBanner?: typeof forceShowUpdateBanner
      }
    ).__parchmentForceShowUpdateBanner = forceShowUpdateBanner
  }
})

async function handleRestartToUpdate() {
  try {
    toast.loading(t('profileMenu.updateInstalling'), { id: 'updater' })
    await installUpdate()
    toast.success(t('profileMenu.updateAvailable'), { id: 'updater' })
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e), { id: 'updater' })
  }
}

// ==================== NAVIGATION ====================

interface NavItem {
  label: string
  icon: Icon
  /** A destination. Omitted for the rows that just run an action. */
  to?: string
  commandId?: CommandName
  onClick?: () => void
}

const items = computed<NavItem[]>(() => [
  {
    label: t('palette.commands.search.name'),
    icon: SearchIcon,
    commandId: CommandName.SEARCH,
    onClick: () => openPalette(true),
  },
  { label: t('dashboard.title'), icon: LayoutDashboardIcon, to: '/dashboard' },
  { label: t('directions.title'), icon: CornerUpRightIcon, to: '/directions' },
  { label: capitalize(t('library.title')), icon: LibraryIcon, to: '/library' },
  { label: 'Lookout', icon: TelescopeIcon, to: '/lookout' },
  { label: t('timeline.title'), icon: HistoryIcon, to: '/timeline' },
])

/**
 * Rows are real links, so the default is to let the browser navigate. The one
 * exception is a collapsed left drawer: then the click's job is to reopen the
 * drawer, and re-navigating to the route you are already on would do nothing
 * but discard the drawer's state.
 */
function handleNavClick(event: MouseEvent, to: string) {
  if (!appStore.leftSheetHidden) return
  appStore.leftSheetHidden = false
  if (router.currentRoute.value.path.startsWith(to)) event.preventDefault()
}

function openPalette(withSearch = false) {
  if (isDashboard.value) {
    appEventBus.emit('palette:focus')
    return
  }
  paletteDialogOpen.value = true
  if (withSearch) {
    commandService.executeCommand(commandStore.getCommand(CommandName.SEARCH)!)
  }
}

const handlePaletteOpen = () => {
  openPalette()
}

onMounted(() => {
  appEventBus.on('palette:open', handlePaletteOpen)
})

onUnmounted(() => {
  appEventBus.off('palette:open', handlePaletteOpen)
})

defineExpose({
  /** Set to true to force-show the update banner (e.g. in console: $refs.desktopNav.forceShowUpdateBanner = true). */
  forceShowUpdateBanner,
})
</script>

<template>
  <Sidebar
    ref="sidebarRef"
    v-model:collapsed="collapsed"
    v-model:width="width"
    :label="t('navigation.title')"
    :class="isTauri ? 'tauri-translucent' : 'bg-muted/50'"
    data-tauri-drag-region
    @resize="handleSidebarResize"
  >
    <!-- Spacer for the macOS traffic lights, which are hidden in fullscreen -->
    <div
      v-if="isTauri && !isFullscreen"
      class="h-6 shrink-0"
      data-tauri-drag-region
    ></div>

    <SidebarHeader data-tauri-drag-region>
      <div class="flex items-center gap-1 h-10">
        <router-link
          v-if="!isTauri"
          to="/"
          class="flex-1 min-w-0 h-10 flex items-center gap-2.5 rounded-md no-underline hover:bg-foreground/5 transition-all duration-200"
          :class="collapsed ? 'px-1' : 'px-2'"
        >
          <ParchmentLogo
            class="size-7 shrink-0 text-primary"
            aria-label="Parchment"
          />
          <span
            class="text-base font-display text-foreground whitespace-nowrap transition-opacity duration-150"
            :class="collapsed ? 'opacity-0' : 'opacity-100'"
          >
            Parchment
          </span>
        </router-link>
        <div v-else class="flex-1" data-tauri-drag-region></div>

        <Button
          v-if="!collapsed"
          variant="ghost"
          size="icon"
          class="shrink-0 text-foreground hover:bg-foreground/5"
          :aria-label="t('navigation.minimize')"
          @click="collapsed = true"
        >
          <PanelLeftIcon class="size-5" />
        </Button>
      </div>
    </SidebarHeader>

    <CommandDialog
      v-model:open="paletteDialogOpen"
      modal
      class="top-[20%] bottom-auto"
    >
      <Palette
        ref="paletteDialogRef"
        v-model:open="paletteDialogOpen"
        :show-hints="true"
      />
    </CommandDialog>

    <SidebarContent>
      <SidebarMenu>
        <SidebarMenuItem
          v-for="item in items"
          :key="item.to ?? item.label"
          :label="item.label"
          :icon="item.icon"
          :to="item.to"
          :command-id="item.commandId"
          @click="item.to ? handleNavClick($event, item.to) : item.onClick?.()"
        />
      </SidebarMenu>
    </SidebarContent>

    <!-- Slot for custom banner alerts. Default: the Tauri update banner. -->
    <div class="px-2">
      <slot name="banner">
        <template
          v-if="
            forceShowUpdateBanner ||
            (isTauriDesktop && updateAvailable && !updateDismissed)
          "
        >
          <UpdateBanner
            v-if="!collapsed"
            :update-available="updateAvailable"
            :force-show-update-banner="forceShowUpdateBanner"
            :install-in-progress="installInProgress"
            :embedded="false"
            @restart="handleRestartToUpdate"
            @dismiss="updateDismissed = true"
          />
          <ResponsiveHoverCard
            v-else
            side="right"
            :side-offset="10"
            align="start"
            :open-delay="200"
            desktop-content-class="p-0 w-fit overflow-hidden rounded-md"
          >
            <template #trigger>
              <button
                type="button"
                class="w-full h-10 px-2 flex items-center rounded-md cursor-pointer text-foreground hover:bg-foreground/5 transition-colors"
                :aria-label="t('profileMenu.updateBanner')"
              >
                <span class="relative inline-flex">
                  <MegaphoneIcon class="size-5" />
                  <span
                    class="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-primary ring-2 ring-muted"
                    aria-hidden
                  />
                </span>
              </button>
            </template>
            <template #content>
              <UpdateBanner
                :update-available="updateAvailable"
                :force-show-update-banner="forceShowUpdateBanner"
                :install-in-progress="installInProgress"
                :embedded="true"
                @restart="handleRestartToUpdate"
                @dismiss="updateDismissed = true"
              />
            </template>
          </ResponsiveHoverCard>
        </template>
      </slot>
    </div>

    <SidebarFooter>
      <SidebarMenu>
        <SidebarMenuItem
          :label="t('feedback.title')"
          :icon="MessageSquareQuoteIcon"
          @click="
            openExternalLink(
              'https://github.com/alexwohlbruck/parchment/issues',
              '_blank',
            )
          "
        />
        <SidebarMenuItem
          :label="t('settings.title')"
          :icon="SettingsIcon"
          to="/settings"
          :hotkey="SETTINGS_HOTKEY"
          @click="handleNavClick($event, '/settings')"
        />
      </SidebarMenu>

      <SidebarSeparator />

      <AccountDropdown :mini="collapsed" />
    </SidebarFooter>

    <SidebarRail :label="t('navigation.toggle')" />
  </Sidebar>
</template>
