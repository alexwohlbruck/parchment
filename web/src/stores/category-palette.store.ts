import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '@/lib/api'
import { useAppDataCache } from '@/lib/app-data-cache'
import type { PlaceCategory } from '@/types/place.types'

export interface PlaceCategoryDefinition {
  id: PlaceCategory
  label: string
  colors: { light: string; dark: string }
}

// Fallback palette — used until the server data is loaded or if the fetch fails.
// Should mirror server/src/lib/place-categories.ts categoryPalette.
const FALLBACK_PALETTE: PlaceCategoryDefinition[] = [
  { id: 'food_and_drink',         label: 'Food & Drink',         colors: { light: '#FF9933',            dark: '#FBCB6A' } },
  { id: 'education',              label: 'Education',            colors: { light: 'hsl(30, 50%, 38%)',  dark: 'hsl(30, 50%, 70%)' } },
  { id: 'medical',                label: 'Medical',              colors: { light: 'hsl(0, 90%, 60%)',   dark: 'hsl(0, 70%, 70%)' } },
  { id: 'sport_and_leisure',      label: 'Sport & Leisure',      colors: { light: 'hsl(190, 75%, 38%)', dark: 'hsl(190, 60%, 70%)' } },
  { id: 'store',                  label: 'Store',                colors: { light: 'hsl(210, 75%, 53%)', dark: 'hsl(210, 70%, 75%)' } },
  { id: 'arts_and_entertainment', label: 'Arts & Entertainment', colors: { light: 'hsl(320, 85%, 60%)', dark: 'hsl(320, 70%, 75%)' } },
  { id: 'commercial_services',    label: 'Commercial Services',  colors: { light: 'hsl(250, 75%, 60%)', dark: 'hsl(260, 70%, 75%)' } },
  { id: 'park',                   label: 'Park & Nature',        colors: { light: 'hsl(110, 70%, 28%)', dark: 'hsl(110, 55%, 65%)' } },
  { id: 'default',                label: 'Other',                colors: { light: 'hsl(210, 20%, 43%)', dark: 'hsl(210, 20%, 70%)' } },
]

const SCHEMA_VERSION = 1

export const useCategoryPaletteStore = defineStore('categoryPalette', () => {
  const cache = useAppDataCache<PlaceCategoryDefinition[]>('parchment-category-palette', {
    schemaVersion: SCHEMA_VERSION,
    maxAgeHours: 168, // 1 week — colors rarely change
  })

  // Start from cache or fallback so the UI always has colors immediately
  const palette = ref<PlaceCategoryDefinition[]>(cache.get() ?? FALLBACK_PALETTE)
  const paletteMap = ref(new Map(palette.value.map(c => [c.id, c])))

  async function loadPalette(forceRefresh = false): Promise<void> {
    if (!forceRefresh && !cache.isStale()) return

    try {
      const response = await api.get<{ palette: PlaceCategoryDefinition[] }>(
        '/search/categories/palette',
      )
      const data = response.data.palette
      cache.set(data)
      palette.value = data
      paletteMap.value = new Map(data.map(c => [c.id, c]))
    } catch {
      // Keep using whatever we have (cache or fallback)
    }
  }

  function getCategoryColor(category: PlaceCategory | string, isDark: boolean): string {
    const entry = paletteMap.value.get(category as PlaceCategory)
      ?? paletteMap.value.get('default')!
    return isDark ? entry.colors.dark : entry.colors.light
  }

  return { palette, loadPalette, getCategoryColor }
})
