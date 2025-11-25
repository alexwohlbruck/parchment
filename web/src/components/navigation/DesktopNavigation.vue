<script setup lang="ts">
import { computed, ref, onMounted, watch, nextTick } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth.store'
import { useAppStore } from '@/stores/app.store'
import { capitalize } from '@/filters/text.filters'
import { isTauri } from '@/lib/api'
import { useWindowSize } from '@vueuse/core'
import { useExternalLink } from '@/composables/useExternalLink'
import { useMapService } from '@/services/map.service'

import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import Kbd from '@/components/ui/kbd/Kbd.vue'
import ParchmentLogo from '@/assets/parchment.svg?component'
import {
  MapIcon,
  MilestoneIcon,
  BookMarkedIcon,
  HistoryIcon,
  CloudOffIcon,
  MapPinnedIcon,
  UsersRoundIcon,
  SettingsIcon,
  PanelLeftIcon,
  LibraryIcon,
  MessageSquareQuoteIcon,
} from 'lucide-vue-next'
import { useHotkeys } from '@/composables/useHotkeys'
import { CommandName } from '@/stores/command.store'
import { Icon } from '@/types/app.types'
import { Hotkey } from '@/types/command.types'

const router = useRouter()
const { t } = useI18n()
const authStore = useAuthStore()
const { me } = storeToRefs(authStore)
const { openExternalLink } = useExternalLink()
const mapService = useMapService()

const mini = defineModel('mini', { type: Boolean, default: true })
const navRef = ref<HTMLElement | null>(null)
const appStore = useAppStore()
const { width: windowWidth, height: windowHeight } = useWindowSize()

useHotkeys([
  {
    id: 'toggle-nav-mini',
    key: ['meta', 's'], // Compatible with command store format
    name: t('navigation.toggle'),
    description: t('navigation.toggleDescription'),
    handler: () => (mini.value = !mini.value),
  },
])

// Track navbar bounds manually for map UI area calculation
// We need to register it in the obstructing components map first
onMounted(() => {
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
const items = computed<MenuItemDefinition[]>(() => [
  {
    items: [
      {
        label: t('map.title'),
        icon: MapIcon,
        // hotkey: ['m'],
        to: '/',
      },
      {
        label: t('directions.title'),
        icon: MilestoneIcon,
        // hotkey: ['d'],
        to: '/directions',
      },
      {
        label: capitalize(t('library.title')),
        icon: LibraryIcon,
        // hotkey: ['p'],
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
        label: t('people.title'),
        // hotkey: ['l'],
        icon: UsersRoundIcon,
        to: '/people',
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
        hotkey: ['meta', 's'],
        hotkeyId: 'toggle-nav-mini',
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
          'overflow-y-auto pt-2 pb-1 border-border border-r flex flex-col gap-2 items-stretch relative',
          isTauri ? 'tauri-translucent' : 'bg-background',
          $attrs.class ?? '',
        )
      "
      data-tauri-drag-region
    >
      <!-- Spacer for traffic lights on macOS - draggable -->
      <div v-if="isTauri" class="h-3 w-16" data-tauri-drag-region></div>

      <h2
        v-if="!isTauri"
        :class="cn('px-[.95rem] text-lg font-bold', mini ? 'ml-1.5' : 'ml-0')"
      >
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

      <template v-for="(item, i) in items" :key="i">
        <Separator
          v-if="item.separator"
          class="bg-foreground/10"
          data-tauri-drag-region
        />
        <div
          v-else-if="item.spacer"
          class="flex-1"
          data-tauri-drag-region
        ></div>
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
                          v-if="!mini && ((subitem as any).hotkey || (subitem as any).hotkeyId || (subitem as any).commandId)"
                          :hotkey-id="(subitem as any).hotkeyId"
                          :hotkey="(subitem as any).hotkeyId || (subitem as any).commandId ? undefined : (subitem as any).hotkey"
                          :command-id="(subitem as any).commandId"
                        ></Kbd>
                      </div>
                    </Button>
                  </TooltipTrigger>

                  <TooltipContent side="right" v-if="mini">
                    <p>{{ subitem.label }}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <TooltipProvider v-if="subitem.to" :disabled="!mini">
                <Tooltip>
                  <TooltipTrigger as-child>
                    <Button
                      variant="ghost"
                      class="w-full flex px-3 justify-center gap-3 hover:bg-primary/5 hover:text-primary"
                      as-child
                      :to="subitem.to"
                      :class="
                        router.currentRoute.value.path === subitem.to
                          ? 'bg-primary/10 text-primary'
                          : ''
                      "
                    >
                      <router-link :to="subitem.to">
                        <component :is="subitem.icon" class="size-5" />

                        <div v-if="!mini" class="flex flex-1 gap-1 text-nowrap">
                          <div class="flex-1">
                            {{ subitem.label }}
                          </div>

                          <Kbd
                            v-if="(subitem as any).hotkey || (subitem as any).commandId"
                            :hotkey="(subitem as any).hotkey"
                            :command-id="(subitem as any).commandId"
                          ></Kbd>
                        </div>
                      </router-link>
                    </Button>
                  </TooltipTrigger>

                  <TooltipContent side="right" v-if="mini">
                    <p>{{ subitem.label }}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </template>
          </div>
        </div>
      </template>

      <div class="px-1">
        <router-link
          to="/settings/account"
          v-if="me"
          :class="
            cn(
              'px-2.5 py-2 rounded-lg flex items-center gap-2 hover:bg-foreground/5',
              mini ? 'ml-0.5' : 'ml-0',
            )
          "
        >
          <Avatar size="xs">
            <AvatarImage
              v-if="me.picture"
              :src="me.picture"
              alt="@alexwohlbruck"
            />
            <AvatarFallback v-else>
              {{ me.firstName?.charAt(0) }} {{ me.lastName?.charAt(0) }}
            </AvatarFallback>
          </Avatar>

          <div class="flex flex-col text-nowrap" v-if="!mini">
            <span class="text-sm font-semibold leading-4">
              {{ me.firstName }} {{ me.lastName }}
            </span>
            <span class="text-xs text-gray-500 leading-4">{{ me.email }}</span>
          </div>
        </router-link>
      </div>
    </div>
  </div>
</template>
