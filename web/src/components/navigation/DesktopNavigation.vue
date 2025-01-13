<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth.store'

import { TransitionFade } from '@morev/vue-transitions'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import Kbd from '@/components/ui/kbd/Kbd.vue'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card'
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

const router = useRouter()
const { t } = useI18n()
const authStore = useAuthStore()
const { me } = storeToRefs(authStore)

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
      ],
    },
  ]
})
</script>

<template>
  <div
    @mouseover="mini = false"
    @mouseleave="mini = true"
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
              class="w-full flex px-3 justify-center gap-3 hover:bg-primary/5 hover:text-primary"
              as-child
              :to="subitem.to"
              :class="
                router.currentRoute.value.path === subitem.to
                  ? 'bg-primary/5 text-primary'
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
          </template>
        </div>
      </div>
    </div>

    <router-link
      to="/settings/account"
      v-if="me"
      class="px-2.5 flex items-center gap-2"
    >
      <Avatar size="xs">
        <AvatarImage v-if="me.picture" :src="me.picture" alt="@alexwohlbruck" />
        <AvatarFallback v-else>
          {{ me.firstName?.charAt(0) }} {{ me.lastName?.charAt(0) }}
        </AvatarFallback>
      </Avatar>

      <transition-expand axis="x" :duration="50" easing="ease-out">
        <div class="flex flex-col text-nowrap" v-if="!mini">
          <span class="text-sm font-semibold leading-4">
            {{ me.firstName }} {{ me.lastName }}
          </span>
          <span class="text-xs text-gray-500 leading-4">{{ me.email }}</span>
        </div>
      </transition-expand>
    </router-link>
  </div>
</template>
@/stores/auth
