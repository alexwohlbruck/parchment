<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { cn } from '@/lib/utils'
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
import { Separator } from '@/components/ui/separator'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import Kbd from '@/components/ui/kbd/Kbd.vue'
import ParchmentLogo from '@/assets/parchment.svg?component'
import AccountDropdown from '@/components/navigation/AccountDropdown.vue'
import {
  CornerUpRightIcon,
  HistoryIcon,
  CloudOffIcon,
  UsersRoundIcon,
  SettingsIcon,
  PanelLeftIcon,
  LibraryIcon,
  MessageSquareQuoteIcon,
  SearchIcon,
  MegaphoneIcon,
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
const { t } = useI18n()
const { openExternalLink } = useExternalLink()
const mapService = useMapService()
const { isFullscreen } = useFullscreen()
const commandService = useCommandService()
const commandStore = useCommandStore()

const mini = defineModel('mini', { type: Boolean, default: true })
const navRef = ref<HTMLElement | null>(null)
const appStore = useAppStore()
const { width: windowWidth, height: windowHeight } = useWindowSize()
const paletteDialogOpen = ref(false)
const paletteDialogRef = ref<InstanceType<typeof Palette> | null>(null)

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
    handler: () => (mini.value = !mini.value),
  },
  {
    id: HotkeyId.COMMAND_PALETTE,
    key: ['mod', 'k'],
    name: t('palette.commands.search.name'),
    description: t('palette.commands.search.description'),
    handler: () => openPalette(),
  },
])

// Track navbar bounds manually for map UI area calculation
// We need to register it in the obstructing components map first
onMounted(async () => {
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

  // Register desktopNav in the obstructing components map
  // We use a dummy object since we're using manual bounds instead of component tracking
  if (!appStore.getObstructingComponent('desktopNav')) {
    appStore.trackObstructingComponentWithKey('desktopNav', {} as any)
  }

  // Update bounds when navRef is available
  if (navRef.value) {
    const rect = navRef.value.getBoundingClientRect()
    appStore.updateManualBounds('desktopNav', {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    })
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

// Watch for changes to navbar position/size
watch(
  [navRef, mini, windowWidth, windowHeight],
  () => {
    if (!navRef.value) return

    nextTick(() => {
      const rect = navRef.value!.getBoundingClientRect()
      appStore.updateManualBounds('desktopNav', {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      })
    })
  },
  { immediate: true, flush: 'post' },
)

watch(mini, () => {
  nextTick(() => {
    mapService.resize()
  })
})

interface MenuItemDefinition {
  separator?: boolean
  items?: {
    label: string
    icon: Icon
    hotkey?: Hotkey
    hotkeyId?: string
    commandId?: CommandName
    to?: string
    onClick?: () => void | Promise<void>
  }[]
  spacer?: boolean
}

function handleNavClick(to: string) {
  const isCurrentRoute = router.currentRoute.value.path.startsWith(to)
  if (appStore.leftSheetHidden) {
    // Always reopen the drawer
    appStore.leftSheetHidden = false
    // Only navigate if it's a different route
    if (!isCurrentRoute) {
      router.push(to)
    }
  } else {
    router.push(to)
  }
}

function openPalette(withSearch = false) {
  paletteDialogOpen.value = true
  if (withSearch) {
    // Active search command
    commandService.executeCommand(commandStore.getCommand(CommandName.SEARCH)!)
  }
}

// If command is executed with hotkey, open the palette
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

const items = computed<MenuItemDefinition[]>(() => [
  {
    items: [
      {
        label: t('palette.commands.search.name'),
        icon: SearchIcon,
        onClick: () => openPalette(true),
        commandId: CommandName.SEARCH,
      },
      {
        label: t('directions.title'),
        icon: CornerUpRightIcon,
        // hotkey: ['d'],
        to: '/directions',
      },
      {
        label: capitalize(t('library.title')),
        icon: LibraryIcon,
        // hotkey: ['l'],
        to: '/library',
      },
      {
        label: t('timeline.title'),
        icon: HistoryIcon,
        // hotkey: ['t'],
        to: '/timeline',
      },
      {
        label: t('offlineMaps.title'),
        // hotkey: ['o'],
        icon: CloudOffIcon,
        to: '/offline',
      },
      {
        label: t('friends.title'),
        // hotkey: ['f'],
        icon: UsersRoundIcon,
        to: '/friends',
      },
    ],
  },
  {
    spacer: true,
  },
  {
    items: [
      {
        label: mini.value ? t('navigation.maximize') : t('navigation.minimize'),
        icon: PanelLeftIcon,
        onClick: () => {
          mini.value = !mini.value
        },
        hotkeyId: HotkeyId.TOGGLE_NAV_MINI,
      },
      {
        label: t('feedback.title'),
        icon: MessageSquareQuoteIcon,
        onClick: () => {
          openExternalLink(
            'https://github.com/alexwohlbruck/parchment/issues',
            '_blank',
          )
        },
      },
      {
        label: t('settings.title'),
        icon: SettingsIcon,
        commandId: CommandName.OPEN_SETTINGS,
        to: '/settings',
      },
    ],
  },
])
</script>

<template>
  <div class="flex flex-col justify-center">
    <div
      ref="navRef"
      :class="
        cn(
          'overflow-y-auto py-1 border-border border-r flex flex-col gap-2 items-stretch relative',
          isTauri ? 'tauri-translucent' : 'bg-background',
          $attrs.class ?? '',
        )
      "
      data-tauri-drag-region
    >
      <!-- Spacer for traffic lights on macOS - draggable -->
      <!-- Hide spacer in fullscreen mode since traffic lights are hidden -->
      <div
        v-if="isTauri && !isFullscreen"
        class="h-4 w-16"
        data-tauri-drag-region
      ></div>

      <h2 v-if="!isTauri" class="px-[.95rem] text-lg font-bold">
        <router-link
          to="/"
          class="flex items-center gap-3 hover:opacity-85 dark:hover:opacity-90 transition-opacity cursor-pointer"
        >
          <ParchmentLogo
            class="w-5 h-11 scale-150 text-primary"
            aria-label="Parchment"
          />
          <span
            v-if="!mini"
            class="text-nowrap text-base text-primary-950 dark:text-primary-100"
          >
            Parchment
          </span>
        </router-link>
      </h2>

      <CommandDialog
        v-model:open="paletteDialogOpen"
        modal
        class="top-[20%] translate-y-0"
      >
        <Palette
          ref="paletteDialogRef"
          v-model:open="paletteDialogOpen"
          :show-hints="true"
        />
      </CommandDialog>

      <template v-for="(item, i) in items" :key="i">
        <Separator
          v-if="item.separator"
          class="bg-foreground/10"
          data-tauri-drag-region
        />
        <template v-else-if="item.spacer">
          <div class="flex-1" data-tauri-drag-region></div>
          <!-- Slot for custom banner alerts (above Minimize row). Default: Tauri update banner. -->
          <div class="px-1 py-0.5">
            <slot name="banner">
              <template
                v-if="
                  forceShowUpdateBanner ||
                  (isTauriDesktop && updateAvailable && !updateDismissed)
                "
              >
                <UpdateBanner
                  v-if="!mini"
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
                  :side-offset="8"
                  align="start"
                  :open-delay="200"
                  desktop-content-class="p-0 w-fit overflow-hidden rounded-md"
                >
                  <template #trigger>
                    <Button
                      variant="ghost"
                      size="icon"
                      class="w-full flex px-3 justify-center hover:bg-foreground/5 hover:text-foreground relative"
                      :aria-label="t('profileMenu.updateBanner')"
                    >
                      <span class="relative inline-flex">
                        <MegaphoneIcon class="size-5" />
                        <span
                          class="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-primary ring-2 ring-background"
                          aria-hidden
                        />
                      </span>
                    </Button>
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
        </template>
        <div v-else>
          <div class="flex flex-col px-1">
            <template v-for="subitem in item.items">
              <!-- v-if="subitem.to && (subitem.condition ?? true)" -->
              <TooltipProvider v-if="subitem.onClick" :disabled="!mini">
                <Tooltip>
                  <TooltipTrigger as-child>
                    <Button
                      variant="ghost"
                      class="w-full flex px-3 justify-center gap-3 hover:bg-primary/5 hover:text-primary"
                      @click="subitem.onClick()"
                    >
                      <component :is="subitem.icon" class="size-5" />
                      <div v-if="!mini" class="flex flex-1 gap-1 text-nowrap">
                        <div class="flex-1 text-left">
                          {{ subitem.label }}
                        </div>

                        <Kbd
                          v-if="
                            !mini &&
                            ((subitem as any).hotkey ||
                              (subitem as any).hotkeyId ||
                              (subitem as any).commandId)
                          "
                          :hotkey-id="(subitem as any).hotkeyId"
                          :hotkey="
                            (subitem as any).hotkeyId ||
                            (subitem as any).commandId
                              ? undefined
                              : (subitem as any).hotkey
                          "
                          :command-id="(subitem as any).commandId"
                        ></Kbd>
                      </div>
                    </Button>
                  </TooltipTrigger>

                  <TooltipContent
                    side="right"
                    v-if="mini"
                    class="flex items-center gap-2"
                  >
                    <span class="leading-none">{{ subitem.label }}</span>
                    <Kbd
                      v-if="
                        (subitem as any).hotkey ||
                        (subitem as any).hotkeyId ||
                        (subitem as any).commandId
                      "
                      :hotkey-id="(subitem as any).hotkeyId"
                      :hotkey="
                        (subitem as any).hotkeyId || (subitem as any).commandId
                          ? undefined
                          : (subitem as any).hotkey
                      "
                      :command-id="(subitem as any).commandId"
                    />
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <TooltipProvider v-if="subitem.to" :disabled="!mini">
                <Tooltip>
                  <TooltipTrigger as-child>
                    <Button
                      variant="ghost"
                      class="w-full flex px-3 justify-center gap-3 hover:bg-primary/5 hover:text-primary"
                      :class="
                        router.currentRoute.value.path.startsWith(subitem.to)
                          ? 'bg-primary/10 text-primary'
                          : ''
                      "
                      @click="handleNavClick(subitem.to)"
                    >
                      <component :is="subitem.icon" class="size-5" />

                      <div v-if="!mini" class="flex flex-1 gap-1 text-nowrap">
                        <div class="flex-1">
                          {{ subitem.label }}
                        </div>

                        <Kbd
                          v-if="
                            (subitem as any).hotkey ||
                            (subitem as any).commandId
                          "
                          :hotkey="(subitem as any).hotkey"
                          :command-id="(subitem as any).commandId"
                        ></Kbd>
                      </div>
                    </Button>
                  </TooltipTrigger>

                  <TooltipContent
                    side="right"
                    v-if="mini"
                    class="flex items-center gap-2"
                  >
                    <span class="leading-none -translate-y-px">{{
                      subitem.label
                    }}</span>
                    <Kbd
                      v-if="
                        (subitem as any).hotkey || (subitem as any).commandId
                      "
                      :hotkey="(subitem as any).hotkey"
                      :command-id="(subitem as any).commandId"
                    />
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </template>
          </div>
        </div>
      </template>

      <div class="px-1">
        <AccountDropdown :mini="mini" />
      </div>
    </div>
  </div>
</template>
