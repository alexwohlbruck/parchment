<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth.store'
import { useObstructingComponent } from '@/composables/useObstructingComponent'
import { capitalize } from '@/filters/text.filters'

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
import ParchmentLogo from '@/assets/parchment.svg'
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

useObstructingComponent(undefined, 'desktopNav')
const router = useRouter()
const { t } = useI18n()
const authStore = useAuthStore()
const { me } = storeToRefs(authStore)

const mini = defineModel('mini', { type: Boolean, default: true })

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
          label: mini.value
            ? t('navigation.maximize')
            : t('navigation.minimize'),
          icon: PanelLeftIcon,
          onClick: () => {
            mini.value = !mini.value
          },
        },
        {
          label: t('feedback.title'),
          icon: MessageSquareQuoteIcon,
          onClick: () => {
            window.open(
              'https://github.com/alexwohlbruck/parchment/issues',
              '_blank',
            )
          },
        },
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
  <div class="flex flex-col justify-center">
    <div
      :class="
        cn(
          'bg-background overflow-y-auto py-2 shadow-md flex flex-col gap-2',
          $attrs.class ?? '',
        )
      "
    >
      <h2 class="px-[.95rem] text-lg font-bold">
        <router-link
          to="/"
          class="flex items-center gap-3 hover:opacity-85 dark:hover:opacity-90 transition-opacity cursor-pointer"
        >
          <img
            :src="ParchmentLogo"
            alt="Parchment"
            class="w-5 h-11 scale-150"
            style="filter: drop-shadow(0 1px 0.5px rgba(0, 0, 0, 0.1))"
          />
          <transition-expand axis="x" :duration="50" easing="ease-out">
            <span v-if="!mini" class="text-nowrap text-base"> Parchment </span>
          </transition-expand>
        </router-link>
      </h2>

      <template v-for="(item, i) in items" :key="i">
        <Separator v-if="item.separator" />
        <div v-else-if="item.spacer" class="flex-1"></div>
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
                      @click="subitem.onClick"
                    >
                      <component :is="subitem.icon" class="size-5" />
                      <transition-expand
                        axis="x"
                        :duration="50"
                        easing="ease-out"
                      >
                        <div v-if="!mini" class="flex flex-1 gap-1 text-nowrap">
                          <div>
                            {{ subitem.label }}
                          </div>
                        </div>
                      </transition-expand>
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
                          ? 'bg-primary/5 text-primary'
                          : ''
                      "
                    >
                      <router-link :to="subitem.to">
                        <component :is="subitem.icon" class="size-5" />

                        <transition-expand
                          axis="x"
                          :duration="50"
                          easing="ease-out"
                        >
                          <div
                            v-if="!mini"
                            class="flex flex-1 gap-1 text-nowrap"
                          >
                            <div class="flex-1">
                              {{ subitem.label }}
                            </div>

                            <!-- <Kbd v-if="subitem.hotkey" :hotkey="subitem.hotkey"></Kbd> -->
                          </div>
                        </transition-expand>
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

      <router-link
        to="/settings/account"
        v-if="me"
        class="px-2.5 flex items-center gap-2"
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
  </div>
</template>
