<script setup lang="ts">
import { computed, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useBookmarksStore } from '@/stores/library/bookmarks.store'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ItemIcon } from '@/components/ui/item-icon'
import BookmarkCard from '@/components/library/BookmarkCard.vue'
import { H4 } from '@/components/ui/typography'
import { AppRoute } from '@/router'
import type { ThemeColor } from '@/lib/utils'
import { capitalize } from '@/filters/text.filters'

const router = useRouter()
const { t } = useI18n()
const bookmarksStore = useBookmarksStore()

// Inject minimize function from MobileNavigation
const minimizeSheet = inject<() => void>('minimizeMobileSheet', () => {})

const recentBookmarks = computed(() => {
  return [...bookmarksStore.bookmarks]
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
    .slice(0, 5)
})

const libraryTabs = computed(() => [
  {
    id: 'collections',
    icon: 'FolderOpen',
    color: 'blue' as ThemeColor,
    route: AppRoute.LIBRARY_COLLECTIONS,
    label: capitalize(t('library.entities.collections.title.plural')),
  },
  {
    id: 'routes',
    icon: 'Route',
    color: 'green' as ThemeColor,
    route: AppRoute.LIBRARY_ROUTES,
    label: capitalize(t('library.entities.routes.title.plural')),
  },
  {
    id: 'layers',
    icon: 'Layers3',
    color: 'orange' as ThemeColor,
    route: AppRoute.LIBRARY_LAYERS,
    label: capitalize(t('library.entities.layers.title.plural')),
  },
  {
    id: 'maps',
    icon: 'Map',
    color: 'violet' as ThemeColor,
    route: AppRoute.LIBRARY_MAPS,
    label: capitalize(t('library.entities.maps.title.plural')),
  },
])

function navigateTo(path: string) {
  console.log('navigateTo', path)
  minimizeSheet()
  router.push(path)
}

function navigateToRoute(routeName: AppRoute) {
  console.log('navigateToRoute', routeName)
  minimizeSheet()
  router.push({ name: routeName })
}
</script>

<template>
  <div class="flex flex-col h-full pt-2">
    <div class="pt-1 space-y-4 flex-1">
      <!-- Library Section -->
      <div>
        <H4
          class="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 px-1"
          >{{ t('library.title') }}</H4
        >
        <div class="grid grid-cols-2 gap-2">
          <Card
            v-for="tab in libraryTabs"
            :key="tab.id"
            class="p-3 flex flex-col items-start justify-between gap-1 hover:bg-card transition-colors cursor-pointer border shadow-none h-24"
            @click="navigateToRoute(tab.route)"
          >
            <ItemIcon
              :icon="tab.icon"
              :color="tab.color"
              size="sm"
              variant="ghost"
            />
            <span class="font-medium text-sm">{{ tab.label }}</span>
          </Card>
        </div>
      </div>

      <!-- Navigation Section -->
      <div>
        <H4
          class="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 px-1"
          >{{ t('navigation.title') }}</H4
        >
        <div class="grid grid-cols-2 gap-2">
          <!-- Directions -->
          <Card
            class="p-3 flex flex-col items-start justify-between gap-1 hover:bg-card transition-colors cursor-pointer border shadow-none h-24"
            @click="navigateTo('/directions')"
          >
            <ItemIcon
              icon="Navigation"
              color="green"
              size="sm"
              variant="ghost"
            />
            <span class="font-medium text-sm">{{ t('directions.title') }}</span>
          </Card>

          <!-- Friends -->
          <Card
            class="p-3 flex flex-col items-start justify-between gap-1 hover:bg-card transition-colors cursor-pointer border shadow-none h-24"
            @click="navigateTo('/friends')"
          >
            <ItemIcon
              icon="UsersRound"
              color="violet"
              size="sm"
              variant="ghost"
            />
            <span class="font-medium text-sm">{{ t('friends.title') }}</span>
          </Card>

          <!-- Settings -->
          <Card
            class="p-3 flex flex-col items-start justify-between gap-1 hover:bg-card transition-colors cursor-pointer border shadow-none h-24"
            @click="navigateTo('/settings')"
          >
            <ItemIcon icon="Settings" color="gray" size="sm" variant="ghost" />
            <span class="font-medium text-sm">{{ t('settings.title') }}</span>
          </Card>
        </div>
      </div>

      <!-- Recent Places -->
      <div v-if="recentBookmarks.length > 0">
        <div class="flex items-center justify-between mb-2 px-1">
          <H4
            class="text-xs font-semibold text-muted-foreground uppercase tracking-wide"
            >{{ t('general.recents') }}</H4
          >
          <Button
            variant="ghost"
            size="sm"
            class="h-7 text-xs text-muted-foreground hover:text-foreground"
            @click="navigateTo('/library')"
          >
            {{ t('general.seeAll') }}
          </Button>
        </div>
        <div class="space-y-1">
          <BookmarkCard
            v-for="bookmark in recentBookmarks"
            :key="bookmark.id"
            :bookmark="bookmark"
            @click="minimizeSheet"
          />
        </div>
      </div>
    </div>

  </div>
</template>
