import { compactHours, type SiteBusiness } from './schema-org'
import { BUSINESS_KEYS, isOsmHours, presetTags } from './preset-schema'
import { facebookPage, instagramProfile } from './site-page'

/** schema.org business types and the OSM tags that say the same thing. */
export const CATEGORY_TAGS: Record<string, Record<string, string>> = {
  Restaurant: { amenity: 'restaurant' },
  FastFoodRestaurant: { amenity: 'fast_food' },
  CafeOrCoffeeShop: { amenity: 'cafe' },
  BarOrPub: { amenity: 'bar' },
  NightClub: { amenity: 'nightclub' },
  Brewery: { craft: 'brewery' },
  Winery: { craft: 'winery' },
  Bakery: { shop: 'bakery' },
  IceCreamShop: { amenity: 'ice_cream' },
  Hotel: { tourism: 'hotel' },
  Motel: { tourism: 'motel' },
  Hostel: { tourism: 'hostel' },
  BedAndBreakfast: { tourism: 'guest_house' },
  Campground: { tourism: 'camp_site' },
  Dentist: { amenity: 'dentist', healthcare: 'dentist' },
  Physician: { amenity: 'doctors', healthcare: 'doctor' },
  Pharmacy: { amenity: 'pharmacy', healthcare: 'pharmacy' },
  VeterinaryCare: { amenity: 'veterinary' },
  Optician: { shop: 'optician' },
  HairSalon: { shop: 'hairdresser' },
  BeautySalon: { shop: 'beauty' },
  NailSalon: { shop: 'beauty', beauty: 'nails' },
  TattooParlor: { shop: 'tattoo' },
  ExerciseGym: { leisure: 'fitness_centre' },
  BowlingAlley: { leisure: 'bowling_alley' },
  BookStore: { shop: 'books' },
  ClothingStore: { shop: 'clothes' },
  ShoeStore: { shop: 'shoes' },
  GroceryStore: { shop: 'supermarket' },
  ConvenienceStore: { shop: 'convenience' },
  Florist: { shop: 'florist' },
  HardwareStore: { shop: 'hardware' },
  JewelryStore: { shop: 'jewelry' },
  LiquorStore: { shop: 'alcohol' },
  PetStore: { shop: 'pet' },
  BikeStore: { shop: 'bicycle' },
  ElectronicsStore: { shop: 'electronics' },
  MobilePhoneStore: { shop: 'mobile_phone' },
  FurnitureStore: { shop: 'furniture' },
  GardenStore: { shop: 'garden_centre' },
  ToyStore: { shop: 'toys' },
  SportingGoodsStore: { shop: 'sports' },
  DryCleaningOrLaundry: { shop: 'dry_cleaning' },
  AutoRepair: { shop: 'car_repair' },
  MusicStore: { shop: 'musical_instrument' },
  MovingCompany: { office: 'moving_company' },
  Locksmith: { craft: 'locksmith' },
  Plumber: { craft: 'plumber' },
  Electrician: { craft: 'electrician' },
  HomeGoodsStore: { shop: 'houseware' },
  OutletStore: { shop: 'clothes' },
  SelfStorage: { shop: 'storage_rental' },
  Bank: { amenity: 'bank' },
  Library: { amenity: 'library' },
  ChildCare: { amenity: 'childcare' },
  MovieTheater: { amenity: 'cinema' },
  Museum: { tourism: 'museum' },
  ArtGallery: { tourism: 'gallery' },
  Zoo: { tourism: 'zoo' },
  AmusementPark: { tourism: 'theme_park' },
  PlaceOfWorship: { amenity: 'place_of_worship' },
  Attorney: { office: 'lawyer' },
  LegalService: { office: 'lawyer' },
  AccountingService: { office: 'accountant' },
  RealEstateAgent: { office: 'estate_agent' },
}

const SERVES_FOOD = new Set(['restaurant', 'fast_food', 'cafe'])

/** True when one of the business's types says what kind of place it is. */
export function hasCategory(business: SiteBusiness): boolean {
  return !!business.preset || business.types.some((type) => CATEGORY_TAGS[type])
}

/** The tags that say what kind of place the business is. */
export function categoryTags(business: SiteBusiness): Record<string, string> | undefined {
  if (business.preset) return presetTags(business.preset)
  return business.types.map((type) => CATEGORY_TAGS[type]).find(Boolean)
}

/** The OSM tags a new node for this business would carry, from the business's own site. */
export function businessTags(business: SiteBusiness, website: string): Record<string, string> {
  const category = categoryTags(business)
  const site: Record<string, string> = facebookPage(website)
    ? { 'contact:facebook': website }
    : instagramProfile(website)
      ? { 'contact:instagram': website }
      : { website }
  const tags: Record<string, string> = { ...business.tags, ...category, name: business.name, ...site }
  Object.assign(tags, addressTags(business.address))
  if (business.phone) tags.phone = business.phone
  if (business.email) tags.email = business.email
  if (business.branch && business.branch !== business.name) tags.branch = business.branch
  if (business.openingHours && isOsmHours(business.openingHours)) tags.opening_hours = compactHours(business.openingHours)
  if (business.cuisine?.length && SERVES_FOOD.has(category?.amenity ?? '')) {
    tags.cuisine = business.cuisine.map((item) => item.toLowerCase().replace(/[\s-]+/g, '_')).join(';')
  }
  return tags
}

/** A business that hasn't opened yet, as OSM's lifecycle prefix maps it: `construction:amenity=cafe`. */
export function notYetOpenTags(tags: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(tags).map(([key, value]) => [BUSINESS_KEYS.has(key) ? `construction:${key}` : key, value]),
  )
}

const UNIT = /^(?:suite|ste\.?|unit|apt\.?|#)\s*(.+)$/i

function addressTags(address: SiteBusiness['address']): Record<string, string> {
  if (!address?.street) return {}
  const [first, ...rest] = address.street.split(',').map((part) => part.trim())
  const tags: Record<string, string> = splitStreet(first)
  const unit = rest.map((part) => part.match(UNIT)?.[1]).find(Boolean)
  if (unit) tags['addr:unit'] = unit
  if (address.locality) tags['addr:city'] = address.locality
  if (address.postalCode) tags['addr:postcode'] = address.postalCode
  if (address.region && /^[A-Z]{2}$/.test(address.region)) tags['addr:state'] = address.region
  if (address.country && /^[A-Z]{2}$/i.test(address.country)) {
    tags['addr:country'] = address.country.toUpperCase()
  }
  return tags
}

/** "123 Main Street" and "Hauptstraße 5" as a house number and a street. */
export function splitStreet(line: string): Record<string, string> {
  const leading = line.match(/^(\d+[A-Za-z]?(?:[-–]\d+[A-Za-z]?)?)\s+(.+)$/)
  if (leading) return { 'addr:housenumber': leading[1], 'addr:street': leading[2] }
  const trailing = withoutFloor(line).match(/^(.+?)\s+(\d+[A-Za-z]?(?:[-–]\d+[A-Za-z]?)?)$/)
  if (trailing) return { 'addr:housenumber': trailing[2], 'addr:street': trailing[1] }
  return { 'addr:street': line }
}

/** A floor and door after the house number, "Århusgade 48 st. th" or "Vesterbrogade 12, 2. tv", which no geocoder reads. */
const FLOOR = /^(.+?\s\d+[A-Za-z]?),?(?:\s+(?:st|kl|th|tv|mf|sal|\d{1,2})\.?){1,3}$/i

function withoutFloor(line: string): string {
  return line.match(FLOOR)?.[1] ?? line
}

/** The address as one line, for geocoding. A country after the postcode throws Nominatim off: "…, SE1 9AB, GB" finds nothing. */
export function addressLine(address: SiteBusiness['address']): string | undefined {
  if (!address?.street) return undefined
  const country = address.locality || address.postalCode ? undefined : address.country
  return [withoutFloor(address.street), address.locality, address.region, address.postalCode, country]
    .filter(Boolean)
    .join(', ')
}
