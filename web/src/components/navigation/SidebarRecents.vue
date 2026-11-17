<script setup lang="ts">
import { computed, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useDark } from '@vueuse/core'
import { useRecentsStore } from '@/stores/recents.store'
import { useAuthStore } from '@/stores/auth.store'
import { useAppStore } from '@/stores/app.store'
import { recentPlaceIdentity, recentSearchIdentity } from '@/lib/recents'
import {
  recentPlaceToDisplay,
  recentSearchToDisplay,
} from '@/services/place/place-display'
import { SidebarMenu, SidebarMenuItem, SidebarSeparator } from '@/components/ui/sidebar'
import { ItemIcon } from '@/components/ui/item-icon'
import { bulletHex } from '@/lib/transit/transit-bullets'

const RECENTS_LIMIT = 12

const isDark = useDark()
const appStore = useAppStore()
const authStore = useAuthStore()
const recentsStore = useRecentsStore()
const { places, searches } = storeToRefs(recentsStore)

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
    })),
    ...searches.value.map(search => ({
      key: recentSearchIdentity(search),
      at: search.at,
      display: recentSearchToDisplay(search, { isDark: isDark.value }),
    })),
  ]
    .filter(item => item.display.route)
    .sort((a, b) => b.at - a.at)
    .slice(0, RECENTS_LIMIT),
)
</script>

<template>
  <template v-if="items.length">
    <SidebarSeparator />
    <SidebarMenu>
      <SidebarMenuItem
        v-for="{ key, display } in items"
        :key="key"
        :label="display.title"
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
            size="xs"
            variant="solid"
            shape="circle"
            class="!size-5"
          />
        </template>
      </SidebarMenuItem>
    </SidebarMenu>
  </template>
</template>
