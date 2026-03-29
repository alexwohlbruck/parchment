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
} from 'lucide-vue-next'

/** A Lucide icon component (or any Vue component). */
export type IconComponent = any

/**
 * Return the appropriate Lucide icon component for an OSM tag key.
 */
export function getOsmTagIcon(key: string): IconComponent {
  if (key === 'capacity' || key.startsWith('capacity:') || key === 'seats' || key === 'rooms' || key === 'beds') return UsersIcon
  if (key === 'access') return LockOpenIcon
  if (key === 'fee' || key === 'charge' || key === 'toll' || key.startsWith('payment:')) return CreditCardIcon
  if (key === 'indoor') return HomeIcon
  if (key === 'covered') return UmbrellaIcon
  if (key === 'lit') return SunIcon
  if (key === 'level' || key === 'layer' || key === 'building:levels') return LayersIcon
  if (key === 'operator' || key === 'brand') return BuildingIcon
  if (key === 'wheelchair' || key.startsWith('wheelchair:') || key === 'tactile_paving') return AccessibilityIcon
  if (key === 'maxstay') return ClockIcon
  if (key === 'maxspeed' || key === 'maxheight' || key === 'maxwidth') return GaugeIcon
  if (key === 'delivery' || key === 'takeaway' || key === 'drive_through') return ShoppingBagIcon
  if (key.startsWith('diet:') || key === 'organic' || key === 'genus' || key === 'species') return LeafIcon
  if (key === 'drinking_water' || key === 'bottle') return DropletIcon
  if (key === 'colour' || key === 'color' || key === 'material' || key === 'surface' || key === 'roof:shape' || key === 'building:material') return PaletteIcon
  if (key === 'voltage' || key === 'frequency' || key.startsWith('generator:')) return ZapIcon
  if (key === 'changing_table' || key === 'diaper') return BabyIcon
  if (key === 'seasonal' || key === 'start_date') return CalendarIcon
  if (key === 'parking' || key.startsWith('parking:')) return ParkingSquareIcon
  if (key === 'bicycle_parking' || key === 'cargo_bike') return BikeIcon
  if (key.startsWith('recycling:')) return RecycleIcon
  if (key === 'network' || key === 'ref') return NavigationIcon
  if (key === 'cuisine') return TagIcon
  if (key === 'denomination' || key === 'religion') return BookOpenIcon
  if (key === 'oneway' || key === 'lanes' || key.startsWith('cycleway') || key === 'sidewalk') return NavigationIcon
  if (key === 'outdoor_seating') return UmbrellaIcon
  if (key === 'stars' || key === 'heritage') return StarIcon
  if (key === 'surveillance' || key.startsWith('surveillance:')) return AlertTriangleIcon
  if (key === 'toilets' || key.startsWith('toilets:') || key === 'shower') return ToiletIcon
  if (key === 'smoking' || key.startsWith('smoking:')) return CigaretteIcon
  if (key === 'internet_access' || key.startsWith('internet_access:')) return WifiIcon
  if (key === 'fireplace' || key === 'heating') return FlameIcon
  if (key === 'inscription' || key === 'artwork_type' || key === 'artist_name') return BookOpenIcon
  if (key === 'hash') return HashIcon
  return InfoIcon
}
