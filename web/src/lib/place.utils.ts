export function getPlaceType(tags: Record<string, string | undefined>): string {
  const hasTag = (key: string, value?: string) => {
    const tag = tags[key]
    return value ? tag === value : !!tag
  }

  // 1. Check amenity tag first (most specific)
  if (hasTag('amenity')) {
    const amenity = tags.amenity
    if (!amenity) return 'Place'

    switch (amenity) {
      // Food & Drink
      case 'bar':
        return 'Bar'
      case 'biergarten':
        return 'Beer Garden'
      case 'cafe':
        return 'Coffee Shop'
      case 'fast_food':
        return 'Fast Food Restaurant'
      case 'food_court':
        return 'Food Court'
      case 'ice_cream':
        return 'Ice Cream Shop'
      case 'pub':
        return 'Pub'
      case 'restaurant':
        if (!tags.cuisine) return 'Restaurant'
        const cuisineType = tags.cuisine.split(';')[0].replace('_', ' ')
        return `${cuisineType.charAt(0).toUpperCase()}${cuisineType.slice(
          1,
        )} Restaurant`

      // Education
      case 'college':
        return 'College'
      case 'library':
        return 'Library'
      case 'school':
        return 'School'
      case 'university':
        return 'University'
      case 'kindergarten':
        return 'Kindergarten'
      case 'language_school':
        return 'Language School'
      case 'music_school':
        return 'Music School'
      case 'driving_school':
        return 'Driving School'

      // Healthcare
      case 'clinic':
        return 'Medical Clinic'
      case 'dentist':
        return 'Dental Office'
      case 'doctors':
        return "Doctor's Office"
      case 'hospital':
        return 'Hospital'
      case 'pharmacy':
        return 'Pharmacy'
      case 'veterinary':
        return 'Veterinary Clinic'

      // Financial
      case 'atm':
        return 'ATM'
      case 'bank':
        return 'Bank'
      case 'bureau_de_change':
        return 'Currency Exchange'

      // Entertainment
      case 'casino':
        return 'Casino'
      case 'cinema':
        return 'Cinema'
      case 'nightclub':
        return 'Nightclub'
      case 'theatre':
        return 'Theatre'

      // Transportation
      case 'fuel':
        return 'Gas Station'
      case 'car_wash':
        return 'Car Wash'
      case 'car_rental':
        return 'Car Rental'
      case 'bicycle_rental':
        return 'Bike Rental'
      case 'boat_rental':
        return 'Boat Rental'
      case 'charging_station':
        return 'EV Charging Station'
      case 'parking':
        return 'Parking'
      case 'parking_space':
        return 'Parking Space'
      case 'taxi':
        return 'Taxi Stand'
      case 'bus_station':
        return 'Bus Station'

      // Public Services
      case 'post_office':
        return 'Post Office'
      case 'police':
        return 'Police Station'
      case 'fire_station':
        return 'Fire Station'
      case 'courthouse':
        return 'Courthouse'
      case 'townhall':
        return 'Town Hall'
      case 'prison':
        return 'Prison'

      // Community
      case 'community_centre':
        return 'Community Center'
      case 'social_centre':
        return 'Social Center'
      case 'place_of_worship':
        return 'Place of Worship'
      case 'marketplace':
        return 'Marketplace'

      // Facilities
      case 'toilets':
        return 'Public Restroom'
      case 'shower':
        return 'Public Shower'
      case 'drinking_water':
        return 'Drinking Water'
      case 'bench':
        return 'Bench'
      case 'shelter':
        return 'Shelter'

      // Arts & Culture
      case 'arts_centre':
        return 'Arts Center'
      case 'studio':
        return 'Studio'
      case 'exhibition_centre':
        return 'Exhibition Center'
      case 'conference_centre':
        return 'Conference Center'
      case 'events_venue':
        return 'Events Venue'
      case 'fountain':
        return 'Fountain'
      case 'music_venue':
        return 'Music Venue'
      case 'planetarium':
        return 'Planetarium'

      // Animal Services
      case 'animal_boarding':
        return 'Animal Boarding'
      case 'animal_breeding':
        return 'Animal Breeding'
      case 'animal_shelter':
        return 'Animal Shelter'
      case 'animal_training':
        return 'Animal Training'

      // Waste Management
      case 'recycling':
        return 'Recycling Center'
      case 'waste_basket':
        return 'Waste Basket'
      case 'waste_disposal':
        return 'Waste Disposal'
      case 'waste_transfer_station':
        return 'Waste Transfer Station'

      // Religious
      case 'monastery':
        return 'Monastery'
      case 'place_of_worship':
        switch (tags.religion) {
          case 'christian':
            return tags.denomination ? `${tags.denomination} Church` : 'Church'
          case 'muslim':
          case 'islamic':
            return 'Mosque'
          case 'jewish':
            return 'Synagogue'
          case 'buddhist':
            return 'Buddhist Temple'
          case 'hindu':
            return 'Hindu Temple'
          case 'sikh':
            return 'Gurdwara'
          default:
            return 'Place of Worship'
        }

      // Recreation
      case 'bbq':
        return 'BBQ Area'
      case 'picnic_table':
        return 'Picnic Area'
      case 'public_bath':
        return 'Public Bath'
      case 'sauna':
        return 'Sauna'

      // Personal Services
      case 'bureau_de_change':
        return 'Currency Exchange'
      case 'post_box':
        return 'Post Box'
      case 'post_office':
        return 'Post Office'
      case 'internet_cafe':
        return 'Internet Cafe'
      case 'telephone':
        return 'Public Telephone'
      case 'vending_machine':
        return 'Vending Machine'

      // Other Facilities
      case 'clock':
        return 'Public Clock'
      case 'hunting_stand':
        return 'Hunting Stand'
      case 'photo_booth':
        return 'Photo Booth'
      case 'public_bookcase':
        return 'Public Bookcase'
      case 'give_box':
        return 'Give Box'
      case 'parcel_locker':
        return 'Parcel Locker'
      case 'kneipp_water_cure':
        return 'Kneipp Water Cure'
      case 'lounger':
        return 'Lounger'

      // Generic fallback with nice formatting
      default:
        return `${amenity.charAt(0).toUpperCase()}${amenity
          .slice(1)
          .replace('_', ' ')}`
    }
  }

  // 2. Check shop tag second (also very specific)
  if (hasTag('shop')) {
    const shop = tags.shop
    if (!shop) return 'Shop'

    switch (shop) {
      // Food & Beverages
      case 'alcohol':
        return 'Liquor Store'
      case 'bakery':
        return 'Bakery'
      case 'beverages':
        return 'Beverage Store'
      case 'butcher':
        return 'Butcher Shop'
      case 'convenience':
        return 'Convenience Store'
      case 'deli':
        return 'Delicatessen'
      case 'dairy':
        return 'Dairy Shop'
      case 'greengrocer':
        return 'Greengrocer'
      case 'health_food':
        return 'Health Food Store'
      case 'seafood':
        return 'Seafood Market'
      case 'supermarket':
        return 'Supermarket'
      case 'wine':
        return 'Wine Shop'

      // Clothing & Accessories
      case 'clothes':
        return 'Clothing Store'
      case 'shoes':
        return 'Shoe Store'
      case 'jewelry':
        return 'Jewelry Store'
      case 'boutique':
        return 'Boutique'
      case 'fashion_accessories':
        return 'Fashion Accessories Store'

      // Electronics
      case 'computer':
        return 'Computer Store'
      case 'electronics':
        return 'Electronics Store'
      case 'mobile_phone':
        return 'Phone Store'

      // Home & Garden
      case 'furniture':
        return 'Furniture Store'
      case 'hardware':
        return 'Hardware Store'
      case 'garden_centre':
        return 'Garden Center'
      case 'florist':
        return 'Florist'
      case 'doityourself':
        return 'DIY Store'

      // Health & Beauty
      case 'chemist':
        return 'Drugstore'
      case 'cosmetics':
        return 'Cosmetics Store'
      case 'hairdresser':
        return 'Hair Salon'
      case 'optician':
        return 'Optician'
      case 'beauty':
        return 'Beauty Salon'

      // Sports & Leisure
      case 'sports':
        return 'Sporting Goods Store'
      case 'bicycle':
        return 'Bike Shop'
      case 'outdoor':
        return 'Outdoor Store'
      case 'books':
        return 'Bookstore'
      case 'music':
        return 'Music Store'

      // Other common shops
      case 'gift':
        return 'Gift Shop'
      case 'pet':
        return 'Pet Store'
      case 'toys':
        return 'Toy Store'
      case 'travel_agency':
        return 'Travel Agency'
      case 'department_store':
        return 'Department Store'
      case 'mall':
        return 'Shopping Mall'
      case 'stationery':
        return 'Stationery Store'

      // Generic fallback with nice formatting
      default:
        return `${shop.charAt(0).toUpperCase()}${shop
          .slice(1)
          .replace('_', ' ')} Shop`
    }
  }

  // 3. Check leisure tag third (more specific than landuse)
  if (hasTag('leisure')) {
    switch (tags.leisure) {
      // Sports/Recreation
      case 'sports_centre':
        return 'Sports Centre'
      case 'fitness_centre':
        return 'Fitness Centre'
      case 'swimming_pool':
        return 'Swimming Pool'
      case 'water_park':
        return 'Water Park'
      case 'stadium':
        return 'Stadium'
      case 'ice_rink':
        return 'Ice Rink'
      case 'bowling_alley':
        return 'Bowling Alley'
      case 'golf_course':
        return 'Golf Course'
      case 'miniature_golf':
        return 'Mini Golf Course'
      case 'sports_hall':
        return 'Sports Hall'
      case 'pitch':
        return tags.sport
          ? `${tags.sport.charAt(0).toUpperCase()}${tags.sport
              .slice(1)
              .replace('_', ' ')} Field`
          : 'Sports Field'
      case 'track':
        return 'Running Track'

      // Entertainment/Gaming
      case 'amusement_arcade':
        return 'Arcade'
      case 'adult_gaming_centre':
        return 'Gaming Centre'
      case 'escape_game':
        return 'Escape Room'
      case 'trampoline_park':
        return 'Trampoline Park'

      // Parks/Nature
      case 'park':
        return 'Park'
      case 'garden':
        return 'Garden'
      case 'nature_reserve':
        return 'Nature Reserve'
      case 'playground':
        return 'Playground'
      case 'dog_park':
        return 'Dog Park'

      // Other
      case 'marina':
        return 'Marina'
      case 'sauna':
        return 'Sauna'
      case 'beach_resort':
        return 'Beach Resort'
    }
  }

  // 4. Check building type fourth
  if (hasTag('building')) {
    switch (tags.building) {
      // Residential buildings
      case 'apartments':
        return 'Apartment Building'
      case 'bungalow':
        return 'Bungalow'
      case 'detached':
        return 'Detached House'
      case 'dormitory':
        return 'Dormitory'
      case 'house':
        return 'House'
      case 'residential':
        return 'Residential Building'
      case 'semidetached_house':
        return 'Semi-Detached House'
      case 'terrace':
        return 'Terraced House'
      case 'hotel':
        return 'Hotel'

      // Commercial buildings
      case 'commercial':
        return 'Commercial Building'
      case 'office':
        return 'Office Building'
      case 'retail':
        return 'Retail Building'
      case 'supermarket':
        return 'Supermarket'
      case 'warehouse':
        return 'Warehouse'
      case 'industrial':
        return 'Industrial Building'

      // Civic/Public buildings
      case 'civic':
        return 'Civic Building'
      case 'hospital':
        return 'Hospital Building'
      case 'school':
        return 'School Building'
      case 'university':
        return 'University Building'
      case 'public':
        return 'Public Building'
      case 'transportation':
        return 'Transportation Building'
      case 'train_station':
        return 'Train Station'

      // Religious buildings
      case 'religious':
        return 'Religious Building'
      case 'church':
        return 'Church'
      case 'mosque':
        return 'Mosque'
      case 'temple':
        return 'Temple'
      case 'synagogue':
        return 'Synagogue'

      // Other common buildings
      case 'construction':
        return 'Building Under Construction'
      case 'roof':
        return 'Covered Area'
      case 'service':
        return 'Service Building'
      case 'yes':
        return 'Building'
    }
  }

  // 5. Check public transport type
  if (hasTag('public_transport')) {
    switch (tags.public_transport) {
      case 'station':
        // Check specific station types
        switch (tags.station) {
          case 'subway':
            return 'Subway Station'
          case 'light_rail':
            return 'Light Rail Station'
          case 'train':
            return 'Train Station'
          case 'monorail':
            return 'Monorail Station'
          case 'funicular':
            return 'Funicular Station'
          case 'tram':
            return 'Tram Station'
          default:
            return 'Transit Station'
        }
      case 'stop_position':
        return tags.bus === 'yes' ? 'Bus Stop' : 'Transit Stop'
      case 'platform':
        if (tags.bus === 'yes') return 'Bus Platform'
        if (tags.tram === 'yes') return 'Tram Platform'
        return 'Transit Platform'
      case 'stop_area':
        return 'Transit Stop Area'
      case 'stop_area_group':
        return 'Transit Hub'
    }
  }

  // 6. Check residential type
  if (hasTag('residential') || hasTag('landuse', 'residential')) {
    if (tags.residential) {
      switch (tags.residential) {
        case 'urban':
          return 'Urban Residential Area'
        case 'rural':
          return 'Rural Residential Area'
        case 'apartments':
          return 'Apartment Complex'
        case 'condominium':
          return 'Condominium'
        case 'detached':
        case 'single_family':
          return 'Single-Family Residential'
        case 'duplex':
          return 'Duplex Housing'
        case 'irregular_settlement':
        case 'informal_settlement':
          return 'Informal Settlement'
        case 'trailer_park':
          return 'Mobile Home Park'
        case 'halting_site':
          return 'Halting Site'
        case 'terrace':
          return 'Terraced Housing'
        case 'block':
          return 'Residential Block'
        default:
          return 'Residential Area'
      }
    }
    return 'Residential Area'
  }

  // 7. Check landuse type last (most general)
  if (hasTag('landuse')) {
    switch (tags.landuse) {
      // Commercial/Industrial
      case 'commercial':
        return 'Commercial Area'
      case 'industrial':
        return 'Industrial Area'
      case 'retail':
        return 'Retail Area'
      case 'warehouse':
        return 'Warehouse District'

      // Institutional
      case 'education':
        return 'Educational Campus'
      case 'institutional':
        return 'Institutional Area'
      case 'religious':
        return 'Religious Grounds'
      case 'military':
        return 'Military Area'

      // Entertainment/Recreation
      case 'recreation_ground':
        return 'Recreation Area'
      case 'fairground':
        return 'Fairground'
      case 'winter_sports':
        return 'Winter Sports Area'

      // Development
      case 'construction':
        return 'Construction Site'
      case 'brownfield':
        return 'Brownfield Site'
      case 'greenfield':
        return 'Greenfield Site'

      // Agricultural
      case 'farmland':
        return 'Farmland'
      case 'farmyard':
        return 'Farm'
      case 'greenhouse_horticulture':
        return 'Greenhouse Area'
      case 'orchard':
        return 'Orchard'
      case 'vineyard':
        return 'Vineyard'
      case 'allotments':
        return 'Allotment Gardens'

      // Other
      case 'cemetery':
        return 'Cemetery'
      case 'grass':
        return 'Grass Area'
      case 'village_green':
        return 'Village Green'
      case 'quarry':
        return 'Quarry'
      case 'railway':
        return 'Railway Area'
    }
  }

  if (hasTag('tourism')) {
    const tourism = tags.tourism
    if (!tourism) return 'Tourist Spot'
    return `${tourism.charAt(0).toUpperCase()}${tourism
      .slice(1)
      .replace('_', ' ')}`
  }

  if (hasTag('office')) {
    const office = tags.office
    if (!office) return 'Office'
    return `${office.charAt(0).toUpperCase()}${office
      .slice(1)
      .replace('_', ' ')} Office`
  }

  return 'Place' // Default fallback
}

export function parseOpeningHours(hoursStr: string) {
  // Move from map.utils.ts
  // ... existing parseOpeningHours logic ...
}

export function formatAddress(
  tags: Record<string, string | undefined>,
): string {
  if (!tags) return ''

  const parts = [
    `${tags['addr:housenumber'] || ''} ${tags['addr:street'] || ''}`.trim(),
    `${tags['addr:city'] || ''}${
      tags['addr:city'] && tags['addr:state'] ? ',' : ''
    } ${tags['addr:state'] || ''} ${tags['addr:postcode'] || ''}`.trim(),
    tags['addr:country'],
  ].filter(Boolean)

  return parts.join('\n')
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

export async function fetchWikidataImage(
  wikidataId: string,
): Promise<string | null> {
  try {
    const response = await fetch(
      `https://www.wikidata.org/w/api.php?action=wbgetclaims&property=P18&entity=${wikidataId}&format=json&origin=*`,
    )
    if (!response.ok) throw new Error('Failed to fetch from Wikidata')
    const data = await response.json()

    const imageFileName = data.claims?.P18?.[0]?.mainsnak?.datavalue?.value
    if (!imageFileName) return null

    const imageUrl = `https://commons.wikimedia.org/w/api.php?action=query&titles=File:${encodeURIComponent(
      imageFileName,
    )}&prop=imageinfo&iiprop=url&format=json&origin=*`
    const imageResponse = await fetch(imageUrl)
    if (!imageResponse.ok) throw new Error('Failed to fetch from Wikimedia')
    const imageData = await imageResponse.json()

    const pages = imageData.query?.pages || {}
    const page = Object.values(pages)[0] as any
    return page?.imageinfo?.[0]?.url || null
  } catch (error) {
    console.error('Failed to fetch Wikidata image:', error)
    return null
  }
}

export async function fetchWikidataBrandLogo(
  wikidataId: string,
): Promise<string | null> {
  try {
    const response = await fetch(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${wikidataId}&format=json&origin=*`,
    )
    if (!response.ok) throw new Error('Failed to fetch from Wikidata')
    const data = await response.json()

    const logoFileName =
      data.entities?.[wikidataId]?.claims?.P154?.[0]?.mainsnak?.datavalue?.value
    if (!logoFileName) return null

    const imageUrl = `https://commons.wikimedia.org/w/api.php?action=query&titles=File:${encodeURIComponent(
      logoFileName,
    )}&prop=imageinfo&iiprop=url&format=json&origin=*`
    const imageResponse = await fetch(imageUrl)
    if (!imageResponse.ok) throw new Error('Failed to fetch from Wikimedia')
    const imageData = await imageResponse.json()

    const pages = imageData.query?.pages || {}
    const page = Object.values(pages)[0] as any
    return page?.imageinfo?.[0]?.url || null
  } catch (error) {
    console.error('Failed to fetch Wikidata logo:', error)
    return null
  }
}
