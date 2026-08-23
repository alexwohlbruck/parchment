<script setup lang="ts">
/**
 * One style property, rendered with whatever control its type deserves.
 *
 * Two rules shape this:
 *   - An unset property shows its spec default as a placeholder rather than
 *     writing it into the layer. A style that only carries what the user
 *     actually changed is smaller, easier to read, and keeps inheriting spec
 *     defaults if they ever change.
 *   - A value that is an expression or a stop function can't be represented
 *     by a slider or a swatch, so the row says so and hands over to JSON
 *     rather than silently flattening it.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { isExpression, type StyleProperty } from '@/lib/map-style/spec'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ColorPicker } from '@/components/ui/color-picker'
import { RotateCcwIcon, BracesIcon, InfoIcon } from 'lucide-vue-next'

const props = defineProps<{
  property: StyleProperty
  value: unknown
}>()

const emit = defineEmits<{
  update: [value: unknown]
  clear: []
  editJson: []
}>()

const { t } = useI18n()

const isSet = computed(() => props.value !== undefined)
const expression = computed(() => isExpression(props.value))

const placeholder = computed(() => {
  const fallback = props.property.default
  if (fallback === undefined || fallback === null) return ''
  return Array.isArray(fallback) ? fallback.join(', ') : String(fallback)
})

/** Sliders need a concrete number even when the property is unset. */
const sliderValue = computed(() => {
  const raw = isSet.value ? props.value : props.property.default
  const number = typeof raw === 'number' ? raw : (props.property.min ?? 0)
  return [number]
})

const displayNumber = computed(() =>
  typeof props.value === 'number'
    ? props.value
    : typeof props.property.default === 'number'
      ? props.property.default
      : '',
)

const pointValue = computed<[number, number]>(() => {
  const raw = (isSet.value ? props.value : props.property.default) as unknown
  return Array.isArray(raw) ? [Number(raw[0]) || 0, Number(raw[1]) || 0] : [0, 0]
})

const listValue = computed(() => {
  const raw = props.value
  return Array.isArray(raw) ? raw.join(', ') : ''
})

function updatePoint(index: 0 | 1, next: string) {
  const pair: [number, number] = [...pointValue.value]
  pair[index] = Number(next) || 0
  emit('update', pair)
}

function updateNumbers(text: string) {
  const numbers = text
    .split(',')
    .map(part => Number(part.trim()))
    .filter(n => Number.isFinite(n))
  emit('update', numbers.length ? numbers : undefined)
}

function updateStrings(text: string) {
  const parts = text
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
  emit('update', parts.length ? parts : undefined)
}

function updateNumber(next: string | number) {
  if (next === '' || next === null) return emit('clear')
  const parsed = Number(next)
  emit('update', Number.isFinite(parsed) ? parsed : undefined)
}

/** Ranges get their value inline with the label; everything else sits beside it. */
const stacked = computed(() => props.property.control === 'range')
</script>

<template>
  <div class="group py-1.5">
    <div class="flex items-center justify-between gap-2 min-h-7">
      <div class="flex items-center gap-1.5 min-w-0">
        <span class="text-xs truncate" :title="property.key">
          {{ property.label }}
        </span>
        <span
          v-if="property.hint"
          class="shrink-0 leading-none"
          :title="property.hint"
          :aria-label="property.hint"
        >
          <InfoIcon class="size-3 text-muted-foreground/60" />
        </span>
      </div>

      <div class="flex items-center gap-1 shrink-0">
        <!-- A set value can always be reverted to the spec default. -->
        <Button
          v-if="isSet"
          variant="ghost"
          size="icon"
          class="size-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
          :title="t('layers.editor.resetProperty')"
          :aria-label="t('layers.editor.resetProperty')"
          @click="emit('clear')"
        >
          <RotateCcwIcon class="size-3" />
        </Button>

        <button
          v-if="expression"
          class="flex items-center gap-1 rounded-md border px-2 h-7 text-xs text-muted-foreground hover:bg-secondary/50"
          @click="emit('editJson')"
        >
          <BracesIcon class="size-3" />
          {{ t('layers.editor.expression') }}
        </button>

        <template v-else-if="!stacked">
          <ColorPicker with-input
            v-if="property.control === 'color'"
            :model-value="(value as string | undefined)"
            :placeholder="(property.default as string | undefined)"
            @update:model-value="v => emit('update', v)"
          />

          <Switch
            v-else-if="property.control === 'boolean'"
            :model-value="value === undefined ? property.default === true : value === true"
            @update:model-value="v => emit('update', v)"
          />

          <Select
            v-else-if="property.control === 'select'"
            :model-value="(value as string | undefined) ?? ''"
            @update:model-value="v => emit('update', v || undefined)"
          >
            <SelectTrigger class="h-7 w-36 text-xs">
              <SelectValue :placeholder="placeholder" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="option in property.options"
                :key="option"
                :value="option"
              >
                {{ option }}
              </SelectItem>
            </SelectContent>
          </Select>

          <div
            v-else-if="property.control === 'point'"
            class="flex items-center gap-1"
          >
            <Input
              type="number"
              class="h-7 w-16 text-xs no-spinner text-right"
              :model-value="pointValue[0]"
              @update:model-value="v => updatePoint(0, String(v))"
            />
            <Input
              type="number"
              class="h-7 w-16 text-xs no-spinner text-right"
              :model-value="pointValue[1]"
              @update:model-value="v => updatePoint(1, String(v))"
            />
          </div>

          <Input
            v-else-if="property.control === 'numbers'"
            class="h-7 w-36 text-xs font-mono"
            :model-value="listValue"
            :placeholder="placeholder || '2, 1'"
            @update:model-value="v => updateNumbers(String(v))"
          />

          <Input
            v-else-if="property.control === 'strings'"
            class="h-7 w-36 text-xs"
            :model-value="listValue"
            :placeholder="placeholder"
            @update:model-value="v => updateStrings(String(v))"
          />

          <Input
            v-else-if="property.control === 'number'"
            type="number"
            class="h-7 w-20 text-xs no-spinner text-right"
            :model-value="(value as number | undefined) ?? ''"
            :placeholder="placeholder"
            @update:model-value="updateNumber"
          />

          <Input
            v-else
            class="h-7 w-36 text-xs"
            :model-value="(value as string | undefined) ?? ''"
            :placeholder="placeholder"
            @update:model-value="v => emit('update', String(v) || undefined)"
          />
        </template>

        <span
          v-else
          class="text-xs tabular-nums w-14 text-right"
          :class="isSet ? 'text-foreground' : 'text-muted-foreground'"
        >
          {{ displayNumber }}{{ property.unit ?? '' }}
        </span>
      </div>
    </div>

    <Slider
      v-if="stacked && !expression"
      class="mt-1.5"
      :model-value="sliderValue"
      :min="property.min ?? 0"
      :max="property.max ?? 1"
      :step="property.step ?? 0.1"
      @update:model-value="v => emit('update', v?.[0])"
    />
  </div>
</template>
