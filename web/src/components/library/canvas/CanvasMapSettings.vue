<script setup lang="ts">
/**
 * A canvas's own map appearance.
 *
 * The same switches as the app's map configuration, because they are the
 * same settings — a canvas just gets to answer them differently. Off, the
 * canvas follows whatever you have set everywhere else; on, it takes its own
 * copy of your current answers and keeps them.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  Building2Icon,
  DoorOpenIcon,
  InfoIcon,
  MapPinIcon,
  MountainSnowIcon,
  RouteIcon,
  SignpostIcon,
  TrainFrontIcon,
} from 'lucide-vue-next'
import type { CanvasMapSettings } from '@/types/canvas.types'

const props = defineProps<{ modelValue?: CanvasMapSettings }>()
const emit = defineEmits<{
  'update:modelValue': [value: CanvasMapSettings | undefined]
  /** Asked for the app's current answers, to start a canvas's own set from. */
  adopt: []
}>()

const { t } = useI18n()

const ROWS: {
  key: keyof CanvasMapSettings
  icon: typeof Building2Icon
  label: string
}[] = [
  { key: 'objects3d', icon: Building2Icon, label: '3dObjects' },
  { key: 'terrain3d', icon: MountainSnowIcon, label: '3dTerrain' },
  { key: 'hdRoads', icon: RouteIcon, label: 'hdRoads' },
  { key: 'indoorMaps', icon: DoorOpenIcon, label: 'indoorMaps' },
  { key: 'poiLabels', icon: InfoIcon, label: 'poiLabels' },
  { key: 'roadLabels', icon: SignpostIcon, label: 'roadLabels' },
  { key: 'transitLabels', icon: TrainFrontIcon, label: 'transitLabels' },
  { key: 'placeLabels', icon: MapPinIcon, label: 'placeLabels' },
]

const overriding = computed(() => !!props.modelValue)

function setOverriding(on: boolean) {
  if (on) emit('adopt')
  else emit('update:modelValue', undefined)
}

function set(key: keyof CanvasMapSettings, value: boolean) {
  if (!props.modelValue) return
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}
</script>

<template>
  <div class="space-y-2">
    <div class="flex items-center justify-between gap-3 py-1.5 min-h-7">
      <Label class="text-xs">
        {{ t('canvases.mapSettings.override') }}
      </Label>
      <Switch :model-value="overriding" @update:model-value="setOverriding" />
    </div>

    <p v-if="!overriding" class="text-xs text-muted-foreground">
      {{ t('canvases.mapSettings.followingApp') }}
    </p>

    <div v-else class="rounded-md border bg-muted/30 px-2.5 py-1">
      <div
        v-for="row in ROWS"
        :key="row.key"
        class="flex items-center justify-between gap-3 py-1.5 min-h-7"
      >
        <span class="flex items-center gap-2 min-w-0">
          <component :is="row.icon" class="size-3.5 shrink-0 text-muted-foreground" />
          <span class="text-xs truncate">
            {{ t(`settings.mapSettings.configuration.${row.label}`) }}
          </span>
        </span>
        <Switch
          :model-value="modelValue![row.key]"
          @update:model-value="v => set(row.key, v)"
        />
      </div>
    </div>
  </div>
</template>
