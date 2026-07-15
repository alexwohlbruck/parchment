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
import { PRESET_TYPES, PRESET_META, type PresetType } from '@/lib/preset-places'
import { getPlaceRoute } from '@/lib/place.utils'

// Colored category chips for the "Add place" menu. ResponsiveDropdown renders
// an item's `icon` as a bare component, so wrap ItemIcon (which needs props) in
// a tiny render component per type. inheritAttrs:false keeps the menu's applied
// `size-4` class from overriding ItemIcon's own sizing.
const PRESET_ICON = Object.fromEntries(
  PRESET_TYPES.map(type => [
    type,
    markRaw({
      inheritAttrs: false,
      render: () =>
        h(ItemIcon, {
          icon: PRESET_META[type].icon,
          color: PRESET_META[type].color,
          size: 'xs',
          variant: 'ghost',
        }),
    }),
  ]),
) as unknown as Record<PresetType, Component>

const { t } = useI18n()
const router = useRouter()
const bookmarksStore = useBookmarksStore()
const bookmarksService = useBookmarksService()
const directionsService = useDirectionsService()

// On the dashboard the row lives inside the mobile sheet — minimize it before
// navigating away. Elsewhere (e.g. the collections panel) this injects the
// no-op default.
const minimizeSheet = inject<() => void>('minimizeMobileSheet', () => {})

// Home / Work / School places. A category can hold more than one, so this is a
// flat list of every tagged bookmark (labeled by its own name, with the
// category's icon).
const presetPlaces = computed(() =>
  bookmarksStore.bookmarks
    .filter(b => b.presetType)
    .map(b => ({
      bookmark: b,
      type: b.presetType as PresetType,
      meta: PRESET_META[b.presetType as PresetType],
    })),
)

// Keep the "Add place" label while the row is sparse (0–1 places); once it's
// filling up, collapse to an icon-only button to save horizontal room.
const showAddLabel = computed(() => presetPlaces.value.length <= 1)

const pickerOpen = ref(false)
const pickerType = ref<PresetType>('home')

function openPicker(type: PresetType) {
  pickerType.value = type
  pickerOpen.value = true
}

// Home / Work / School options for the "Add place" button's responsive menu.
const addMenuItems = computed<MenuItemDefinition[]>(() =>
  PRESET_TYPES.map(type => ({
    type: 'item',
    id: type,
    label: t(PRESET_META[type].labelKey),
    icon: PRESET_ICON[type],
    onSelect: () => openPicker(type),
  })),
)

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
  await bookmarksService.clearPreset(bookmark.id)
}
</script>

<template>
  <div>
    <!-- Horizontally scrolling so a long list of places stays one row -->
    <div class="flex items-stretch gap-2 overflow-x-auto scrollbar-hidden -mx-1 px-1 py-0.5">
      <Card
        v-for="entry in presetPlaces"
        :key="entry.bookmark.id"
        class="relative shrink-0 w-44 py-1.5 pl-1.5 pr-1 flex items-center gap-1.5 hover:bg-secondary/40 transition-colors cursor-pointer border shadow-none"
        @click="startDirections(entry.bookmark)"
      >
        <ItemIcon
          :icon="entry.meta.icon"
          :color="entry.meta.color"
          size="xs"
          variant="ghost"
        />
        <span class="text-xs truncate min-w-0 flex-1">{{ entry.bookmark.name }}</span>

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

    <SetPlaceDialog v-model:open="pickerOpen" :preset-type="pickerType" />
  </div>
</template>
