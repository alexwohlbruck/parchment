<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Card } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import Palette from '@/components/palette/Palette.vue'

import {
  MapIcon,
  BookMarkedIcon,
  HistoryIcon,
  UsersRoundIcon,
  SettingsIcon,
} from 'lucide-vue-next'

const { t } = useI18n()
const router = useRouter()
const route = useRoute()
const currentPath = computed(() => route.path)
const routeModel = computed({
  get: () => currentPath.value,
  set: newValue => {
    router.push(newValue)
  },
})

const items = computed(() => {
  return [
    {
      label: t('map.title'),
      icon: MapIcon,
      to: '/',
    },
    {
      label: t('places.title'),
      icon: BookMarkedIcon,
      to: '/place',
    },
    {
      label: t('timeline.title'),
      icon: HistoryIcon,
      to: '/timeline',
    },
    {
      label: t('people.title'),
      icon: UsersRoundIcon,
      to: '/people',
    },
    {
      label: t('settings.title'),
      icon: SettingsIcon,
      to: '/settings',
    },
  ]
})
</script>

<template>
  <div class="p-2 gap-1 absolute bottom-0 z-10 w-full">
    <Card class="bg-muted shadow-md">
      <div class="pt-1 px-1 relative z-11">
        <Palette />
      </div>
      <Tabs v-model="routeModel" default-value="/" class="w-full">
        <TabsList class="w-full h-16">
          <TabsTrigger
            v-for="(item, i) in items"
            class="flex-1 h-full flex-col gap-1"
            :value="item.to"
          >
            <component :is="item.icon" class="size-5" />
            <P class="text-xs">{{ item.label }}</P>
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </Card>
  </div>
</template>
