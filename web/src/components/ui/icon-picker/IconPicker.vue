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
import { SearchIcon } from 'lucide-vue-next'
import * as LucideIcons from 'lucide-vue-next'
import type { LucideIcon } from 'lucide-vue-next'
import lucideTags from 'lucide-static/tags.json'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { fuzzyFilter, getThemeColorClasses, type ThemeColor } from '@/lib/utils'
import { ItemIcon } from '@/components/ui/item-icon'
import MakiIcon from '@/components/ui/item-icon/MakiIcon.vue'
import { useI18n } from 'vue-i18n'

interface ModelValue {
  icon: string
  iconPack?: 'lucide' | 'maki'
  color: ThemeColor
}

interface IconItem {
  name: string
  // Alias terms shipped with lucide-static so a search for "home" matches
  // the "House" icon, "phone" matches "PhoneCall", etc. Joined into the
  // searchable text so fuzzy matching can hit either the formal name or
  // a synonym.
  aliases: string
  component: LucideIcon
}

// Build kebab-case → pascal-case once. lucide-static tags are keyed by
// kebab-case ("activity", "alert-triangle"); the lucide-vue-next exports
// are PascalCase ("Activity", "AlertTriangle"). Convert at module load
// so the lookup in the computed list is O(1).
const lucideAliasMap: Record<string, string[]> = {}
for (const [kebab, terms] of Object.entries(
  lucideTags as Record<string, string[]>,
)) {
  const pascal = kebab
    .split('-')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('')
  lucideAliasMap[pascal] = terms
}

const props = defineProps<{
  modelValue: ModelValue
  placeholder?: string
}>()

const { t } = useI18n()

const emit = defineEmits(['update:modelValue'])

const showPopover = ref(false)
const activeTab = ref<'lucide' | 'maki' | 'color'>(
  props.modelValue.iconPack === 'maki' ? 'maki' : 'lucide',
)
const iconSearch = ref('')

const lucideIconComponents = computed<IconItem[]>(() => {
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
      const aliases = (lucideAliasMap[name] ?? []).join(' ')
      return { name, aliases, component: component as LucideIcon }
    })
})

// Maki icon names sourced from the @mapbox/maki package at build time.
// We only need names here — the SVGs themselves are loaded inside
// MakiIcon. The `?as=raw` query exists just to make Vite enumerate the
// directory; the value is discarded.
const makiSvgs = import.meta.glob(
  '/node_modules/@mapbox/maki/icons/*.svg',
  { eager: true },
) as Record<string, unknown>
const makiIconNames = computed<string[]>(() => {
  return Object.keys(makiSvgs)
    .map((p) => p.split('/').pop()?.replace('.svg', '') ?? '')
    .filter(Boolean)
    .sort()
})

const filteredLucideIcons = computed(() => {
  if (!iconSearch.value) return lucideIconComponents.value
  // Match against the icon name AND its lucide-static aliases so a query
  // like "home" surfaces the House icon, "trash" surfaces Trash2 etc.
  return fuzzyFilter(lucideIconComponents.value, iconSearch.value, {
    keys: ['name', 'aliases'],
    threshold: -10000,
  })
})

const filteredMakiIcons = computed(() => {
  if (!iconSearch.value) return makiIconNames.value
  return fuzzyFilter(
    makiIconNames.value.map((name) => ({ name })),
    iconSearch.value,
    { keys: ['name'], threshold: -10000 },
  ).map((m) => m.name)
})

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

function selectLucide(iconName: string) {
  emit('update:modelValue', {
    ...props.modelValue,
    icon: iconName,
    iconPack: 'lucide',
  })
}

function selectMaki(iconName: string) {
  emit('update:modelValue', {
    ...props.modelValue,
    icon: iconName,
    iconPack: 'maki',
  })
}

function handleColorSelect(color: ThemeColor) {
  emit('update:modelValue', {
    ...props.modelValue,
    color,
  })
}

const isSelectedLucide = (name: string) =>
  (props.modelValue.iconPack ?? 'lucide') === 'lucide' &&
  props.modelValue.icon === name

const isSelectedMaki = (name: string) =>
  props.modelValue.iconPack === 'maki' && props.modelValue.icon === name

// Virtualization. Lucide ships ~1500 icons; rendering all of them on
// every search keystroke is what made the picker stutter. Chunk the
// filtered list into rows of 5 and only render the rows currently in
// view (plus a small overscan for smooth scrolling). Maki gets the same
// treatment for consistency even though its 215 icons would render fine
// without it.
const COLS = 5
const ROW_PX = 40 // size-9-ish button + gap

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

const lucideRows = computed(() => chunk(filteredLucideIcons.value, COLS))
const makiRows = computed(() => chunk(filteredMakiIcons.value, COLS))

const lucideScrollEl = ref<HTMLElement | null>(null)
const makiScrollEl = ref<HTMLElement | null>(null)

const lucideVirtualizer = useVirtualizer(
  computed(() => ({
    count: lucideRows.value.length,
    getScrollElement: () => lucideScrollEl.value,
    estimateSize: () => ROW_PX,
    overscan: 4,
  })),
)

const makiVirtualizer = useVirtualizer(
  computed(() => ({
    count: makiRows.value.length,
    getScrollElement: () => makiScrollEl.value,
    estimateSize: () => ROW_PX,
    overscan: 4,
  })),
)
</script>

<template>
  <Popover v-model:open="showPopover">
    <PopoverTrigger as-child>
      <Button
        variant="outline"
        class="p-4 flex items-center justify-center"
        size="icon-xl"
      >
        <ItemIcon
          :icon="modelValue.icon"
          :icon-pack="modelValue.iconPack ?? 'lucide'"
          :color="modelValue.color"
          size="md"
        />
      </Button>
    </PopoverTrigger>
    <PopoverContent class="w-72 p-0">
      <Tabs v-model="activeTab" class="w-full">
        <TabsList class="grid grid-cols-3 mb-2 px-2">
          <TabsTrigger value="lucide">Lucide</TabsTrigger>
          <TabsTrigger value="maki">Maki</TabsTrigger>
          <TabsTrigger value="color">Color</TabsTrigger>
        </TabsList>

        <!-- Lucide icon tab -->
        <TabsContent value="lucide" class="p-2 pt-0">
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
          <div
            ref="lucideScrollEl"
            class="h-64 overflow-y-auto p-1"
            :data-rows="lucideRows.length"
          >
            <div
              :style="{
                height: `${lucideVirtualizer.getTotalSize()}px`,
                width: '100%',
                position: 'relative',
              }"
            >
              <div
                v-for="row in lucideVirtualizer.getVirtualItems()"
                :key="String(row.key)"
                class="grid grid-cols-5 gap-1"
                :style="{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${row.start}px)`,
                  height: `${row.size}px`,
                }"
              >
                <Button
                  v-for="icon in lucideRows[row.index]"
                  :key="icon.name"
                  variant="ghost"
                  size="icon"
                  class="relative p-0"
                  :class="
                    isSelectedLucide(icon.name)
                      ? 'bg-primary/20 ring-2 ring-primary'
                      : ''
                  "
                  @click="selectLucide(icon.name)"
                >
                  <div class="absolute inset-0 grid place-items-center">
                    <component :is="icon.component" class="size-6" />
                  </div>
                </Button>
              </div>
            </div>
          </div>
        </TabsContent>

        <!-- Maki icon tab -->
        <TabsContent value="maki" class="p-2 pt-0">
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
          <div ref="makiScrollEl" class="h-64 overflow-y-auto p-1">
            <div
              :style="{
                height: `${makiVirtualizer.getTotalSize()}px`,
                width: '100%',
                position: 'relative',
              }"
            >
              <div
                v-for="row in makiVirtualizer.getVirtualItems()"
                :key="String(row.key)"
                class="grid grid-cols-5 gap-1"
                :style="{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${row.start}px)`,
                  height: `${row.size}px`,
                }"
              >
                <Button
                  v-for="name in makiRows[row.index]"
                  :key="name"
                  variant="ghost"
                  size="icon"
                  class="relative p-0"
                  :class="
                    isSelectedMaki(name)
                      ? 'bg-primary/20 ring-2 ring-primary'
                      : ''
                  "
                  @click="selectMaki(name)"
                >
                  <div class="absolute inset-0 grid place-items-center">
                    <MakiIcon :name="name" size="md" />
                  </div>
                </Button>
              </div>
            </div>
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
