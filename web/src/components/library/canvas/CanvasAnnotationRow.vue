<script setup lang="ts">
/**
 * One annotation in the canvas panel, expanding into its own properties.
 *
 * Marks are made fast and named later — often much later — so everything
 * about one stays editable: what it's called, what colour it is, and for a
 * pin, the glyph inside it. Editing happens in place rather than in a dialog,
 * because you are looking at the map while you do it.
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { IconPicker } from '@/components/ui/icon-picker'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ChevronRightIcon,
  CircleIcon,
  CrosshairIcon,
  MapPinIcon,
  MinusIcon,
  PentagonIcon,
  SquareIcon,
  TimerIcon,
  Trash2Icon,
  WaypointsIcon,
} from 'lucide-vue-next'
import {
  annotationMeasurement,
  annotationMetrics,
  DEFAULT_ANNOTATION_COLOR,
  DEFAULT_LABEL_POSITION,
} from '@/lib/canvas-annotations'
import { themeColorToHex } from '@/lib/utils'
import {
  ANNOTATION_LABEL_POSITIONS,
  type AnnotationLabelPosition,
  type AnnotationTool,
  type CanvasAnnotation,
} from '@/types/canvas.types'
import { useMeasureUnits } from '@/composables/useMeasureUnits'

const props = defineProps<{
  annotation: CanvasAnnotation
  expanded?: boolean
}>()

const emit = defineEmits<{
  update: [patch: Partial<CanvasAnnotation>]
  remove: []
  toggleExpanded: []
  zoomTo: []
}>()

const { t } = useI18n()

const TOOL_ICONS: Record<AnnotationTool, typeof MapPinIcon> = {
  pin: MapPinIcon,
  line: MinusIcon,
  route: WaypointsIcon,
  polygon: PentagonIcon,
  rectangle: SquareIcon,
  circle: CircleIcon,
  isochrone: TimerIcon,
}

const color = computed(
  () => props.annotation.color ?? DEFAULT_ANNOTATION_COLOR,
)
/** The swatch has to paint a real colour, not the name of one. */
const swatch = computed(() => themeColorToHex(color.value))

const labelPosition = computed(
  () => props.annotation.labelPosition ?? DEFAULT_LABEL_POSITION,
)

const labelPositions = computed(() =>
  ANNOTATION_LABEL_POSITIONS.map(position => ({
    value: position,
    label: t(`canvases.annotations.positions.${position}`),
  })),
)

const { formatDistance, formatArea } = useMeasureUnits(
  computed(() => !!props.expanded),
)

/**
 * How long or how large the mark is. A drawn shape almost always has a
 * question behind it — how far is that, how big is this — and the answer is
 * already implied by the geometry.
 */
function formatMetric(metric: { kind: 'length' | 'area'; value: number }) {
  return metric.kind === 'area'
    ? formatArea(metric.value)
    : formatDistance(metric.value)
}

/** The headline number, for the collapsed row where there is room for one. */
const measurement = computed(() => {
  const measure = annotationMeasurement(props.annotation)
  return measure ? formatMetric(measure) : null
})

/** Everything the measure tool could say about it, for the open row. */
const metrics = computed(() =>
  annotationMetrics(props.annotation)
    .map(metric => ({
      key: metric.key,
      label: t(`canvases.annotations.metrics.${metric.key}`),
      value: formatMetric(metric),
    }))
    .filter(metric => metric.value),
)

const label = ref(props.annotation.label ?? '')
const labelInput = ref<InstanceType<typeof Input> | null>(null)

/**
 * A mark that has just been made is almost always about to be named, so the
 * field takes focus the moment its row opens — the same reflex Felt has when
 * it drops a pin. Selecting existing text means a rename is one keystroke.
 */
watch(
  () => props.expanded,
  async expanded => {
    if (!expanded) return
    label.value = props.annotation.label ?? ''
    await nextTick()
    const el = (labelInput.value?.$el ?? labelInput.value) as
      | HTMLInputElement
      | undefined
    el?.focus?.()
    el?.select?.()
  },
  { immediate: true },
)

function commitLabel() {
  const next = label.value.trim()
  if (next !== (props.annotation.label ?? '')) {
    emit('update', { label: next || undefined })
  }
}

const fallbackName = computed(() =>
  t(`canvases.toolbar.tools.${props.annotation.tool}`),
)
</script>

<template>
  <div class="rounded-lg border bg-card overflow-hidden">
    <div class="flex items-center gap-2 px-2 py-1.5">
      <button
        class="flex items-center gap-2 min-w-0 flex-1 text-left"
        :aria-expanded="expanded"
        @click="emit('toggleExpanded')"
      >
        <ChevronRightIcon
          class="size-3 shrink-0 text-muted-foreground transition-transform duration-150"
          :class="expanded && 'rotate-90'"
        />
        <span
          class="size-4 shrink-0 rounded-full flex items-center justify-center"
          :style="{ background: swatch }"
        >
          <component
            :is="TOOL_ICONS[annotation.tool]"
            class="size-2.5 text-white"
          />
        </span>
        <span class="min-w-0 flex-1">
          <span class="block text-sm truncate">
            {{ annotation.label || fallbackName }}
          </span>
          <!-- What the mark is, and how big — the question behind drawing it. -->
          <span
            v-if="annotation.routed || measurement"
            class="block text-[11px] text-muted-foreground truncate"
          >
            <template v-if="annotation.routed">
              {{ t(`directions.modes.${annotation.routed.mode}`) }}
            </template>
            <template v-if="annotation.routed && measurement"> · </template>
            <template v-if="measurement">{{ measurement }}</template>
          </span>
        </span>
      </button>

      <Button
        variant="ghost"
        size="icon"
        class="size-7 shrink-0"
        :title="t('canvases.annotations.zoomTo')"
        :aria-label="t('canvases.annotations.zoomTo')"
        @click="emit('zoomTo')"
      >
        <CrosshairIcon class="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        class="size-7 shrink-0"
        :title="t('canvases.annotations.remove')"
        :aria-label="t('canvases.annotations.remove')"
        @click="emit('remove')"
      >
        <Trash2Icon class="size-3.5" />
      </Button>
    </div>

    <!-- Properties read down the left and are set down the right, the way
         every other inspector in the app does. -->
    <div v-if="expanded" class="border-t px-3 py-1.5">
      <div class="flex items-center justify-between gap-3 py-1.5 min-h-7">
        <span class="text-xs shrink-0">
          {{ t('canvases.annotations.name') }}
        </span>
        <Input
          ref="labelInput"
          v-model="label"
          class="h-7 w-40 text-xs"
          :placeholder="t('canvases.annotations.labelPlaceholder')"
          @blur="commitLabel"
          @keydown.enter="commitLabel"
        />
      </div>

      <!-- What the shape measures, the way the measure tool would put it. -->
      <div
        v-for="metric in metrics"
        :key="metric.key"
        class="flex items-center justify-between gap-3 py-1.5 min-h-7"
      >
        <span class="text-xs shrink-0 text-muted-foreground">
          {{ metric.label }}
        </span>
        <span class="text-xs tabular-nums">{{ metric.value }}</span>
      </div>

      <div class="flex items-center justify-between gap-3 py-1.5 min-h-7">
        <span class="text-xs shrink-0">
          {{ t('canvases.annotations.color') }}
        </span>
        <IconPicker
          compact
          color-only
          allow-custom-color
          :model-value="{
            icon: '',
            color: annotation.color ?? DEFAULT_ANNOTATION_COLOR,
          }"
          @update:model-value="v => emit('update', { color: v.color })"
        />
      </div>

      <!-- Only a pin has room for a glyph; the rest are outlines. -->
      <div
        v-if="annotation.tool === 'pin'"
        class="flex items-center justify-between gap-3 py-1.5 min-h-7"
      >
        <span class="text-xs shrink-0">
          {{ t('canvases.annotations.icon') }}
        </span>
        <IconPicker
          compact
          :model-value="{
            icon: annotation.icon ?? 'MapPinIcon',
            color: 'cobalt',
          }"
          @update:model-value="v => emit('update', { icon: v.icon })"
        />
      </div>

      <!-- Naming a mark and printing that name on the map are different
           decisions, so where it goes only appears once it goes anywhere. -->
      <div
        v-if="annotation.label"
        class="flex items-center justify-between gap-3 py-1.5 min-h-7"
      >
        <span class="text-xs shrink-0">
          {{ t('canvases.annotations.showLabel') }}
        </span>
        <Switch
          :model-value="annotation.labelVisible !== false"
          @update:model-value="v => emit('update', { labelVisible: v })"
        />
      </div>

      <div
        v-if="annotation.label && annotation.labelVisible !== false"
        class="flex items-center justify-between gap-3 py-1.5 min-h-7"
      >
        <span class="text-xs shrink-0">
          {{ t('canvases.annotations.labelPosition') }}
        </span>
        <Select
          :model-value="labelPosition"
          @update:model-value="
            v => emit('update', { labelPosition: v as AnnotationLabelPosition })
          "
        >
          <SelectTrigger class="h-7 w-36 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              v-for="position in labelPositions"
              :key="position.value"
              :value="position.value"
              class="text-xs"
            >
              {{ position.label }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  </div>
</template>
