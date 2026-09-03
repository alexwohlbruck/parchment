<script setup lang="ts">
/**
 * How a data layer draws.
 *
 * The same features can reasonably be dots, a heatmap of those dots, or the
 * shapes they enclose, so the renderer is a setting rather than something
 * fixed when the file landed. Switching it resets the styling to that mode's
 * defaults — a 30px heatmap radius is nonsense as a circle radius.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import ResponsiveDialog from '@/components/responsive/ResponsiveDialog.vue'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Button } from '@/components/ui/button'
import { ITEM_ROW_SURFACES } from '@/components/ui/item-row'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { IconPicker } from '@/components/ui/icon-picker'
import { DATA_RENDERS, defaultStyleFor } from '@/lib/map-style/data-presets'
import { collectPropertyNames } from '@/lib/geo-import'
import type { CanvasDataLayer, CanvasDataRender } from '@/types/canvas.types'
import {
  CircleDotIcon,
  FlameIcon,
  PentagonIcon,
  SplineIcon,
} from 'lucide-vue-next'

const open = defineModel<boolean>('open', { required: true })

const props = defineProps<{ layer: CanvasDataLayer | null }>()

const emit = defineEmits<{ update: [patch: Partial<CanvasDataLayer>] }>()

const { t } = useI18n()

const RENDER_ICONS: Record<CanvasDataRender, typeof CircleDotIcon> = {
  points: CircleDotIcon,
  lines: SplineIcon,
  shapes: PentagonIcon,
  heatmap: FlameIcon,
}

const name = ref('')
watch(
  () => [open.value, props.layer?.id] as const,
  () => {
    if (open.value) name.value = props.layer?.name ?? ''
  },
  { immediate: true },
)

const style = computed(() => ({
  ...defaultStyleFor(props.layer?.render ?? 'points'),
  ...props.layer?.style,
}))

/** Only point data can carry labels, and only from properties it actually has. */
const labelOptions = computed(() =>
  props.layer ? collectPropertyNames(props.layer.data) : [],
)
const supportsLabels = computed(() => props.layer?.render === 'points')

/** Bounds that make sense for the knob the current mode uses. */
const sizeRange = computed(() =>
  props.layer?.render === 'heatmap'
    ? { min: 5, max: 100, step: 1 }
    : { min: 1, max: 24, step: 0.5 },
)

function setRender(render: CanvasDataRender) {
  if (render === props.layer?.render) return
  emit('update', { render, style: defaultStyleFor(render) })
}

function patchStyle(patch: Partial<CanvasDataLayer['style']>) {
  emit('update', { style: { ...style.value, ...patch } })
}

function commitName() {
  const trimmed = name.value.trim()
  if (trimmed && trimmed !== props.layer?.name) emit('update', { name: trimmed })
}

const featureCount = computed(() => props.layer?.data?.features?.length ?? 0)
</script>

<template>
  <ResponsiveDialog
    v-model:open="open"
    :title="t('canvases.dataSettings.title')"
    :description="
      layer?.origin?.filename ??
      t('canvases.layers.featureCount', featureCount)
    "
  >
    <template #content>
      <div v-if="layer" class="space-y-4">
        <Input v-model="name" class="h-9" @blur="commitName" @keydown.enter="commitName" />

        <div class="space-y-2">
          <Label class="text-xs text-muted-foreground">
            {{ t('canvases.dataSettings.render') }}
          </Label>
          <div class="grid grid-cols-4 gap-1">
            <button
              v-for="render in DATA_RENDERS"
              :key="render"
              :class="[
                ITEM_ROW_SURFACES.tile,
                'flex flex-col items-center justify-center gap-1 px-1.5 py-2 transition-colors',
                render === layer.render
                  ? 'bg-secondary text-foreground ring-1 ring-inset ring-primary/50'
                  : 'text-muted-foreground hover:bg-secondary/40',
              ]"
              @click="setRender(render)"
            >
              <component :is="RENDER_ICONS[render]" class="size-4" />
              <span class="text-[11px] leading-tight">
                {{ t(`canvases.layers.renders.${render}`) }}
              </span>
            </button>
          </div>
        </div>

        <div class="flex items-center justify-between gap-2">
          <Label class="text-sm">{{ t('canvases.dataSettings.color') }}</Label>
          <IconPicker
            compact
            color-only
            allow-custom-color
            :model-value="{ icon: '', color: style.color ?? 'compass' }"
            @update:model-value="v => patchStyle({ color: v.color })"
          />
        </div>

        <div class="space-y-1.5">
          <div class="flex items-center justify-between">
            <Label class="text-sm">
              {{ t(`canvases.dataSettings.size.${layer.render}`) }}
            </Label>
            <span class="text-xs tabular-nums text-muted-foreground">
              {{ style.size }}px
            </span>
          </div>
          <Slider
            :model-value="[style.size ?? 6]"
            :min="sizeRange.min"
            :max="sizeRange.max"
            :step="sizeRange.step"
            @update:model-value="v => patchStyle({ size: v?.[0] })"
          />
        </div>

        <div class="space-y-1.5">
          <div class="flex items-center justify-between">
            <Label class="text-sm">{{ t('canvases.dataSettings.opacity') }}</Label>
            <span class="text-xs tabular-nums text-muted-foreground">
              {{ style.opacity }}
            </span>
          </div>
          <Slider
            :model-value="[style.opacity ?? 0.9]"
            :min="0"
            :max="1"
            :step="0.05"
            @update:model-value="v => patchStyle({ opacity: v?.[0] })"
          />
        </div>

        <div v-if="supportsLabels && labelOptions.length" class="space-y-1.5">
          <Label class="text-xs text-muted-foreground">
            {{ t('canvases.dataSettings.label') }}
          </Label>
          <Select
            :model-value="style.labelProperty ?? '__none__'"
            @update:model-value="
              v => patchStyle({ labelProperty: v === '__none__' ? null : String(v) })
            "
          >
            <SelectTrigger class="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">{{ t('general.none') }}</SelectItem>
              <SelectItem
                v-for="property in labelOptions"
                :key="property"
                :value="property"
              >
                {{ property }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button variant="outline" class="w-full" @click="open = false">
          {{ t('general.done') }}
        </Button>
      </div>
    </template>
  </ResponsiveDialog>
</template>
