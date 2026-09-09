import {
  InfoIcon,
  UsersIcon,
  LockOpenIcon,
  CreditCardIcon,
  HomeIcon,
  UmbrellaIcon,
  SunIcon,
  LayersIcon,
  BuildingIcon,
  TagIcon,
  HashIcon,
  ClockIcon,
  ShoppingBagIcon,
  LeafIcon,
  AccessibilityIcon,
  DropletIcon,
  PaletteIcon,
  ZapIcon,
  BabyIcon,
  CalendarIcon,
  CalendarCheckIcon,
  NavigationIcon,
  GaugeIcon,
  ParkingSquareIcon,
  BikeIcon,
  RecycleIcon,
  BookOpenIcon,
  StarIcon,
  AlertTriangleIcon,
  WifiIcon,
  CigaretteIcon,
  ToiletIcon,
  FlameIcon,
  SnowflakeIcon,
  BeerIcon,
  DogIcon,
  HeartIcon,
  HandIcon,
  BotIcon,
  MusicIcon,
  WineIcon,
  CoffeeIcon,
  ArmchairIcon,
  SmartphoneIcon,
  PawPrintIcon,
  ShowerHeadIcon,
  DollarSignIcon,
} from 'lucide-vue-next'

/** A Lucide icon component (or any Vue component). */
export type IconComponent = any

/**
 * Return the appropriate Lucide icon component for an OSM tag key.
 */
export function getOsmTagIcon(key: string): IconComponent {
  if (key === 'capacity' || key.startsWith('capacity:') || key === 'seats' || key === 'rooms' || key === 'beds') return UsersIcon
  if (key === 'access') return LockOpenIcon
  if (key === 'fee' || key === 'charge' || key === 'toll') return CreditCardIcon
  if (key.startsWith('payment:')) {
    if (key === 'payment:contactless' || key === 'payment:apple_pay' || key === 'payment:google_pay') return SmartphoneIcon
    return CreditCardIcon
  }
  if (key === 'indoor' || key === 'indoor_seating') return HomeIcon
  if (key === 'covered' || key === 'outdoor_seating') return UmbrellaIcon
  if (key === 'lit') return SunIcon
  if (key === 'level' || key === 'layer' || key === 'building:levels') return LayersIcon
  if (key === 'operator' || key === 'brand') return BuildingIcon
  if (key === 'wheelchair' || key.startsWith('wheelchair:') || key === 'tactile_paving') return AccessibilityIcon
  if (key === 'maxstay') return ClockIcon
  if (key === 'maxspeed' || key === 'maxheight' || key === 'maxwidth') return GaugeIcon
  if (key === 'delivery' || key === 'takeaway' || key === 'drive_through' || key === 'bulk_purchase') return ShoppingBagIcon
  if (key.startsWith('diet:') || key === 'organic') return LeafIcon
  if (key === 'genus' || key === 'species') return LeafIcon
  if (key === 'drinking_water' || key === 'bottle') return DropletIcon
  if (key === 'colour' || key === 'color' || key === 'material' || key === 'surface' || key === 'roof:shape' || key === 'building:material') return PaletteIcon
  if (key === 'voltage' || key === 'frequency' || key.startsWith('generator:')) return ZapIcon
  if (key === 'changing_table' || key === 'diaper' || key === 'kids_area' || key === 'highchair') return BabyIcon
  if (key === 'seasonal' || key === 'start_date') return CalendarIcon
  if (key === 'reservation') return CalendarCheckIcon
  if (key === 'parking' || key.startsWith('parking:')) return ParkingSquareIcon
  if (key === 'bicycle_parking' || key === 'cargo_bike') return BikeIcon
  if (key.startsWith('recycling:') || key === 'second_hand') return RecycleIcon
  if (key === 'network' || key === 'ref') return NavigationIcon
  if (key === 'cuisine') return TagIcon
  if (key === 'denomination' || key === 'religion') return BookOpenIcon
  if (key === 'oneway' || key === 'lanes' || key.startsWith('cycleway') || key === 'sidewalk') return NavigationIcon
  if (key === 'stars' || key === 'heritage') return StarIcon
  if (key === 'surveillance' || key.startsWith('surveillance:')) return AlertTriangleIcon
  if (key === 'toilets' || key.startsWith('toilets:')) return ToiletIcon
  if (key === 'shower') return ShowerHeadIcon
  if (key === 'smoking' || key.startsWith('smoking:')) return CigaretteIcon
  if (key === 'internet_access' || key.startsWith('internet_access:')) return WifiIcon
  if (key === 'fireplace' || key === 'heating' || key === 'heated') return FlameIcon
  if (key === 'air_conditioning') return SnowflakeIcon
  if (key === 'microbrewery' || key === 'brewery') return BeerIcon
  if (key === 'dog') return DogIcon
  if (key === 'pets_allowed') return PawPrintIcon
  if (key === 'lgbtq') return HeartIcon
  if (key === 'self_service') return HandIcon
  if (key === 'automated') return BotIcon
  if (key === 'live_music') return MusicIcon
  if (key === 'cocktails' || key === 'bar') return WineIcon
  if (key === 'breakfast') return CoffeeIcon
  if (key === 'inscription' || key === 'artwork_type' || key === 'artist_name') return BookOpenIcon
  if (key === 'hash') return HashIcon
  return InfoIcon
}

// ── Icon name → component resolver ──────────────────────────────────────────

/**
 * Map of icon string names (as sent by the server in DisplayChip.icon)
 * to Lucide Vue components. Used by the frontend to render chip icons.
 */
const ICON_NAME_MAP: Record<string, IconComponent> = {
  'accessibility': AccessibilityIcon,
  'credit-card': CreditCardIcon,
  'toilet': ToiletIcon,
  'shower-head': ShowerHeadIcon,
  'baby': BabyIcon,
  'wifi': WifiIcon,
  'umbrella': UmbrellaIcon,
  'armchair': ArmchairIcon,
  'home': HomeIcon,
  'flame': FlameIcon,
  'sun': SunIcon,
  'snowflake': SnowflakeIcon,
  'cigarette': CigaretteIcon,
  'shopping-bag': ShoppingBagIcon,
  'calendar-check': CalendarCheckIcon,
  'hand': HandIcon,
  'bot': BotIcon,
  'coffee': CoffeeIcon,
  'wine': WineIcon,
  'beer': BeerIcon,
  'music': MusicIcon,
  'leaf': LeafIcon,
  'recycle': RecycleIcon,
  'droplet': DropletIcon,
  'dog': DogIcon,
  'paw-print': PawPrintIcon,
  'heart': HeartIcon,
  'smartphone': SmartphoneIcon,
  'dollar-sign': DollarSignIcon,
  'info': InfoIcon,
}

/**
 * Resolve an icon name string (from server DisplayChip.icon) to a Lucide component.
 * Falls back to InfoIcon for unknown names.
 */
export function resolveIconByName(name: string): IconComponent {
  return ICON_NAME_MAP[name] ?? InfoIcon
}
