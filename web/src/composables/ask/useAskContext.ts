import { useI18n } from 'vue-i18n'
import { useMapStore } from '@/stores/map.store'
import { useAppStore } from '@/stores/app.store'
import { useBookmarksStore } from '@/stores/library/bookmarks.store'
import { useAskPreferencesStore } from '@/stores/preferences/ask-preferences.store'
import { useGeolocationService } from '@/services/geolocation.service'
import { useDirectionsService } from '@/services/directions.service'
import { useDirectionsStore } from '@/stores/directions.store'
import { useNavigationPreferencesStore } from '@/stores/preferences/navigation-preferences.store'
import { frequentChipMeta } from '@/lib/frequents'
import { toLngLat } from '@/lib/geo/lng-lat'
import type { AskEndpoint, AskWhere } from '@/types/ask.types'

/** The map, the device's position, the user's saved places, units, vehicles and Directions preferences, read fresh for each question. */
export function useAskContext() {
  const { t } = useI18n()
  const mapStore = useMapStore()
  const appStore = useAppStore()
  const bookmarksStore = useBookmarksStore()
  const askPreferences = useAskPreferencesStore()
  const geolocation = useGeolocationService()
  const directionsService = useDirectionsService()
  const directionsStore = useDirectionsStore()
  const navigationPreferences = useNavigationPreferencesStore()

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
    const shareLocation = askPreferences.preferences.shareLocation
    return {
      ...toLngLat(mapStore.mapCamera.center),
      here: shareLocation ? (geolocation.lngLat.value ?? undefined) : undefined,
      places: shareLocation ? savedPlaces() : [],
      units: appStore.unitSystem,
      vehicles: directionsService.collectAvailableVehicles(),
      routingPreferences: directionsStore.routingPreferences,
      excludedModes: navigationPreferences.excludedModes,
    }
  }
}
