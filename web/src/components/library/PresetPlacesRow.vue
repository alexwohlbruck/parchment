<script setup lang="ts">
import { computed, inject, ref, markRaw, h, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { LngLat } from 'mapbox-gl'
import {
  MoreVerticalIcon,
  NavigationIcon,
  Trash2Icon,
  PlusIcon,
  MapPinIcon,
} from 'lucide-vue-next'
import { useBookmarksStore } from '@/stores/library/bookmarks.store'
import { useBookmarksService } from '@/services/library/bookmarks.service'
import { useDirectionsService } from '@/services/directions.service'
import { Card } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ItemIcon } from '@/components/ui/item-icon'
import { AppRoute } from '@/router'
import type { Bookmark } from '@/types/library.types'
import type { Place } from '@/types/place.types'
import SetPlaceDialog from '@/components/dashboard/SetPlaceDialog.vue'
import ResponsiveDropdown, {
  type MenuItemDefinition,
} from '@/components/responsive/ResponsiveDropdown.vue'
import {
  FREQUENT_TYPES,
  FREQUENT_META,
  frequentChipMeta,
  CUSTOM_FREQUENT_ICON,
  CUSTOM_FREQUENT_LABEL_KEY,
  type FrequentType,
} from '@/lib/frequents'
import { getPlaceRoute } from '@/lib/place.utils'

// Colored icon chips for the "Set as frequent" menu. ResponsiveDropdown renders
// an item's `icon` as a bare component, so wrap ItemIcon (which needs props) in
// a tiny render component per type. inheritAttrs:false keeps the menu's applied
// `size-4` class from overriding ItemIcon's own sizing.
const MENU_ICON = Object.fromEntries(
  ([...FREQUENT_TYPES, 'custom'] as FrequentType[]).map(type => [
    type,
    markRaw({
      inheritAttrs: false,
      render: () =>
        h(ItemIcon, {
          icon: type === 'custom' ? CUSTOM_FREQUENT_ICON : FREQUENT_META[type].icon,
          color: type === 'custom' ? 'parchment' : FREQUENT_META[type].color,
          size: 'xs',
          variant: 'ghost',
        }),
    }),
  ]),
) as unknown as Record<FrequentType, Component>

const { t } = useI18n()
const router = useRouter()
const bookmarksStore = useBookmarksStore()
const bookmarksService = useBookmarksService()
const directionsService = useDirectionsService()

// On the dashboard the row lives inside the mobile sheet — minimize it before
// navigating away. Elsewhere (e.g. the collections panel) this injects the
// no-op default.
const minimizeSheet = inject<() => void>('minimizeMobileSheet', () => {})

// Every frequent bookmark, resolved to its chip display: canonical types show
// their fixed label ("Home") over the address; a custom frequent shows its own
// name over the address.
const frequentPlaces = computed(() =>
  bookmarksStore.bookmarks
    .filter(b => b.frequentType)
    .map(b => {
      const meta = frequentChipMeta(b)
      const isCanonical = !!meta.labelKey
      return {
        bookmark: b,
        title: isCanonical ? t(meta.labelKey as string) : meta.title ?? b.name,
        secondary: isCanonical ? b.address || b.name : b.address || '',
        icon: meta.icon,
        iconPack: meta.iconPack,
        color: meta.color,
      }
    }),
)

// Keep the label while the row is sparse (0–1 places); once it's filling up,
// collapse to an icon-only button to save horizontal room.
const showAddLabel = computed(() => frequentPlaces.value.length <= 1)

const pickerOpen = ref(false)
const pickerType = ref<FrequentType>('home')

function openPicker(type: FrequentType) {
  pickerType.value = type
  pickerOpen.value = true
}

// Home / Work / School / Custom options for the "Set as frequent" menu.
const addMenuItems = computed<MenuItemDefinition[]>(() => [
  ...FREQUENT_TYPES.map(type => ({
    type: 'item' as const,
    id: type,
    label: t(FREQUENT_META[type].labelKey),
    icon: MENU_ICON[type],
    onSelect: () => openPicker(type),
  })),
  {
    type: 'item' as const,
    id: 'custom',
    label: t(CUSTOM_FREQUENT_LABEL_KEY),
    icon: MENU_ICON.custom,
    onSelect: () => openPicker('custom'),
  },
])

/** Minimal Place built from a bookmark, enough to seed a directions waypoint. */
function bookmarkToPlace(bookmark: Bookmark): Place {
  return {
    id: bookmark.id,
    name: { value: bookmark.name },
    geometry: {
      value: {
        type: 'point',
        center: { lat: bookmark.lat, lng: bookmark.lng },
      },
    },
    externalIds: bookmark.externalIds,
    address: bookmark.address
      ? { value: { formatted: bookmark.address } }
      : null,
    placeType: { value: 'bookmark' },
  } as unknown as Place
}

function startDirections(bookmark: Bookmark) {
  directionsService.directionsTo({
    lngLat: new LngLat(bookmark.lng, bookmark.lat),
    place: bookmarkToPlace(bookmark),
  })
  minimizeSheet()
  router.push({ name: AppRoute.DIRECTIONS })
}

function openBookmark(bookmark: Bookmark) {
  const ids = bookmark.externalIds as Record<string, string>
  const [key, value] = ids.osm
    ? ['osm', ids.osm]
    : ids.coords
      ? ['coords', ids.coords]
      : [Object.keys(ids)[0], Object.values(ids)[0]]
  if (!key || !value) return
  const route = getPlaceRoute(`${key}/${value}`)
  if (route) {
    minimizeSheet()
    router.push(route)
  }
}

async function removePreset(bookmark: Bookmark) {
  await bookmarksService.clearFrequent(bookmark.id)
}
</script>

<template>
  <div>
    <!-- Horizontally scrolling so a long list of places stays one row -->
    <div class="flex items-stretch gap-2 overflow-x-auto scrollbar-hidden -mx-1 px-1 py-0.5">
      <Card
        v-for="entry in frequentPlaces"
        :key="entry.bookmark.id"
        class="relative shrink-0 w-44 py-1.5 pl-1.5 pr-1 flex items-center gap-1.5 hover:bg-secondary/40 transition-colors cursor-pointer border shadow-none"
        @click="startDirections(entry.bookmark)"
      >
        <ItemIcon
          :icon="entry.icon"
          :icon-pack="entry.iconPack"
          :color="entry.color"
          size="xs"
          variant="ghost"
        />
        <div class="min-w-0 flex-1 flex flex-col leading-tight">
          <span class="text-xs font-medium truncate">{{ entry.title }}</span>
          <span
            v-if="entry.secondary"
            class="text-[10px] text-muted-foreground truncate"
          >
            {{ entry.secondary }}
          </span>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger as-child @click.stop>
            <button
              class="shrink-0 size-5 rounded-md flex items-center justify-center text-muted-foreground hover:bg-secondary/70 hover:text-foreground transition-colors"
              :aria-label="t('general.more')"
            >
              <MoreVerticalIcon class="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-44">
            <DropdownMenuItem @click="startDirections(entry.bookmark)">
              <NavigationIcon class="size-4 mr-2" />
              {{ t('directions.directions') }}
            </DropdownMenuItem>
            <DropdownMenuItem @click="openBookmark(entry.bookmark)">
              <MapPinIcon class="size-4 mr-2" />
              {{ t('general.open') }}
            </DropdownMenuItem>
            <DropdownMenuItem class="text-destructive" @click="removePreset(entry.bookmark)">
              <Trash2Icon class="size-4 mr-2" />
              {{ t('general.remove') }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Card>

      <!-- Add: pick a category first — dropdown on desktop, sheet on mobile -->
      <ResponsiveDropdown
        align="start"
        content-class="w-44"
        :items="addMenuItems"
        :title="t('dashboard.yourPlaces.add')"
      >
        <template #trigger="{ open }">
          <button
            type="button"
            class="shrink-0 self-stretch rounded-xl border border-dashed flex items-center justify-center gap-1.5 text-muted-foreground hover:bg-secondary/30 hover:text-foreground transition-colors"
            :class="showAddLabel ? 'px-3' : 'w-9'"
            :aria-label="t('dashboard.yourPlaces.add')"
            :title="t('dashboard.yourPlaces.add')"
            @click="open"
          >
            <PlusIcon class="size-4" />
            <span v-if="showAddLabel" class="text-xs whitespace-nowrap">
              {{ t('dashboard.yourPlaces.add') }}
            </span>
          </button>
        </template>
      </ResponsiveDropdown>
    </div>

    <SetPlaceDialog v-model:open="pickerOpen" :frequent-type="pickerType" />
  </div>
</template>
