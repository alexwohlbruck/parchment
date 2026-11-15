import { useI18n } from 'vue-i18n'
import { useMapStore } from '@/stores/map.store'
import { useAppStore } from '@/stores/app.store'
import { useBookmarksStore } from '@/stores/library/bookmarks.store'
import { useGeolocationService } from '@/services/geolocation.service'
import { frequentChipMeta } from '@/lib/frequents'
import { toLngLat } from '@/lib/geo/lng-lat'
import type { AskEndpoint, AskWhere } from '@/types/ask.types'

/** The map, the device's position, the user's saved places and units, read fresh for each question. */
export function useAskContext() {
  const { t } = useI18n()
  const mapStore = useMapStore()
  const appStore = useAppStore()
  const bookmarksStore = useBookmarksStore()
  const geolocation = useGeolocationService()

  function savedPlaces(): AskEndpoint[] {
    return bookmarksStore.bookmarks
      .filter(bookmark => bookmark.frequentType)
      .map(bookmark => {
        const meta = frequentChipMeta(bookmark)
        return {
          name: meta.labelKey ? t(meta.labelKey) : (meta.title ?? bookmark.name),
          lat: bookmark.lat,
          lng: bookmark.lng,
        }
      })
  }

  return function askContext(): AskWhere {
    return {
      ...toLngLat(mapStore.mapCamera.center),
      here: geolocation.lngLat.value ?? undefined,
      places: savedPlaces(),
      units: appStore.unitSystem,
    }
  }
}
