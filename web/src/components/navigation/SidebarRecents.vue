<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useThemeStore } from '@/stores/theme.store'
import { useRecentsStore } from '@/stores/recents.store'
import { useAuthStore } from '@/stores/auth.store'
import { useAppStore } from '@/stores/app.store'
import { recentPlaceIdentity, recentSearchIdentity } from '@/lib/recents'
import { recentSubtitle } from '@/lib/recents/recent-subtitle'
import { bulletHex } from '@/lib/transit/transit-bullets'
import {
  recentPlaceToDisplay,
  recentSearchToDisplay,
} from '@/services/place/place-display'
import { useScrollFade } from '@/composables/useScrollFade'
import { SidebarMenu, SidebarMenuItem, SidebarSeparator, useSidebar } from '@/components/ui/sidebar'
import { ItemIcon } from '@/components/ui/item-icon'

const RECENTS_LIMIT = 30

const { isDark } = storeToRefs(useThemeStore())
const { collapsed } = useSidebar()
const appStore = useAppStore()
const authStore = useAuthStore()
const recentsStore = useRecentsStore()
const { places, searches } = storeToRefs(recentsStore)

const scroller = ref<HTMLElement | null>(null)
const fadeMask = useScrollFade(scroller)

watch(
  () => authStore.me?.id,
  id => {
    if (!id) return
    void recentsStore.ensurePlacesHydrated()
    void recentsStore.ensureSearchesHydrated()
  },
  { immediate: true },
)

const items = computed(() =>
  [
    ...places.value.map(place => ({
      key: recentPlaceIdentity(place),
      at: place.at,
      display: recentPlaceToDisplay(place, { isDark: isDark.value }),
      description: recentSubtitle(place.subtitle, place.at),
    })),
    ...searches.value.map(search => ({
      key: recentSearchIdentity(search),
      at: search.at,
      display: recentSearchToDisplay(search, { isDark: isDark.value }),
      description: recentSubtitle(null, search.at),
    })),
  ]
    .filter(item => item.display.route)
    .sort((a, b) => b.at - a.at)
    .slice(0, RECENTS_LIMIT),
)
</script>

<template>
  <template v-if="items.length">
    <SidebarSeparator class="-mx-2 -my-1.5" />
    <div
      ref="scroller"
      :style="fadeMask"
      class="flex-1 min-h-0 -mx-2 px-2 overflow-y-auto overflow-x-hidden"
    >
      <SidebarMenu>
        <SidebarMenuItem
          v-for="{ key, display, description } in items"
          :key="key"
          :label="display.title"
          :description="description"
          :to="display.route!"
          @click="appStore.leftSheetHidden = false"
        >
          <template #icon>
            <ItemIcon
              :icon="display.icon"
              :icon-pack="display.iconPack"
              :color="display.color"
              :custom-color="display.bullet ? `#${bulletHex(display.bullet.color)}` : display.customColor"
              :image-url="display.imageUrl ?? undefined"
              size="sm"
              variant="solid"
              shape="circle"
              class="transition-[width,height] duration-200"
              :class="collapsed ? '!size-6' : '!size-7'"
            />
          </template>
        </SidebarMenuItem>
      </SidebarMenu>
    </div>
  </template>
</template>
