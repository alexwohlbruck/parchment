<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useBookmarksStore } from '@/stores/library/bookmarks.store'
import { useCollectionsStore } from '@/stores/library/collections.store'
import { Card } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { ItemIcon } from '@/components/ui/item-icon'
import {
  MapIcon,
  HistoryIcon,
  UsersRoundIcon,
  SettingsIcon,
  LibraryIcon,
  MilestoneIcon,
  BookmarkIcon,
  RouteIcon,
  MapPinIcon,
  NavigationIcon,
} from 'lucide-vue-next'
import { H4 } from '@/components/ui/typography'
import type { Bookmark } from '@/types/library.types'
import { ThemeColor } from '@/lib/utils'

const router = useRouter()
const { t } = useI18n()
const bookmarksStore = useBookmarksStore()
const collectionsStore = useCollectionsStore()

const recentBookmarks = computed(() => {
  // Sort by createdAt desc and take top 5
  return [...bookmarksStore.bookmarks]
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
    .slice(0, 5)
})

const recentCollections = computed(() => {
  return collectionsStore.collections.slice(0, 4)
})

function navigateToPlace(bookmark: Bookmark) {
  const route = bookmarksStore.navigateToBookmark(bookmark)
  if (route) {
    router.push(route)
  }
}
</script>

<template>
  <div>
    <div class="pt-1 space-y-6 pb-24">
      <!-- Navigation Grid (Bento Layout) -->
      <div class="grid grid-cols-2 gap-2">
        <!-- Library Card (Full Width) -->
        <Card
          class="col-span-2 p-4 pb-2 hover:bg-card transition-colors cursor-pointer border shadow-none"
          @click="router.push('/library')"
        >
          <div class="flex items-center gap-2 mb-2">
            <div class="p-2 bg-blue-500/10 rounded-lg">
              <LibraryIcon class="w-5 h-5 text-blue-600" />
            </div>
            <div class="flex flex-col">
              <H4 class="text-base leading-none">Library</H4>
              <span class="text-xs text-muted-foreground mt-1"
                >{{ bookmarksStore.bookmarks.length }} saved places</span
              >
            </div>
          </div>

          <div class="grid grid-cols-4 gap-2">
            <div
              class="flex flex-col items-center gap-1 p-2 rounded-md hover:bg-muted/50 transition-colors"
            >
              <div class="p-2 bg-muted rounded-full">
                <MapPinIcon class="w-4 h-4 text-foreground" />
              </div>
              <span class="text-[11px] font-medium text-muted-foreground"
                >Pinned</span
              >
            </div>
            <div
              class="flex flex-col items-center gap-1 p-2 rounded-md hover:bg-muted/50 transition-colors"
            >
              <div class="p-2 bg-muted rounded-full">
                <MapIcon class="w-4 h-4 text-foreground" />
              </div>
              <span class="text-[11px] font-medium text-muted-foreground"
                >Places</span
              >
            </div>
            <div
              class="flex flex-col items-center gap-1 p-2 rounded-md hover:bg-muted/50 transition-colors"
            >
              <div class="p-2 bg-muted rounded-full">
                <BookmarkIcon class="w-4 h-4 text-foreground" />
              </div>
              <span class="text-[11px] font-medium text-muted-foreground"
                >Guides</span
              >
            </div>
            <div
              class="flex flex-col items-center gap-1 p-2 rounded-md hover:bg-muted/50 transition-colors"
            >
              <div class="p-2 bg-muted rounded-full">
                <RouteIcon class="w-4 h-4 text-foreground" />
              </div>
              <span class="text-[11px] font-medium text-muted-foreground"
                >Routes</span
              >
            </div>
          </div>
        </Card>

        <!-- Directions -->
        <Card
          class="p-4 flex flex-col items-start justify-between gap-2 hover:bg-card transition-colors cursor-pointer border shadow-none h-32"
          @click="router.push('/directions')"
        >
          <div class="p-2.5 bg-green-500/10 rounded-full">
            <NavigationIcon class="w-5 h-5 text-green-600" />
          </div>
          <span class="font-medium text-sm">Directions</span>
        </Card>

        <!-- Timeline -->
        <Card
          class="p-4 flex flex-col items-start justify-between gap-2 hover:bg-card transition-colors cursor-pointer border shadow-none h-32"
          @click="router.push('/timeline')"
        >
          <div class="p-2.5 bg-orange-500/10 rounded-full">
            <HistoryIcon class="w-5 h-5 text-orange-600" />
          </div>
          <span class="font-medium text-sm">Timeline</span>
        </Card>

        <!-- People -->
        <Card
          class="p-4 flex flex-col items-start justify-between gap-2 hover:bg-card transition-colors cursor-pointer border shadow-none h-32"
          @click="router.push('/people')"
        >
          <div class="p-2.5 bg-purple-500/10 rounded-full">
            <UsersRoundIcon class="w-5 h-5 text-purple-600" />
          </div>
          <span class="font-medium text-sm">People</span>
        </Card>

        <!-- Settings -->
        <Card
          class="p-4 flex flex-col items-start justify-between gap-2 hover:bg-card transition-colors cursor-pointer border shadow-none h-32"
          @click="router.push('/settings')"
        >
          <div class="p-2.5 bg-gray-500/10 rounded-full">
            <SettingsIcon class="w-5 h-5 text-gray-600" />
          </div>
          <span class="font-medium text-sm">Settings</span>
        </Card>
      </div>

      <!-- Recent Places -->
      <div v-if="recentBookmarks.length > 0">
        <div class="flex items-center justify-between mb-3 px-1">
          <H4 class="text-base font-semibold">Recents</H4>
          <Button
            variant="ghost"
            size="sm"
            class="h-8 text-xs text-muted-foreground hover:text-foreground"
            @click="router.push('/library')"
          >
            See all
          </Button>
        </div>
        <div class="space-y-2">
          <Card
            v-for="place in recentBookmarks"
            :key="place.id"
            class="p-3 flex items-center gap-2 hover:bg-accent/50 transition-colors cursor-pointer border"
            @click="navigateToPlace(place)"
          >
            <ItemIcon
              :icon="place.icon || 'map-pin'"
              size="sm"
              :color="place.iconColor as ThemeColor || 'primary'"
              variant="solid"
            />
            <div class="flex-1 overflow-hidden min-w-0">
              <p class="font-medium text-sm truncate">{{ place.name }}</p>
              <p class="text-xs text-muted-foreground truncate">
                {{ place.address || 'No address' }}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              class="h-8 w-8 text-muted-foreground"
            >
              <MilestoneIcon class="w-4 h-4" />
            </Button>
          </Card>
        </div>
      </div>

      <!-- Collections / Guides -->
      <div v-if="recentCollections.length > 0">
        <div class="flex items-center justify-between mb-3 px-1">
          <H4 class="text-base font-semibold">Guides We Love</H4>
          <Button
            variant="ghost"
            size="sm"
            class="h-8 text-xs text-muted-foreground hover:text-foreground"
            @click="router.push('/library')"
          >
            See all
          </Button>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <Card
            v-for="collection in recentCollections"
            :key="collection.id"
            class="aspect-square relative overflow-hidden hover:opacity-90 transition-opacity cursor-pointer border shadow-none group"
            @click="router.push(`/library/collections/${collection.id}`)"
          >
            <div
              class="absolute inset-0 bg-muted/30 z-0 group-hover:bg-muted/50 transition-colors"
            ></div>
            <div
              class="relative z-10 h-full flex flex-col justify-end p-3 bg-gradient-to-t from-black/60 to-transparent"
            >
              <p class="font-medium text-white text-sm">
                {{ collection.name }}
              </p>
              <p class="text-[10px] text-white/80">
                {{ collection.description || 'No description' }}
              </p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  </div>
</template>
