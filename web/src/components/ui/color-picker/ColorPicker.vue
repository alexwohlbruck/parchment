<script setup lang="ts">
/**
 * The colour picker, wherever something can be recoloured.
 *
 * One component for pins, collections, layer styling and canvas marks, over
 * one palette — picking "teal" should mean the same teal everywhere, and it
 * used to mean whatever each call site had hard-coded. Custom colours stay
 * possible because map styling needs values a palette can't hold: an exact
 * brand colour, an `rgba()` with alpha, the `transparent` several halo
 * properties default to.
 *
 * The value is either one of our colour names or a CSS colour. Callers that
 * need a real colour to hand to the map run it through `themeColorToHex`,
 * which passes CSS values straight through.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { CheckIcon, PipetteIcon } from 'lucide-vue-next'
import { THEME_COLORS, isThemeColor, themeColorToHex } from '@/lib/utils'

const props = withDefaults(
  defineProps<{
    modelValue?: string
    /** Shown when nothing is set — a style property's own default. */
    placeholder?: string
    /** Off where only the palette makes sense, such as a saved place's icon. */
    allowCustom?: boolean
    /** The authoritative text field, for style values a swatch can't express. */
    withInput?: boolean
    disabled?: boolean
  }>(),
  { allowCustom: true, withInput: false, disabled: false },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const { t } = useI18n()
const open = ref(false)

const current = computed(() => props.modelValue ?? props.placeholder ?? '')

/** What the swatch actually paints — a name resolved, a CSS value as given. */
const resolved = computed(() =>
  current.value ? themeColorToHex(current.value, 'transparent') : 'transparent',
)

const isTransparent = computed(() =>
  /^(transparent|rgba\([^)]*,\s*0\s*\))$/i.test(current.value),
)

/** `<input type="color">` only speaks `#rrggbb`; anything else falls back. */
const nativeValue = computed(() =>
  /^#[0-9a-f]{6}$/i.test(resolved.value) ? resolved.value : '#000000',
)

const custom = ref(current.value)
watch(
  () => props.modelValue,
  value => (custom.value = value ?? ''),
)

function choose(color: string) {
  emit('update:modelValue', color)
  open.value = false
}
</script>

<template>
  <div class="flex items-center gap-1.5">
    <Popover v-model:open="open">
      <PopoverTrigger as-child>
        <button
          type="button"
          :disabled="disabled"
          class="relative size-7 shrink-0 rounded-md border overflow-hidden transition-shadow hover:ring-2 hover:ring-foreground/15 disabled:opacity-50 disabled:cursor-not-allowed"
          :class="
            isTransparent &&
            'bg-[repeating-conic-gradient(theme(colors.muted)_0_25%,transparent_0_50%)] bg-[length:8px_8px]'
          "
          :aria-label="t('colorPicker.label')"
        >
          <span class="absolute inset-0" :style="{ background: resolved }" />
        </button>
      </PopoverTrigger>

      <PopoverContent class="w-56 p-2.5" align="start">
        <div class="grid grid-cols-6 gap-1.5">
          <button
            v-for="color in THEME_COLORS"
            :key="color"
            type="button"
            class="relative size-7 rounded-full transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40"
            :style="{ background: themeColorToHex(color) }"
            :title="t(`colors.${color}`)"
            :aria-label="t(`colors.${color}`)"
            @click="choose(color)"
          >
            <CheckIcon
              v-if="modelValue === color"
              class="absolute inset-0 m-auto size-3.5 text-white drop-shadow"
            />
          </button>
        </div>

        <template v-if="allowCustom">
          <div class="mt-2.5 flex items-center gap-1.5 border-t pt-2.5">
            <div
              class="relative size-7 shrink-0 rounded-md border overflow-hidden"
            >
              <span
                class="absolute inset-0"
                :style="{ background: custom || 'transparent' }"
              />
              <input
                type="color"
                :value="nativeValue"
                class="absolute inset-0 cursor-pointer opacity-0"
                :aria-label="t('colorPicker.custom')"
                @input="
                  choose(($event.target as HTMLInputElement).value)
                "
              />
            </div>
            <Input
              v-model="custom"
              class="h-7 flex-1 font-mono text-xs"
              :placeholder="placeholder ?? '#000000'"
              @keydown.enter="choose(custom)"
            />
            <Button
              variant="ghost"
              size="icon"
              class="size-7 shrink-0"
              :title="t('colorPicker.apply')"
              :aria-label="t('colorPicker.apply')"
              @click="choose(custom)"
            >
              <PipetteIcon class="size-3.5" />
            </Button>
          </div>
        </template>
      </PopoverContent>
    </Popover>

    <!-- Style properties allow values no swatch can show; the text stays
         authoritative for those. -->
    <Input
      v-if="withInput"
      :model-value="modelValue ?? ''"
      :placeholder="placeholder"
      class="h-7 w-24 font-mono text-xs"
      @update:model-value="value => emit('update:modelValue', String(value))"
    />
  </div>
</template>
