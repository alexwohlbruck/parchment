<script setup lang="ts">
import { computed, ref } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PaletteIcon, SearchIcon, CheckIcon, FileIcon } from 'lucide-vue-next'
import * as LucideIcons from 'lucide-vue-next'
import { Icon } from 'lucide-vue-next'
import type { LucideIcon } from 'lucide-vue-next'
import { fuzzyFilter, getThemeColorClasses, type ThemeColor } from '@/lib/utils'
import { ItemIcon } from '@/components/ui/item-icon'
import { useI18n } from 'vue-i18n'

interface ModelValue {
  icon: string
  color: ThemeColor
}

interface IconItem {
  name: string
  component: LucideIcon
}

const props = defineProps<{
  modelValue: ModelValue
  placeholder?: string
}>()

const { t } = useI18n()

const emit = defineEmits(['update:modelValue'])

const showPopover = ref(false)
const activeTab = ref('icon')
const iconSearch = ref('')

const iconComponents = computed<IconItem[]>(() => {
  return Object.entries(LucideIcons)
    .filter(
      ([key]) =>
        key.endsWith('Icon') &&
        key !== 'Icon' &&
        key !== 'icons' &&
        key !== 'createLucideIcon',
    )
    .map(([key, component]) => {
      const name = key.replace(/Icon$/, '')
      return { name, component: component as LucideIcon }
    })
})

const filteredIconComponents = computed(() => {
  if (!iconSearch.value) return iconComponents.value

  return fuzzyFilter(iconComponents.value, iconSearch.value, {
    keys: ['name'], // Search the name property
    threshold: -10000,
  })
})

// Available theme colors
const themeColors: ThemeColor[] = [
  'blue',
  'green',
  'red',
  'orange',
  'yellow',
  'violet',
  'rose',
  'zinc',
  'slate',
  'stone',
  'gray',
  'neutral',
]

// Handler functions
function handleIconSelect(iconName: string) {
  emit('update:modelValue', {
    ...props.modelValue,
    icon: iconName,
  })
}

function handleColorSelect(color: ThemeColor) {
  emit('update:modelValue', {
    ...props.modelValue,
    color,
  })
}
</script>

<template>
  <Popover v-model:open="showPopover">
    <PopoverTrigger as-child>
      <Button
        variant="outline"
        class="p-4 flex items-center justify-center"
        size="icon-xl"
      >
        <ItemIcon :icon="modelValue.icon" :color="modelValue.color" size="md" />
      </Button>
    </PopoverTrigger>
    <PopoverContent class="w-72 p-0">
      <!-- Tabs for icon and color selection -->
      <Tabs v-model="activeTab" class="w-full">
        <TabsList class="grid grid-cols-2 mb-2 px-2">
          <TabsTrigger value="icon">Icon</TabsTrigger>
          <TabsTrigger value="color">Color</TabsTrigger>
        </TabsList>

        <!-- Icon selection tab -->
        <TabsContent value="icon" class="p-2 pt-0">
          <!-- Search input -->
          <div class="relative mb-2">
            <SearchIcon
              class="absolute left-2.5 top-3 size-4 text-muted-foreground"
            />
            <Input
              v-model="iconSearch"
              :placeholder="placeholder || t('general.search')"
              class="pl-8"
            />
          </div>

          <!-- Icons grid -->
          <div class="max-h-[16rem] overflow-y-auto grid grid-cols-5 gap-1 p-1">
            <Button
              v-for="(icon, i) in filteredIconComponents"
              :key="icon.name"
              variant="ghost"
              size="icon"
              class="relative p-0"
              :class="
                modelValue.icon === icon.name
                  ? 'bg-primary/20 ring-2 ring-primary'
                  : ''
              "
              @click="handleIconSelect(icon.name)"
            >
              <div class="absolute inset-0 grid place-items-center">
                <component :is="icon.component" class="size-6" />
              </div>
            </Button>
          </div>
        </TabsContent>

        <!-- Color selection tab -->
        <TabsContent value="color" class="p-2 pt-0">
          <div class="grid grid-cols-5 gap-1">
            <Button
              v-for="color in themeColors"
              :key="color"
              variant="ghost"
              size="icon"
              class="size-10 relative"
              :class="
                modelValue.color === color
                  ? 'bg-primary/20 ring-2 ring-primary'
                  : ''
              "
              @click="handleColorSelect(color)"
            >
              <div
                class="size-6 rounded"
                :class="getThemeColorClasses(color)"
              ></div>
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </PopoverContent>
  </Popover>
</template>
