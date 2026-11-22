import { OFFLINE_SOURCE_ID } from '@/lib/offline/packages'
import { localPlace } from '@/lib/search/local-search'
import { WidgetDataType, WidgetType, type Place } from '@/types/place.types'
import type { PackagePlace } from '@/types/offline-package.types'
import type { AutocompleteResult } from '@/types/search.types'

const OSM_ID = /^(node|way|relation)\//

/** The app's place id for a saved row: `osm/node/1`, or `stop/<feed>/<stop>` for a stop. */
export const packagePlaceId = (p: PackagePlace) => (OSM_ID.test(p.id) ? `osm/${p.id}` : p.id)

/** The saved row id a place id refers to, or null when no package can hold it. */
export function packageIdFromPlaceId(placeId: string): string | null {
  if (placeId.startsWith('osm/')) return placeId.slice(4)
  return placeId.startsWith('stop/') ? placeId : null
}

const TRANSIT_CATEGORY = /^(public_transport\/(station|stop_position|platform)|railway\/(station|halt|tram_stop|subway_entrance)|highway\/bus_stop|amenity\/ferry_terminal)/

function formatAddress(p: PackagePlace): string | null {
  const a = p.address
  if (!a) return null
  const street = [a.housenumber, a.street].filter(Boolean).join(' ')
  return [street, a.city, [a.state, a.postcode].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null
}

const routeNames = (p: PackagePlace) =>
  p.transit?.routes.map(r => r.shortName).filter(Boolean).join(' · ') || undefined

export function packagePlaceAsResult(p: PackagePlace): AutocompleteResult {
  return {
    id: packagePlaceId(p),
    type: 'place',
    title: p.name,
    description: routeNames(p) ?? formatAddress(p) ?? p.placeType,
    icon: p.icon ?? (p.transit ? 'TrainFront' : 'MapPin'),
    iconPack: p.icon ? (p.iconPack ?? 'lucide') : 'lucide',
    lat: p.lat,
    lng: p.lng,
  }
}

/** A place page built from the saved row, with a departures board for anything riders board at. */
export function packagePlaceAsPlace(p: PackagePlace): Place {
  const id = packagePlaceId(p)
  const place = localPlace({
    id,
    name: p.name,
    lat: p.lat,
    lng: p.lng,
    address: formatAddress(p),
    placeType: p.placeType ?? routeNames(p),
    icon: p.icon,
    iconPack: p.iconPack,
    externalIds: OSM_ID.test(p.id) ? { osm: p.id } : {},
  })
  const field = <T>(value: T) => ({ value, sourceId: OFFLINE_SOURCE_ID })
  if (p.phone) place.contactInfo.phone = field(p.phone)
  if (p.website) place.contactInfo.website = field(p.website)
  if (p.hours) {
    place.openingHours = field({
      regularHours: [],
      isOpen24_7: p.hours.trim() === '24/7',
      isPermanentlyClosed: false,
      isTemporarilyClosed: false,
      rawText: p.hours,
    })
  }
  if (p.transit || (p.category && TRANSIT_CATEGORY.test(p.category))) {
    place.widgets = [
      {
        type: WidgetType.TRANSIT,
        dataType: WidgetDataType.ASYNC,
        title: p.name,
        estimatedHeight: 200,
        params: {
          lat: p.lat,
          lng: p.lng,
          name: p.name,
          ...(p.transit && { feedId: p.transit.feedId, stopId: p.transit.stopId }),
        },
      },
    ]
  }
  return place
}
