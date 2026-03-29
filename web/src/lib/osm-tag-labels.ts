import { formatWord } from './string.utils'

/**
 * Human-readable labels for OSM tag keys shown in the OsmTagsWidget.
 * Keys not listed here fall back to `formatWord(key)`.
 */
export const TAG_LABELS: Record<string, string> = {
  bicycle_parking: 'Parking Type',
  cargo_bike: 'Cargo Bike',
  parking: 'Parking Type',
  'parking:condition': 'Parking Condition',
  'parking:orientation': 'Orientation',
  capacity: 'Capacity',
  'capacity:disabled': 'Disabled Spaces',
  'capacity:charging': 'EV Charging Spaces',
  'capacity:women': "Women's Spaces",
  'capacity:car_sharing': 'Car Sharing Spaces',
  'capacity:motorcycle': 'Motorcycle Spaces',
  seats: 'Seats',
  access: 'Access',
  fee: 'Fee',
  charge: 'Price',
  toll: 'Toll',
  maxstay: 'Max Stay',
  indoor: 'Indoor',
  covered: 'Covered',
  lit: 'Lit',
  surface: 'Surface',
  material: 'Material',
  colour: 'Color',
  color: 'Color',
  height: 'Height',
  width: 'Width',
  length: 'Length',
  depth: 'Depth',
  diameter: 'Diameter',
  'building:levels': 'Floors',
  'building:material': 'Building Material',
  'roof:shape': 'Roof Shape',
  start_date: 'Year Built',
  level: 'Floor',
  layer: 'Level',
  wheelchair: 'Wheelchair Access',
  'wheelchair:description': 'Wheelchair Notes',
  'toilets:wheelchair': 'Wheelchair Restroom',
  tactile_paving: 'Tactile Paving',
  operator: 'Operator',
  'operator:type': 'Operator Type',
  brand: 'Brand',
  network: 'Network',
  ref: 'Reference',
  cuisine: 'Cuisine',
  delivery: 'Delivery',
  takeaway: 'Takeaway',
  outdoor_seating: 'Outdoor Seating',
  microbrewery: 'Microbrewery',
  brewery: 'Brewery',
  organic: 'Organic',
  'diet:vegan': 'Vegan',
  'diet:vegetarian': 'Vegetarian',
  'diet:halal': 'Halal',
  'diet:kosher': 'Kosher',
  'diet:gluten_free': 'Gluten Free',
  toilets: 'Restrooms',
  'toilets:access': 'Access',
  'toilets:disposal': 'Toilet Type',
  'toilets:position': 'Position',
  changing_table: 'Baby Changing',
  diaper: 'Diaper',
  shower: 'Shower',
  drinking_water: 'Drinking Water',
  bottle: 'Bottle Fill',
  seasonal: 'Seasonal',
  oneway: 'One Way',
  lanes: 'Lanes',
  maxspeed: 'Speed Limit',
  maxheight: 'Height Limit',
  maxwidth: 'Width Limit',
  internet_access: 'Internet Access',
  'internet_access:fee': 'Fee',
  'internet_access:ssid': 'Network Name',
  smoking: 'Smoking',
  'smoking:outside': 'Outdoor Smoking',
  voltage: 'Voltage',
  frequency: 'Frequency',
  genus: 'Genus',
  species: 'Species',
  circumference: 'Trunk Circumference',
  'recycling:glass': 'Glass',
  'recycling:paper': 'Paper',
  'recycling:cans': 'Cans',
  'recycling:plastic': 'Plastic',
  'recycling:clothes': 'Clothes',
  'recycling:batteries': 'Batteries',
  'recycling:electronics': 'Electronics',
  'recycling:cardboard': 'Cardboard',
  'generator:source': 'Energy Source',
  'generator:output:electricity': 'Power Output',
  denomination: 'Denomination',
  religion: 'Religion',
  second_hand: 'Second Hand',
  bulk_purchase: 'Bulk Purchase',
  drive_through: 'Drive Through',
  rooms: 'Rooms',
  stars: 'Stars',
  beds: 'Beds',
  surveillance: 'Surveillance',
  inscription: 'Inscription',
  artwork_type: 'Artwork Type',
  artist_name: 'Artist',
  heritage: 'Heritage Listed',
}

/**
 * Return a human-readable label for an OSM tag key.
 * Falls back to title-casing the key if no explicit label exists.
 */
export function getOsmTagLabel(key: string): string {
  return TAG_LABELS[key] ?? formatWord(key)
}

/**
 * Convert an OSM tag key to an i18n-safe lookup key.
 * Replaces `:` and `-` with `_` so it can be used as a nested JSON property name.
 * e.g. "parking:condition" → "parking_condition"
 */
export function osmKeyToI18nKey(key: string): string {
  return key.replace(/[:\-]/g, '_')
}
