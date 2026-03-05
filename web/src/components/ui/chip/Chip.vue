<script setup lang="ts">
import { computed, type Component } from 'vue'
import { Button } from '@/components/ui/button'
import { Toggle } from '@/components/ui/toggle'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ChevronDownIcon, Check } from 'lucide-vue-next'
import { cn } from '@/lib/utils'

export interface ChipOption {
  label: string
  value: string | number | boolean
  disabled?: boolean
  icon?: Component
}

const CLEAR_VALUE = '__clear__'

const {
  dropdownValue,
  multiple = false,
  label,
  variant = 'button',
  size = 'xs',
  disabled = false,
  options,
  clearLabel = 'Clear',
  forceIcon = false,
  icon,
  modelValue,
  customContent = false,
  showClear = true,
  showActionButton = false,
  actionIcon,
  actionLabel,
  class: className
} = defineProps<{
  icon?: Component
  label: string
  variant?: 'button' | 'toggle' | 'dropdown'
  size?: 'xs' | 'sm' | 'default' | 'lg'
  disabled?: boolean
  // For toggle variant
  modelValue?: boolean
  // For dropdown variant
  dropdownValue?: string | number | boolean | Array<string | number | boolean>
  options?: ChipOption[]
  multiple?: boolean
  customContent?: boolean
  showClear?: boolean
  clearLabel?: string
  forceIcon?: boolean // Force using the original icon instead of selected option icon
  // For embedded action button
  showActionButton?: boolean
  actionIcon?: Component
  actionLabel?: string
  class?: string
}>()

const emit = defineEmits<{
  click: []
  'update:modelValue': [value: boolean]
  'update:dropdownValue': [
    value: string | number | boolean | Array<string | number | boolean>,
  ]
  'action-click': []
}>()

const chipClasses = computed(() => {
  return cn('rounded-full gap-1 bg-background pl-2.5', className)
})

const isPressed = computed(() => {
  return variant === 'toggle' ? modelValue : false
})

const selectedOption = computed(() => {
  if (variant !== 'dropdown' || !options) return null

  if (multiple) {
    // For multiple selection, don't change the label
    return null
  }

  return options.find(
    option => String(option.value) === String(dropdownValue),
  )
})

const displayLabel = computed(() => {
  if (selectedOption.value && variant === 'dropdown' && !multiple) {
    return selectedOption.value.label
  }
  return label
})

const displayIcon = computed(() => {
  if (forceIcon) {
    return icon
  }
  if (
    selectedOption.value?.icon &&
    variant === 'dropdown' &&
    !multiple
  ) {
    return selectedOption.value.icon
  }
  return icon
})

function handleClick() {
  if (variant === 'button') {
    emit('click')
  } else if (variant === 'toggle') {
    emit('update:modelValue', !modelValue)
  }
}

function handleActionClick(event: Event) {
  event.stopPropagation()
  emit('action-click')
}

function handleDropdownItemClick(value: string | number | boolean) {
  if (String(value) === CLEAR_VALUE) {
    // Handle clear action
    if (multiple) {
      emit('update:dropdownValue', [])
    } else {
      emit('update:dropdownValue', '')
    }
    return
  }

  if (multiple) {
    const currentValues = Array.isArray(dropdownValue)
      ? dropdownValue
      : []
    const newValues = currentValues.includes(value)
      ? currentValues.filter(v => v !== value)
      : [...currentValues, value]
    emit('update:dropdownValue', newValues)
  } else {
    emit('update:dropdownValue', value)
  }
}

function isSelected(value: string | number | boolean): boolean {
  if (multiple) {
    return (
      Array.isArray(dropdownValue) && dropdownValue.includes(value)
    )
  }
  return dropdownValue === value
}

function getDropdownItemComponent(): Component {
  if (multiple) {
    return DropdownMenuCheckboxItem as Component
  }
  return DropdownMenuItem as Component
}
</script>

<template>
  <!-- Regular Button Chip -->
  <Button
    v-if="variant === 'button'"
    variant="outline"
    :size="size"
    :class="cn(chipClasses, 'whitespace-nowrap')"
    :disabled="disabled"
    @click="handleClick"
  >
    <component v-if="displayIcon" :is="displayIcon" class="size-3.5" />
    <span class="whitespace-nowrap">{{ displayLabel }}</span>
  </Button>

  <!-- Toggle Button Chip -->
  <Toggle
    v-else-if="variant === 'toggle'"
    variant="outline"
    :size="size"
    :class="cn(chipClasses, 'whitespace-nowrap')"
    :disabled="disabled"
    :pressed="isPressed"
    @click="handleClick"
  >
    <component v-if="displayIcon" :is="displayIcon" class="size-3.5" />
    <span class="whitespace-nowrap">{{ displayLabel }}</span>
  </Toggle>

  <!-- Dropdown/Select Chip -->
  <template v-else-if="variant === 'dropdown'">
    <!-- Multi-select: Use DropdownMenu with checkboxes -->
    <DropdownMenu v-if="multiple">
      <DropdownMenuTrigger as-child>
        <Button
          variant="outline"
          :size="size"
          :class="cn(chipClasses, 'whitespace-nowrap')"
          :disabled="disabled"
        >
          <component v-if="displayIcon" :is="displayIcon" class="size-3.5" />
          <span class="whitespace-nowrap">{{ displayLabel }}</span>
          <ChevronDownIcon class="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" class="min-w-32">
        <!-- Custom Content Slot -->
        <slot v-if="customContent" name="dropdown-content" />

        <!-- Multiple Selection with Checkboxes -->
        <template v-else-if="options && options.length > 0">
          <!-- Clear option for multi-select -->
          <DropdownMenuCheckboxItem
            v-if="
              showClear &&
              Array.isArray(dropdownValue) &&
              dropdownValue.length > 0
            "
            :key="CLEAR_VALUE"
            :checked="false"
            @select="(e: Event) => { e.preventDefault(); handleDropdownItemClick(CLEAR_VALUE) }"
          >
            <div class="flex items-center gap-2">
              <span class="text-muted-foreground italic">{{ clearLabel }}</span>
            </div>
          </DropdownMenuCheckboxItem>

          <DropdownMenuCheckboxItem
            v-for="option in options"
            :key="String(option.value)"
            :checked="isSelected(option.value)"
            :disabled="option.disabled"
            @select="(e: Event) => { e.preventDefault(); handleDropdownItemClick(option.value) }"
          >
            <div class="flex items-center gap-2">
              <component
                v-if="option.icon"
                :is="option.icon as any"
                class="size-4 text-muted-foreground"
              />
              <span :class="option.icon ? '' : 'pl-0'">{{ option.label }}</span>
            </div>
          </DropdownMenuCheckboxItem>
        </template>
      </DropdownMenuContent>
    </DropdownMenu>

    <!-- Single-select: Use Select component -->
    <Select
      v-else
      :model-value="String(dropdownValue || '')"
      @update:model-value="(value) => handleDropdownItemClick(String(value || ''))"
    >
      <SelectTrigger
        :class="cn(chipClasses, 'whitespace-nowrap h-8 w-auto')"
        :disabled="disabled"
      >
        <div class="flex items-center gap-1">
          <component v-if="displayIcon" :is="displayIcon" class="size-3.5" />
          <span class="whitespace-nowrap">{{ displayLabel }}</span>

          <!-- Action Button -->
          <button
            v-if="showActionButton"
            type="button"
            class="ml-1 p-0.5 hover:bg-muted rounded-sm transition-colors"
            :title="actionLabel"
            @click="handleActionClick"
          >
            <component v-if="actionIcon" :is="actionIcon" class="size-3" />
          </button>
        </div>
      </SelectTrigger>
      <SelectContent>
        <!-- Custom Content Slot -->
        <slot v-if="customContent" name="dropdown-content" />

        <!-- Single Selection Options -->
        <template v-else-if="options && options.length > 0">
          <!-- Clear option for single-select -->
          <SelectItem
            v-if="showClear && dropdownValue && String(dropdownValue) !== ''"
            :key="CLEAR_VALUE"
            :value="CLEAR_VALUE"
          >
            <div class="flex items-center gap-2">
              <span class="text-muted-foreground italic">{{ clearLabel }}</span>
            </div>
          </SelectItem>

          <SelectItem
            v-for="option in options"
            :key="String(option.value)"
            :value="String(option.value)"
            :disabled="option.disabled"
          >
            <div class="flex items-center gap-2">
              <component
                v-if="option.icon"
                :is="option.icon as any"
                class="size-4 text-muted-foreground"
              />
              <span :class="option.icon ? '' : 'pl-0'">{{ option.label }}</span>
            </div>
          </SelectItem>
        </template>
      </SelectContent>
    </Select>
  </template>
</template>
