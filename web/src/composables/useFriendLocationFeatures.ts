/**
 * Friends' live positions as GeoJSON.
 *
 * The main map draws friends as Vue markers — they carry avatars, they're
 * tappable, and they interpolate between samples. A canvas's people layer
 * wants something cheaper and more layer-like: dots the canvas can order,
 * hide and colour alongside its other layers.
 *
 * Positions come from the same decrypted store the markers use, so nothing
 * extra is fetched and nothing is ever written to the canvas — a people layer
 * records whose positions to draw, never where anyone is.
 */

import { createSharedComposable } from '@vueuse/core'
import type { FeatureCollection } from 'geojson'
import { useFriendLocations } from '@/composables/useFriendLocations'
import { useFriendsStore } from '@/stores/friends.store'
import { themeColorToHex, type ThemeColor } from '@/lib/utils'

/**
 * Stable per-person colour. Friends have no assigned colour, so one is
 * derived from the handle — the same person is the same colour on every
 * canvas and every device, without storing anything.
 */
const PALETTE: ThemeColor[] = [
  'cobalt',
  'coral',
  'forest',
  'violet',
  'amber',
  'teal',
  'magenta',
  'iris',
]

export function colorForHandle(handle: string): string {
  let hash = 0
  for (let i = 0; i < handle.length; i++) {
    hash = (hash * 31 + handle.charCodeAt(i)) >>> 0
  }
  return themeColorToHex(PALETTE[hash % PALETTE.length])
}

function friendLocationFeatures() {
  const friendLocations = useFriendLocations()
  const friendsStore = useFriendsStore()

  function displayName(handle: string): string {
    const friend = friendsStore.friends.find(f => f.friendHandle === handle)
    return friend?.friendName || handle.split('@')[0]
  }

  /**
   * Positions for the given handles, or everyone sharing with you when the
   * list is empty — which is what a people layer added with no selection means.
   */
  function peopleFeatures(handles?: string[]): FeatureCollection {
    const wanted = handles?.length ? new Set(handles) : null

    return {
      type: 'FeatureCollection',
      features: friendLocations.locations.value
        .filter(location => !wanted || wanted.has(location.friendHandle))
        .map(location => ({
          type: 'Feature' as const,
          geometry: {
            type: 'Point' as const,
            coordinates: [location.lngLat.lng, location.lngLat.lat],
          },
          properties: {
            handle: location.friendHandle,
            name: displayName(location.friendHandle),
            color: colorForHandle(location.friendHandle),
          },
        })),
    }
  }

  return { peopleFeatures, displayName }
}

export const useFriendLocationFeatures = createSharedComposable(
  friendLocationFeatures,
)
