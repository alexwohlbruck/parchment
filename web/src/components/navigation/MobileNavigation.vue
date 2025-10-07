<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useObstructingComponent } from '@/composables/useObstructingComponent'
import { Card } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import Palette from '@/components/palette/Palette.vue'
import { capitalize } from '@/filters/text.filters'
import BottomSheet from '@/components/BottomSheet.vue'
import {
  MapIcon,
  HistoryIcon,
  UsersRoundIcon,
  SettingsIcon,
  LibraryIcon,
  MilestoneIcon,
} from 'lucide-vue-next'

// useObstructingComponent(undefined, 'mobileNav')
const { t } = useI18n()
const router = useRouter()
const route = useRoute()
const activeSnapPoint = ref<number | string | null>(null)
const paletteRef = ref<InstanceType<typeof Palette>>()
const currentPath = computed(() => route.path)
const routeModel = computed({
  get: () => currentPath.value,
  set: newValue => {
    router.push(newValue)
  },
})

const isFullyExpanded = computed(() => activeSnapPoint.value === 1)

const items = computed(() => {
  return [
    {
      label: t('directions.title'),
      icon: MilestoneIcon,
      to: '/directions',
    },
    {
      label: capitalize(t('library.title')),
      icon: LibraryIcon,
      to: '/library',
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

function handlePaletteInputFocused() {
  console.log('handlePaletteInputFocused')
  activeSnapPoint.value = 1 // Fully expand the drawer
}

watch(isFullyExpanded, (newVal) => {
  if (!newVal) {
    paletteRef.value?.resetPalette()
  }
})

</script>

<template>
   <BottomSheet
     peek-height="125px"
     open
     disableSwipeClose
     v-model:active-snap-point="activeSnapPoint"
     class="absolute bg-background z-50 top-0 left-0 w-full md:w-104 h-full rounded-t-md shadow-lg justify-center"
   >
    <Card
      class="flex flex-col h-full gap-2 p-2 bg-muted shadow-md rounded-b-none border-0 pb-[min(calc(env(safe-area-inset-bottom)-.25rem), 1rem)]"
    >
      <div class="relative">
        <Palette ref="paletteRef" @input-focused="handlePaletteInputFocused" />
      </div>

      <Tabs v-if="!isFullyExpanded" v-model="routeModel" default-value="/" class="w-full">
        <TabsList class="w-full h-16 px-0">
          <TabsTrigger
            v-for="(item, i) in items"
            class="flex-1 h-full flex-col gap-1"
            :value="item.to"
          >
            <component :is="item.icon" class="size-5" />
            <p class="text-xs">{{ item.label }}</p>
          </TabsTrigger>
        </TabsList>
      </Tabs>
      
      <p>Content here</p>
    </Card>
  </BottomSheet>
  
</template>
