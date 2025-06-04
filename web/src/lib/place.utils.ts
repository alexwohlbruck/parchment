import { Place } from '@/types/place.types'
import { OpeningTime } from '@/types/place.types'
import { RouteLocationRaw } from 'vue-router'
import { AppRoute } from '@/router'

/**
 * Parse a place ID string and returns the appropriate route object
 *
 * @param placeId The place ID string (e.g., "osm/node/123456", "google/abc123", "location/name/lat/lng")
 * @returns A route object that can be used with router.push()
 */
export function getPlaceRoute(placeId: string): RouteLocationRaw {
  console.log(`getPlaceRoute called with placeId: "${placeId}"`)

  // OSM format: "osm/node/123456789"
  if (placeId.startsWith('osm/')) {
    const parts = placeId.substring(4).split('/')
    if (parts.length >= 2) {
      console.log(`Parsed as OSM route: type=${parts[0]}, id=${parts[1]}`)
      return {
        name: AppRoute.PLACE,
        params: {
          type: parts[0],
          id: parts[1],
        },
      }
    }
  }
  // Location format: "location/name/lat/lng"
  else if (placeId.startsWith('location/')) {
    const parts = placeId.substring(9).split('/')
    if (parts.length >= 3) {
      console.log(
        `Parsed as location route: name=${parts[0]}, lat=${parts[1]}, lng=${parts[2]}`,
      )
      return {
        name: AppRoute.PLACE_LOCATION,
        params: {
          name: parts[0],
          lat: parts[1],
          lng: parts[2],
        },
      }
    }
  }
  // Generic provider format: "provider/id"
  else if (placeId.includes('/')) {
    const [provider, id] = placeId.split('/')
    console.log(`Parsed as provider route: provider=${provider}, placeId=${id}`)
    return {
      name: AppRoute.PLACE_PROVIDER,
      params: {
        provider,
        placeId: id,
      },
    }
  }

  // Fallback for unknown formats - assume it's a Google Place ID
  console.log(`No prefix detected, assuming Google Place ID: "${placeId}"`)
  return {
    name: AppRoute.PLACE_PROVIDER,
    params: {
      provider: 'google',
      placeId,
    },
  }
}

// Client-specific implementation of utility functions
export function getPlaceType(tags: Record<string, string | undefined>): string {
  const amenity = tags.amenity
  const shop = tags.shop
  const tourism = tags.tourism
  const leisure = tags.leisure
  const office = tags.office
  const historic = tags.historic
  const healthcare = tags.healthcare
  const building = tags.building
  const landuse = tags.landuse
  const cuisine = tags.cuisine

  // Common amenities
  if (amenity === 'restaurant') return 'Restaurant'
  if (amenity === 'cafe') return 'Café'
  if (amenity === 'bar') return 'Bar'
  if (amenity === 'pub') return 'Pub'
  if (amenity === 'fast_food') return 'Fast Food Restaurant'
  if (amenity === 'hospital') return 'Hospital'
  if (amenity === 'pharmacy') return 'Pharmacy'
  if (amenity === 'school') return 'School'
  if (amenity === 'bank') return 'Bank'
  if (amenity === 'atm') return 'ATM'
  if (amenity === 'parking') return 'Parking'
  if (amenity === 'fuel') return 'Gas Station'
  if (amenity === 'post_office') return 'Post Office'
  if (amenity === 'library') return 'Library'
  if (amenity === 'cinema') return 'Cinema'
  if (amenity === 'theatre') return 'Theatre'
  if (amenity === 'marketplace') return 'Marketplace'
  if (amenity === 'place_of_worship') {
    const religion = tags.religion
    if (religion === 'christian') return 'Church'
    if (religion === 'muslim') return 'Mosque'
    if (religion === 'jewish') return 'Synagogue'
    if (religion === 'buddhist') return 'Buddhist Temple'
    if (religion === 'hindu') return 'Hindu Temple'
    return 'Place of Worship'
  }

  // Shops
  if (shop === 'supermarket') return 'Supermarket'
  if (shop === 'convenience') return 'Convenience Store'
  if (shop === 'clothes') return 'Clothing Store'
  if (shop === 'mall') return 'Shopping Mall'
  if (shop === 'hardware') return 'Hardware Store'
  if (shop === 'electronics') return 'Electronics Store'
  if (shop === 'bakery') return 'Bakery'
  if (shop === 'butcher') return 'Butcher Shop'
  if (shop === 'confectionery') return 'Confectionery'
  if (shop === 'deli') return 'Delicatessen'
  if (shop) return shop.charAt(0).toUpperCase() + shop.slice(1) + ' Shop'

  // Tourism
  if (tourism === 'hotel') return 'Hotel'
  if (tourism === 'hostel') return 'Hostel'
  if (tourism === 'guest_house') return 'Guest House'
  if (tourism === 'motel') return 'Motel'
  if (tourism === 'museum') return 'Museum'
  if (tourism === 'gallery') return 'Art Gallery'
  if (tourism === 'attraction') return 'Tourist Attraction'
  if (tourism === 'viewpoint') return 'Viewpoint'
  if (tourism) return tourism.charAt(0).toUpperCase() + tourism.slice(1)

  // Leisure
  if (leisure === 'park') return 'Park'
  if (leisure === 'garden') return 'Garden'
  if (leisure === 'playground') return 'Playground'
  if (leisure === 'sports_centre') return 'Sports Center'
  if (leisure === 'stadium') return 'Stadium'
  if (leisure === 'swimming_pool') return 'Swimming Pool'
  if (leisure) return leisure.charAt(0).toUpperCase() + leisure.slice(1)

  // Office
  if (office)
    return office.charAt(0).toUpperCase() + office.slice(1) + ' Office'

  // Historic
  if (historic === 'monument') return 'Monument'
  if (historic === 'memorial') return 'Memorial'
  if (historic === 'castle') return 'Castle'
  if (historic === 'ruins') return 'Ruins'
  if (historic)
    return historic.charAt(0).toUpperCase() + historic.slice(1) + ' Site'

  // Healthcare
  if (healthcare === 'doctor') return "Doctor's Office"
  if (healthcare === 'dentist') return 'Dentist'
  if (healthcare === 'clinic') return 'Medical Clinic'
  if (healthcare)
    return healthcare.charAt(0).toUpperCase() + healthcare.slice(1)

  // Buildings
  if (building === 'apartments') return 'Apartment Building'
  if (building === 'house') return 'House'
  if (building === 'commercial') return 'Commercial Building'
  if (building === 'industrial') return 'Industrial Building'
  if (building)
    return building.charAt(0).toUpperCase() + building.slice(1) + ' Building'

  // Landuse
  if (landuse === 'residential') return 'Residential Area'
  if (landuse === 'commercial') return 'Commercial Area'
  if (landuse === 'industrial') return 'Industrial Area'
  if (landuse === 'retail') return 'Retail Area'
  if (landuse === 'farmland') return 'Farmland'
  if (landuse === 'forest') return 'Forest'
  if (landuse)
    return landuse.charAt(0).toUpperCase() + landuse.slice(1) + ' Area'

  // Special cases for specific combinations
  if (
    cuisine &&
    (amenity === 'restaurant' || amenity === 'cafe' || amenity === 'fast_food')
  ) {
    const cuisineType = cuisine.split(';')[0].trim().replace(/_/g, ' ')
    return (
      cuisineType.charAt(0).toUpperCase() +
      cuisineType.slice(1) +
      ' ' +
      (amenity === 'restaurant'
        ? 'Restaurant'
        : amenity === 'cafe'
        ? 'Café'
        : 'Fast Food')
    )
  }

  // Default fallback
  return tags.name ? 'Place' : 'Unnamed Place'
}

export function formatAddress(place: Place): string {
  if (!place.address) return ''

  const address = place.address.value
  const { street1, street2, locality, postalCode, neighborhood, region } =
    address

  const parts: string[] = []

  // Add street address if available
  const streetParts = [street1, street2].filter(Boolean)
  const hasStreetAddress = streetParts.length > 0
  if (hasStreetAddress) {
    parts.push(streetParts.join(' '))
  }

  // Add neighborhood and locality
  if (neighborhood && locality) {
    parts.push(`${neighborhood}, ${locality}`)
  } else if (neighborhood) {
    parts.push(neighborhood)
    if (locality) parts.push(locality)
  } else if (locality) {
    parts.push(locality)
  }

  // Add postal code if we don't have a street address
  if (postalCode && !hasStreetAddress) {
    parts.push(postalCode)
  }
  // Or add region if we don't have street address or postal code
  else if (region && !hasStreetAddress && !postalCode) {
    parts.push(region)
  }

  return parts.join(', ')
}

export function parseCuisines(cuisine: string | undefined): string[] | null {
  if (!cuisine) return null

  return cuisine
    .split(';')
    .map(c => c.trim())
    .map(c => c.replace(/_/g, ' '))
    .map(c => c.charAt(0).toUpperCase() + c.slice(1))
}

export function getWifiStatus(tags: Record<string, string | undefined>) {
  const access = tags.internet_access
  const ssid = tags['internet_access:ssid']
  const fee = tags['internet_access:fee']
  const password = tags['internet_access:password']

  if (!access || access === 'no') return null

  let label = 'WiFi available'

  if (access === 'free' || fee === 'no') {
    label = 'Free WiFi available'
  } else if (access === 'customers') {
    label = 'WiFi for customers'
  } else if (fee === 'yes') {
    label = 'Paid WiFi available'
  }

  return {
    label,
    ssid,
    password,
  }
}

export function hasOutdoorSeating(
  tags: Record<string, string | undefined>,
): boolean {
  return tags.outdoor_seating === 'yes'
}

export function getWheelchairAccess(
  tags: Record<string, string | undefined>,
): string {
  const wheelchair = tags?.wheelchair || 'unknown'

  switch (wheelchair) {
    case 'yes':
      return 'Wheelchair accessible'
    case 'no':
      return 'Not wheelchair accessible'
    case 'limited':
      return 'Limited wheelchair accessibility'
    case 'designated':
      return 'Designated wheelchair access'
    default:
      return 'Unknown wheelchair accessibility'
  }
}

export function getSmokingStatus(
  tags: Record<string, string | undefined>,
): string {
  const smoking = tags?.smoking || 'unknown'

  switch (smoking) {
    case 'yes':
      return 'Smoking allowed'
    case 'no':
      return 'No smoking'
    case 'separated':
      return 'Separate smoking area'
    case 'isolated':
      return 'Isolated smoking area'
    case 'outside':
      return 'Smoking allowed outside'
    case 'dedicated':
      return 'Dedicated smoking area'
    default:
      return 'Unknown smoking policy'
  }
}

export function getRestroomAccess(
  tags: Record<string, string | undefined>,
): string {
  const toilets = tags?.toilets || 'unknown'

  switch (toilets) {
    case 'yes':
      return 'Restrooms available'
    case 'no':
      return 'No restrooms'
    case 'customers':
      return 'Restrooms for customers only'
    default:
      return 'Unknown restroom availability'
  }
}

// TODO: Unused
export function isPlaceOpen(openingTimes: OpeningTime[]): {
  isOpen: boolean
  nextChange?: string
} {
  if (!openingTimes || openingTimes.length === 0) {
    return { isOpen: false }
  }

  const now = new Date()
  const currentDay = now.getDay() // 0 = Sunday, 1 = Monday, etc.
  const currentHour = now.getHours()
  const currentMinute = now.getMinutes()
  const currentTime = `${currentHour
    .toString()
    .padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}`

  // Find if the place is currently open
  for (const time of openingTimes) {
    if (time.day === currentDay) {
      if (time.open <= currentTime && time.close > currentTime) {
        // Calculate time until closing
        const closingTime = time.close.split(':')
        const closingHour = parseInt(closingTime[0])
        const closingMinute = parseInt(closingTime[1])

        const closingDate = new Date()
        closingDate.setHours(closingHour, closingMinute)

        const minutesUntilClose = Math.round(
          (closingDate.getTime() - now.getTime()) / 60000,
        )

        if (minutesUntilClose <= 60) {
          return { isOpen: true, nextChange: `in ${minutesUntilClose} min` }
        } else {
          const hoursUntilClose = Math.floor(minutesUntilClose / 60)
          return { isOpen: true, nextChange: `in ${hoursUntilClose} hours` }
        }
      }
    }
  }

  // If we get here, the place is currently closed
  // Find the next opening time
  let nextOpeningTime: OpeningTime | null = null
  let daysUntilOpen = Infinity

  for (const time of openingTimes) {
    let dayDiff = time.day - currentDay
    if (dayDiff < 0) dayDiff += 7 // Wrap around for next week

    // Same day but later
    if (dayDiff === 0 && time.open > currentTime) {
      if (!nextOpeningTime || daysUntilOpen > 0) {
        nextOpeningTime = time
        daysUntilOpen = 0
      }
    }
    // Future day
    else if (dayDiff > 0) {
      if (!nextOpeningTime || dayDiff < daysUntilOpen) {
        nextOpeningTime = time
        daysUntilOpen = dayDiff
      }
    }
  }

  if (nextOpeningTime) {
    if (daysUntilOpen === 0) {
      return { isOpen: false, nextChange: `today at ${nextOpeningTime.open}` }
    } else if (daysUntilOpen === 1) {
      return {
        isOpen: false,
        nextChange: `tomorrow at ${nextOpeningTime.open}`,
      }
    } else {
      const days = [
        'Sunday',
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday',
      ]
      return {
        isOpen: false,
        nextChange: `on ${days[nextOpeningTime.day]} at ${
          nextOpeningTime.open
        }`,
      }
    }
  }

  return { isOpen: false }
}
