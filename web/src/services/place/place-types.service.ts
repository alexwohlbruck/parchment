import { api } from '@/lib/api'
import { useAppDataCache } from '@/lib/app-data-cache'
import { storedLocale } from '@/lib/i18n'
import type { PlaceTypeLabels } from '@/lib/library/place-type-filter'

const SCHEMA_VERSION = 1
const pending = new Map<string, Promise<PlaceTypeLabels>>()

async function fetchLabels(locale: string): Promise<PlaceTypeLabels> {
  const cache = useAppDataCache<PlaceTypeLabels>(`parchment-place-types-${locale}`, {
    schemaVersion: SCHEMA_VERSION,
    maxAgeHours: 168,
  })
  const cached = cache.get()
  if (cached && !cache.isStale()) return cached
  try {
    const { data } = await api.get<{ labels: PlaceTypeLabels }>(
      '/search/categories/place-types',
    )
    cache.set(data.labels)
    return data.labels
  } catch {
    pending.delete(locale)
    return cached ?? {}
  }
}

/** Place type names by icon, in the app's language. */
export function loadPlaceTypeLabels(): Promise<PlaceTypeLabels> {
  const locale = storedLocale.value
  let labels = pending.get(locale)
  if (!labels) {
    labels = fetchLabels(locale)
    pending.set(locale, labels)
  }
  return labels
}
