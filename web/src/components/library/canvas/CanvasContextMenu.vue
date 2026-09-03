<script setup lang="ts">
/**
 * Everything you can do to a canvas as a whole, from the header of the canvas
 * you have open — the counterpart to the collection menu on a collection.
 *
 * Its map appearance lives here too rather than in a control of its own. The
 * switches are set once while a canvas is being composed and never touched
 * again, so they belong behind the same overflow the rename and the delete
 * are behind, not taking up header width beside them.
 */
import { computed, markRaw } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import ResponsiveDropdown, {
  type MenuItemDefinition,
} from '@/components/responsive/ResponsiveDropdown.vue'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { useMapStore } from '@/stores/map.store'
import { useAppService } from '@/services/app.service'
import { useCanvasesService } from '@/services/library/canvases.service'
import { currentMapSettings } from '@/composables/useCanvasMapSettings'
import { MapEngine } from '@/types/map.types'
import {
  Building2Icon,
  DoorOpenIcon,
  InfoIcon,
  MapPinIcon,
  MoreVerticalIcon,
  MountainSnowIcon,
  PencilIcon,
  RouteIcon,
  SignpostIcon,
  SlidersHorizontalIcon,
  TrainFrontIcon,
  Trash2Icon,
} from 'lucide-vue-next'
import type { Canvas, CanvasMapSettings } from '@/types/canvas.types'

const props = defineProps<{
  canvas: Canvas
  /** Absent means the canvas follows whatever the app is set to. */
  mapSettings?: CanvasMapSettings
}>()

const emit = defineEmits<{
  'update:mapSettings': [value: CanvasMapSettings | undefined]
  edit: []
  deleted: []
}>()

const { t } = useI18n()
const mapStore = useMapStore()
const appService = useAppService()
const canvasesService = useCanvasesService()
const { settings } = storeToRefs(mapStore)

/** Terrain, HD roads and indoor maps are Mapbox features; MapLibre has no
 *  answer to give, so a canvas can't override what isn't there. */
const ROWS: {
  key: keyof CanvasMapSettings
  icon: typeof Building2Icon
  label: string
  mapboxOnly?: boolean
}[] = [
  { key: 'objects3d', icon: Building2Icon, label: '3dObjects' },
  { key: 'terrain3d', icon: MountainSnowIcon, label: '3dTerrain', mapboxOnly: true },
  { key: 'hdRoads', icon: RouteIcon, label: 'hdRoads', mapboxOnly: true },
  { key: 'indoorMaps', icon: DoorOpenIcon, label: 'indoorMaps', mapboxOnly: true },
  { key: 'poiLabels', icon: InfoIcon, label: 'poiLabels' },
  { key: 'roadLabels', icon: SignpostIcon, label: 'roadLabels' },
  { key: 'transitLabels', icon: TrainFrontIcon, label: 'transitLabels' },
  { key: 'placeLabels', icon: MapPinIcon, label: 'placeLabels' },
]

const rows = computed(() =>
  ROWS.filter(
    row => !row.mapboxOnly || settings.value.engine === MapEngine.MAPBOX,
  ),
)

const overriding = computed(() => !!props.mapSettings)

/** Off, the switches report what the app is set to rather than going blank. */
function valueOf(key: keyof CanvasMapSettings) {
  return props.mapSettings?.[key] ?? settings.value[key]
}

function setOverriding(on: boolean) {
  emit('update:mapSettings', on ? currentMapSettings() : undefined)
}

function set(key: keyof CanvasMapSettings, value: boolean) {
  if (!props.mapSettings) return
  emit('update:mapSettings', { ...props.mapSettings, [key]: value })
}

async function remove() {
  const confirmed = await appService.confirm({
    title: t('canvases.delete.title'),
    description: t('canvases.delete.description', {
      name: canvasesService.displayName(props.canvas),
    }),
    continueText: t('general.delete'),
    cancelText: t('general.cancel'),
    destructive: true,
  })
  if (!confirmed) return
  if (await canvasesService.deleteCanvas(props.canvas.id)) emit('deleted')
}

/**
 * The appearance rows keep the menu open — a canvas's look is judged against
 * the map behind it, and closing after every switch would mean reopening the
 * menu eight times to dress one canvas.
 */
const appearanceItems = computed<MenuItemDefinition[]>(() => [
  {
    type: 'item',
    id: 'override',
    label: t('canvases.mapSettings.override'),
    keepOpen: true,
    trailing: markRaw(Switch),
    trailingProps: {
      modelValue: overriding.value,
      'onUpdate:modelValue': setOverriding,
    },
    onSelect: () => setOverriding(!overriding.value),
  },
  { type: 'separator' },
  // Shown while the canvas has no set of its own, so you can see what it
  // would take over, but not movable until it does.
  ...rows.value.map(row => ({
    type: 'item' as const,
    id: row.key,
    label: t(`settings.mapSettings.configuration.${row.label}`),
    icon: markRaw(row.icon),
    disabled: !overriding.value,
    keepOpen: true,
    trailing: markRaw(Switch),
    trailingProps: {
      modelValue: valueOf(row.key),
      disabled: !overriding.value,
      'onUpdate:modelValue': (value: boolean) => set(row.key, value),
    },
    onSelect: () => set(row.key, !valueOf(row.key)),
  })),
])

const menuItems = computed<MenuItemDefinition[]>(() => [
  {
    type: 'submenu',
    id: 'appearance',
    label: t('canvases.mapSettings.title'),
    icon: markRaw(SlidersHorizontalIcon),
    active: overriding.value,
    items: appearanceItems.value,
  },
  { type: 'separator' },
  {
    type: 'item',
    id: 'edit',
    label: t('canvases.dialog.editTitle'),
    icon: markRaw(PencilIcon),
    onSelect: () => emit('edit'),
  },
  {
    type: 'item',
    id: 'delete',
    label: t('general.delete'),
    icon: markRaw(Trash2Icon),
    variant: 'destructive',
    onSelect: remove,
  },
])
</script>

<template>
  <ResponsiveDropdown align="end" :items="menuItems">
    <template #trigger="{ open }">
      <Button variant="ghost" size="icon" class="size-8" @click.stop="open">
        <MoreVerticalIcon class="size-4" />
      </Button>
    </template>
  </ResponsiveDropdown>
</template>
