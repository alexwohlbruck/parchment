<script setup lang="ts">
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card'

import LayersSelector from '@/components/navigation/LayersSelector.vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'

import Kbd from '@/components/ui/kbd/Kbd.vue'

import {
  MapIcon,
  MilestoneIcon,
  BookMarkedIcon,
  HistoryIcon,
  CloudOffIcon,
  MapPinnedIcon,
  UsersRoundIcon,
  SettingsIcon,
  Layers3Icon,
} from 'lucide-vue-next'

import { computed, ref } from 'vue'

const router = useRouter()
const { t } = useI18n()
const mini = ref(true)

const items = computed(() => {
  return [
    {
      separator: true,
    },
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
      ],
    },
    {
      separator: true,
    },
    {
      items: [
        {
          label: t('places.title'),
          icon: BookMarkedIcon,
          // hotkey: ['p'],
          to: '/place',
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
          label: t('customMaps.title'),
          // hotkey: ['c'],
          icon: MapPinnedIcon,
          to: '/custom',
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
      separator: true,
    },
    {
      items: [
        {
          label: t('settings.title'),
          icon: SettingsIcon,
          // hotkey: ['s'],
          to: '/settings',
        },
        {
          label: t('layers.title'),
          icon: Layers3Icon,
          hotkey: ['l'],
          popover: LayersSelector,
          // TODO: Fix this
          // condition: router.currentRoute.value.matched.some(
          //   (route) => route.name === "map"
          // ),
        },
      ],
    },
    {
      separator: true,
    },
  ]
})

const lockMini = ref(false)
const nav = ref(null)

function popoverOpened(open: boolean) {
  lockMini.value = open
  if (!open) {
    const mouseIsHoveringNav = (nav.value as any).matches(':hover')
    if (!mouseIsHoveringNav) {
      mini.value = true
    }
  }
}
</script>

<template>
  <div
    ref="nav"
    @mouseover="mini = lockMini ? mini : false"
    @mouseleave="mini = lockMini ? mini : true"
    :class="
      cn(
        'bg-background max-h-full overflow-y-auto m-2 py-2 shadow-md flex flex-col gap-2 rounded-md',
        $attrs.class ?? '',
      )
    "
  >
    <h2 class="px-[.95rem] text-lg font-bold">
      <span>Pa</span>
      <transition-expand axis="x" :duration="50" easing="ease-out">
        <span v-if="!mini" class="text-nowrap absolute"> rchment </span>
      </transition-expand>
    </h2>

    <div v-for="(item, i) in items" :key="i">
      <Separator v-if="item.separator" />
      <div v-else>
        <div class="flex flex-col px-1">
          <template v-for="subitem in item.items">
            <!-- v-if="subitem.to && (subitem.condition ?? true)" -->
            <Button
              v-if="subitem.to"
              variant="ghost"
              class="w-full flex px-3 justify-center gap-3"
              as-child
              :to="subitem.to"
              :class="
                router.currentRoute.value.path === subitem.to
                  ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50'
                  : ''
              "
            >
              <router-link :to="subitem.to">
                <component :is="subitem.icon" class="size-5" />

                <transition-expand axis="x" :duration="50" easing="ease-out">
                  <div v-if="!mini" class="flex flex-1 gap-1 text-nowrap">
                    <div class="flex-1">
                      {{ subitem.label }}
                    </div>

                    <!-- <Kbd v-if="subitem.hotkey" :hotkey="subitem.hotkey"></Kbd> -->
                  </div>
                </transition-expand>
              </router-link>
            </Button>

            <HoverCard
              v-if="subitem.popover"
              :openDelay="0"
              :closeDelay="0"
              @update:open="popoverOpened"
            >
              <HoverCardTrigger as-child>
                <Button to="" variant="ghost" class="w-full flex px-3 gap-3">
                  <component :is="subitem.icon" class="size-5" />

                  <transition-expand axis="x" :duration="50" easing="ease-out">
                    <div v-if="!mini" class="flex flex-1 gap-1 text-nowrap">
                      <div class="flex-1 text-start">
                        {{ subitem.label }}
                      </div>

                      <!-- <Kbd v-if="subitem.hotkey" :hotkey="subitem.hotkey"></Kbd> -->
                    </div>
                  </transition-expand>
                </Button>
              </HoverCardTrigger>

              <HoverCardContent side="right" class="fit-content w-fit">
                <component :is="subitem.popover" />
              </HoverCardContent>
            </HoverCard>
          </template>
        </div>
      </div>
    </div>

    <div class="px-2.5 flex items-center gap-2">
      <Avatar size="xs">
        <AvatarImage
          src="https://github.com/alexwohlbruck.png"
          alt="@alexwohlbruck"
        />
        <AvatarFallback>AW</AvatarFallback>
      </Avatar>

      <transition-expand axis="x" :duration="50" easing="ease-out">
        <div class="flex flex-col text-nowrap" v-if="!mini">
          <span class="text-sm font-semibold leading-4">Alex Wohlbruck</span>
          <span class="text-xs text-gray-500 leading-4">Admin</span>
        </div>
      </transition-expand>
    </div>
  </div>
</template>
