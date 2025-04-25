<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import * as LucideIcons from 'lucide-vue-next'

const props = defineProps<{
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const isOpen = ref(false)
const searchQuery = ref('')

// Extract all icon components from Lucide
const iconComponents = computed(() => {
  return Object.entries(LucideIcons)
    .filter(([name]) => name.endsWith('Icon') && name !== 'createLucideIcon')
    .map(([name, component]) => ({
      name: name.replace('Icon', ''), // Remove the "Icon" suffix
      component,
    }))
})

// Filter icons based on search query
const filteredIcons = computed(() => {
  if (!searchQuery.value) {
    return iconComponents.value
  }

  const query = searchQuery.value.toLowerCase()
  return iconComponents.value.filter(icon =>
    icon.name.toLowerCase().includes(query),
  )
})

// Get the currently selected icon component
const selectedIcon = computed(() => {
  const iconName = props.modelValue + 'Icon'
  return (
    LucideIcons[iconName as keyof typeof LucideIcons] ||
    LucideIcons.HelpCircleIcon
  )
})

// Select an icon
function selectIcon(iconName: string) {
  emit('update:modelValue', iconName)
  isOpen.value = false
  searchQuery.value = ''
}

// Clear the search when popover closes
watch(isOpen, newValue => {
  if (!newValue) {
    searchQuery.value = ''
  }
})
</script>

<template>
  <Popover v-model:open="isOpen">
    <PopoverTrigger as-child>
      <Button
        variant="outline"
        class="flex items-center gap-2 w-full justify-between"
      >
        <div class="flex items-center gap-2">
          <component :is="selectedIcon" class="size-5" />
          <span>{{ modelValue }}</span>
        </div>
        <span class="text-xs text-muted-foreground">(Change)</span>
      </Button>
    </PopoverTrigger>
    <PopoverContent class="w-80 p-0" align="start">
      <div class="p-3 border-b">
        <Input
          v-model="searchQuery"
          placeholder="Search icons..."
          class="w-full"
          autofocus
        />
      </div>
      <ScrollArea class="h-80">
        <div class="grid grid-cols-5 gap-2 p-3">
          <Button
            v-for="icon in filteredIcons"
            :key="icon.name"
            variant="ghost"
            size="icon"
            class="flex flex-col items-center justify-center gap-1 h-16 w-full"
            @click="selectIcon(icon.name)"
          >
            <component :is="icon.component" class="size-6" />
            <span class="text-xs text-center truncate w-full">{{
              icon.name
            }}</span>
          </Button>
        </div>
      </ScrollArea>
    </PopoverContent>
  </Popover>
</template>
