<script setup lang="ts">
import { ref, computed } from 'vue'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getThemeColorClasses, type ThemeColor } from '@/lib/utils'

const props = defineProps<{
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const isOpen = ref(false)
const colorInput = ref(props.modelValue)

// Get the theme color classes for the selected color
const selectedColorClasses = computed(() => {
  return getThemeColorClasses(props.modelValue as ThemeColor)
})

// Predefined color options. Aligned with `themeColors` in IconPicker —
// kept in sync because both end up persisted as the same `iconColor`
// field on collections / bookmarks.
const colorOptions: ThemeColor[] = [
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'rose',
  'slate',
  'neutral',
]

function selectColor(color: ThemeColor) {
  emit('update:modelValue', color)
  isOpen.value = false
}

function updateColor() {
  emit('update:modelValue', colorInput.value)
  isOpen.value = false
}

// Function to get class for each color option
function getColorOptionClasses(color: ThemeColor) {
  return getThemeColorClasses(color)
}

// Function to check if a color is selected
function isColorSelected(color: ThemeColor) {
  return props.modelValue === color
}
</script>

<template>
  <Popover v-model:open="isOpen">
    <PopoverTrigger as-child>
      <Button
        variant="outline"
        class="flex items-center gap-2 w-full justify-between"
      >
        <div class="flex items-center gap-2">
          <div class="w-5 h-5 rounded-full" :class="selectedColorClasses"></div>
          <span class="capitalize">{{ modelValue }}</span>
        </div>
        <span class="text-xs text-muted-foreground">(Change)</span>
      </Button>
    </PopoverTrigger>
    <PopoverContent class="w-72" align="start">
      <div class="grid grid-cols-4 gap-2 mb-3">
        <Button
          v-for="color in colorOptions"
          :key="color"
          variant="outline"
          size="icon"
          class="w-10 h-10 rounded-full p-0 flex items-center justify-center"
          :class="[
            getColorOptionClasses(color),
            isColorSelected(color) ? 'ring-2 ring-primary ring-offset-2' : '',
          ]"
          @click="selectColor(color)"
        ></Button>
      </div>
      <div class="flex gap-2">
        <Input
          v-model="colorInput"
          type="text"
          placeholder="#000000"
          class="flex-1"
        />
        <Button variant="outline" @click="updateColor"> Apply </Button>
      </div>
    </PopoverContent>
  </Popover>
</template>
