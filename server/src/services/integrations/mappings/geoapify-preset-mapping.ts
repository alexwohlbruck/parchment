/**
 * Mapping from OSM preset IDs to Geoapify category strings
 *
 * Based on Geoapify's hierarchical category system:
 * https://apidocs.geoapify.com/docs/places/
 *
 * Categories follow the pattern: main_category.sub_category
 * Some categories don't have sub-categories (e.g. 'parking')
 */

export const GEOAPIFY_TO_OSM_MAPPING: Record<string, string> = {
  // Accommodation
  'accommodation.hotel': 'tourism/hotel',
  'accommodation.motel': 'tourism/motel',
  'accommodation.hostel': 'tourism/hostel',
  'accommodation.guest_house': 'tourism/guest_house',
  'accommodation.chalet': 'tourism/chalet',
  'accommodation.apartment': 'tourism/apartment',
  'accommodation.hut': 'tourism/hut',

  // Activity
  'activity.community_center': 'leisure/community_centre',
  'activity.sport_club': 'leisure/sports_club',

  // Airport
  airport: 'aeroway/aerodrome',
  'airport.private': 'aeroway/aerodrome/private',
  'airport.international': 'aeroway/aerodrome/international',
  'airport.military': 'aeroway/aerodrome/military',
  'airport.gliding': 'aeroway/aerodrome/gliding',
  'airport.airfield': 'aeroway/aerodrome/airfield',

  // Commercial
  'commercial.supermarket': 'shop/supermarket',
  'commercial.convenience': 'shop/convenience',
  'commercial.shopping_mall': 'shop/mall',
  'commercial.department_store': 'shop/department_store',
  'commercial.elektronics': 'shop/electronics',
  'commercial.outdoor_and_sport': 'shop/outdoor',
  'commercial.vehicle': 'shop/vehicle',
  'commercial.hobby': 'shop/hobby',
  'commercial.books': 'shop/books',
  'commercial.gift_and_souvenir': 'shop/gift',
  'commercial.stationery': 'shop/stationery',
  'commercial.newsagent': 'shop/newsagent',
  'commercial.tickets_and_lottery': 'shop/lottery',
  'commercial.clothing.clothes': 'shop/clothes',
  'commercial.clothing.shoes': 'shop/shoes',
  'commercial.baby_goods': 'shop/baby_goods',
  'commercial.garden': 'shop/garden_centre',
  'commercial.houseware_and_hardware.hardware_and_tools': 'shop/hardware',
  'commercial.houseware_and_hardware.doityourself': 'shop/doityourself',
  'commercial.houseware_and_hardware.building_materials':
    'shop/building_materials',
  'commercial.houseware_and_hardware.building_materials.paint': 'shop/paint',
  'commercial.houseware_and_hardware.building_materials.glaziery':
    'shop/glaziery',
  'commercial.houseware_and_hardware.building_materials.doors': 'shop/doors',
  'commercial.houseware_and_hardware.building_materials.tiles': 'shop/tiles',
  'commercial.houseware_and_hardware.building_materials.windows':
    'shop/windows',
  'commercial.houseware_and_hardware.building_materials.flooring':
    'shop/flooring',
  'commercial.houseware_and_hardware.fireplace': 'shop/fireplace',
  'commercial.houseware_and_hardware.swimming_pool': 'shop/swimming_pool',
  'commercial.florist': 'shop/florist',
  'commercial.furniture_and_interior': 'shop/furniture',
  'commercial.furniture_and_interior.lighting': 'shop/lighting',
  'commercial.furniture_and_interior.curtain': 'shop/curtain',
  'commercial.furniture_and_interior.carpet': 'shop/carpet',
  'commercial.furniture_and_interior.kitchen': 'shop/kitchen',
  'commercial.furniture_and_interior.bed': 'shop/bed',
  'commercial.furniture_and_interior.bathroom': 'shop/bathroom',
  'commercial.chemist': 'shop/chemist',
  'commercial.health_and_beauty': 'shop/beauty',
  'commercial.health_and_beauty.pharmacy': 'shop/pharmacy',
  'commercial.health_and_beauty.optician': 'shop/optician',
  'commercial.health_and_beauty.medical_supply': 'shop/medical_supply',
  'commercial.health_and_beauty.hearing_aids': 'shop/hearing_aids',
  'commercial.health_and_beauty.herbalist': 'shop/herbalist',
  'commercial.health_and_beauty.cosmetics': 'shop/cosmetics',
  'commercial.health_and_beauty.wigs': 'shop/wigs',
  'commercial.toy_and_game': 'shop/toys',
  'commercial.pet': 'shop/pet',
  'commercial.food_and_drink.bakery': 'shop/bakery',
  'commercial.food_and_drink.deli': 'shop/deli',
  'commercial.food_and_drink.frozen_food': 'shop/frozen_food',
  'commercial.food_and_drink.pasta': 'shop/pasta',
  'commercial.food_and_drink.spices': 'shop/spices',
  'commercial.food_and_drink.organic': 'shop/organic',
  'commercial.food_and_drink.honey': 'shop/honey',
  'commercial.food_and_drink.rice': 'shop/rice',
  'commercial.food_and_drink.nuts': 'shop/nuts',
  'commercial.food_and_drink.health_food': 'shop/health_food',
  'commercial.food_and_drink.ice_cream': 'shop/ice_cream',
  'commercial.food_and_drink.seafood': 'shop/seafood',
  'commercial.food_and_drink.fruit_and_vegetable': 'shop/fruit_and_vegetable',
  'commercial.food_and_drink.farm': 'shop/farm',
  'commercial.food_and_drink.confectionery': 'shop/confectionery',
  'commercial.food_and_drink.chocolate': 'shop/chocolate',
  'commercial.food_and_drink.butcher': 'shop/butcher',
  'commercial.food_and_drink.cheese_and_dairy': 'shop/cheese',
  'commercial.food_and_drink.drinks': 'shop/drinks',
  'commercial.food_and_drink.coffee_and_tea': 'shop/coffee',
  'commercial.discount_store': 'shop/discount_store',
  'commercial.smoking': 'shop/smoking',
  'commercial.second_hand': 'shop/second_hand',
  'commercial.gas': 'shop/gas',
  'commercial.weapons': 'shop/weapons',
  'commercial.pyrotechnics': 'shop/pyrotechnics',
  'commercial.energy': 'shop/energy',
  'commercial.wedding': 'shop/wedding',
  'commercial.jewelry': 'shop/jewelry',
  'commercial.watches': 'shop/watches',
  'commercial.art': 'shop/art',
  'commercial.antiques': 'shop/antiques',
  'commercial.video_and_music': 'shop/video',
  'commercial.erotic': 'shop/erotic',
  'commercial.trade': 'shop/trade',
  'commercial.kiosk': 'shop/kiosk',

  // Food & Beverage
  'catering.restaurant': 'amenity/restaurant',
  'catering.cafe': 'amenity/cafe',
  'catering.bar': 'amenity/bar',
  'catering.fast_food': 'amenity/fast_food',
  'catering.pub': 'amenity/pub',
  'catering.food_court': 'amenity/food_court',
  'catering.ice_cream': 'amenity/ice_cream',
  'catering.biergarten': 'amenity/biergarten',

  // Healthcare
  'healthcare.hospital': 'amenity/hospital',
  'healthcare.pharmacy': 'amenity/pharmacy',
  'healthcare.dentist': 'amenity/dentist',
  'healthcare.clinic_or_praxis': 'amenity/clinic',
  'healthcare.clinic_or_praxis.general': 'amenity/doctors',
  'healthcare.veterinary': 'amenity/veterinary',

  // Services
  'service.financial.bank': 'amenity/bank',
  'service.financial.atm': 'amenity/atm',
  'service.financial.bureau_de_change': 'amenity/bureau_de_change',
  'service.financial.money_transfer': 'amenity/money_transfer',
  'service.vehicle.fuel': 'amenity/fuel',
  'service.vehicle.car_wash': 'amenity/car_wash',
  'service.vehicle.repair.car': 'amenity/car_repair',
  'service.post.office': 'amenity/post_office',
  'service.police': 'amenity/police',
  'service.fire_station': 'amenity/fire_station',
  'service.ambulance_station': 'amenity/ambulance_station',
  'service.taxi': 'amenity/taxi',
  'service.cleaning.laundry': 'amenity/laundry',
  'service.cleaning.dry_cleaning': 'amenity/dry_cleaning',
  'service.beauty.hairdresser': 'amenity/hairdresser',
  'service.beauty.spa': 'amenity/spa',
  'service.beauty.massage': 'amenity/massage',
  'service.tailor': 'amenity/tailor',
  'service.funeral_directors': 'amenity/funeral_directors',
  'service.bookmaker': 'amenity/bookmaker',
  'service.estate_agent': 'amenity/estate_agent',
  'service.locksmith': 'amenity/locksmith',
  'service.recycling.centre': 'amenity/recycling',

  // Parking
  parking: 'amenity/parking',
  'parking.bicycles': 'amenity/bicycle_parking',

  // Education
  'education.school': 'amenity/school',
  'education.university': 'amenity/university',
  'education.college': 'amenity/college',
  'education.library': 'amenity/library',
  'childcare.kindergarten': 'amenity/kindergarten',
  'education.driving_school': 'amenity/driving_school',
  'education.music_school': 'amenity/music_school',
  'education.language_school': 'amenity/language_school',

  // Entertainment
  'entertainment.attraction': 'tourism/attraction',
  'entertainment.museum': 'tourism/museum',
  'entertainment.zoo': 'tourism/zoo',
  'entertainment.aquarium': 'tourism/aquarium',
  'entertainment.planetarium': 'tourism/planetarium',
  'entertainment.theme_park': 'tourism/theme_park',
  'entertainment.water_park': 'tourism/water_park',
  'entertainment.cinema': 'leisure/cinema',
  'entertainment.culture.theatre': 'leisure/theatre',
  'entertainment.culture.arts_centre': 'leisure/arts_centre',
  'entertainment.culture.gallery': 'leisure/gallery',
  'entertainment.amusement_arcade': 'leisure/amusement_arcade',
  'entertainment.escape_game': 'leisure/escape_game',
  'entertainment.miniature_golf': 'leisure/miniature_golf',
  'entertainment.bowling_alley': 'leisure/bowling_alley',
  'entertainment.flying_fox': 'leisure/flying_fox',

  // Leisure
  'leisure.park': 'leisure/park',
  'leisure.playground': 'leisure/playground',
  'leisure.picnic.picnic_site': 'leisure/picnic_site',
  'leisure.picnic.picnic_table': 'leisure/picnic_table',
  'leisure.picnic.bbq': 'leisure/bbq',
  'leisure.spa': 'leisure/spa',
  'leisure.spa.public_bath': 'leisure/public_bath',
  'leisure.spa.sauna': 'leisure/sauna',
  'leisure.park.garden': 'leisure/garden',
  'leisure.park.nature_reserve': 'leisure/nature_reserve',

  // Sport
  'sport.sports_centre': 'leisure/sports_centre',
  'sport.fitness.fitness_centre': 'leisure/fitness_centre',
  'sport.swimming_pool': 'leisure/swimming_pool',
  'sport.golf': 'leisure/golf_course',
  'sport.stadium': 'leisure/stadium',
  'sport.dive_centre': 'leisure/dive_centre',
  'sport.horse_riding': 'leisure/horse_riding',
  'sport.ice_rink': 'leisure/ice_rink',
  'sport.pitch': 'leisure/pitch',
  'sport.track': 'leisure/track',

  // Public Transport
  'public_transport.train': 'railway/station',
  'public_transport.subway': 'railway/subway',
  'public_transport.tram': 'railway/tram',
  'public_transport.light_rail': 'railway/light_rail',
  'public_transport.monorail': 'railway/monorail',
  'public_transport.funicular': 'railway/funicular',
  'public_transport.bus': 'amenity/bus_station',
  'public_transport.ferry': 'amenity/ferry_terminal',
  'public_transport.aerialway': 'aerialway/station',

  // Religion
  'religion.place_of_worship': 'amenity/place_of_worship',
  'religion.place_of_worship.christianity': 'amenity/church',
  'religion.place_of_worship.islam': 'amenity/mosque',
  'religion.place_of_worship.judaism': 'amenity/synagogue',
  'religion.place_of_worship.multifaith': 'amenity/temple',
  'tourism.sights.monastery': 'amenity/monastery',

  // Natural
  beach: 'natural/beach',
  'natural.forest': 'natural/forest',
  'natural.water': 'natural/water',
  'natural.water.spring': 'natural/spring',
  'natural.water.reef': 'natural/reef',
  'natural.water.hot_spring': 'natural/hot_spring',
  'natural.water.geyser': 'natural/geyser',
  'natural.water.sea': 'natural/sea',
  'natural.mountain': 'natural/mountain',
  'natural.mountain.peak': 'natural/peak',
  'natural.mountain.glacier': 'natural/glacier',
  'natural.mountain.cliff': 'natural/cliff',
  'natural.mountain.rock': 'natural/rock',
  'natural.mountain.cave_entrance': 'natural/cave_entrance',
  'natural.sand': 'natural/sand',
  'natural.sand.dune': 'natural/dune',
  'natural.protected_area': 'natural/protected_area',

  // Man Made
  'man_made.pier': 'man_made/pier',
  'man_made.breakwater': 'man_made/breakwater',
  'man_made.tower': 'man_made/tower',
  'man_made.water_tower': 'man_made/water_tower',
  'man_made.bridge': 'man_made/bridge',
  'man_made.lighthouse': 'man_made/lighthouse',
  'man_made.windmill': 'man_made/windmill',
  'man_made.watermill': 'man_made/watermill',

  // Office
  'office.government': 'office/government',
  'office.company': 'office/company',
  'office.estate_agent': 'office/estate_agent',
  'office.insurance': 'office/insurance',
  'office.lawyer': 'office/lawyer',
  'office.telecommunication': 'office/telecommunication',
  'office.educational_institution': 'office/educational_institution',
  'office.association': 'office/association',
  'office.non_profit': 'office/non_profit',
  'office.diplomatic': 'office/diplomatic',
  'office.it': 'office/it',
  'office.accountant': 'office/accountant',
  'office.employment_agency': 'office/employment_agency',
  'office.religion': 'office/religion',
  'office.research': 'office/research',
  'office.architect': 'office/architect',
  'office.financial': 'office/financial',
  'office.tax_advisor': 'office/tax_advisor',
  'office.advertising_agency': 'office/advertising_agency',
  'office.notary': 'office/notary',
  'office.newspaper': 'office/newspaper',
  'office.political_party': 'office/political_party',
  'office.logistics': 'office/logistics',
  'office.energy_supplier': 'office/energy_supplier',
  'office.travel_agent': 'office/travel_agent',
  'office.financial_advisor': 'office/financial_advisor',
  'office.consulting': 'office/consulting',
  'office.foundation': 'office/foundation',
  'office.coworking': 'office/coworking',
  'office.water_utility': 'office/water_utility',
  'office.forestry': 'office/forestry',
  'office.charity': 'office/charity',
  'office.security': 'office/security',

  // Power
  'power.generator': 'power/generator',
  'power.line': 'power/line',
  'power.minor_line': 'power/minor_line',
  'power.plant': 'power/plant',
  'power.substation': 'power/substation',
  'power.transformer': 'power/transformer',

  // Production
  'production.factory': 'industrial/factory',
  'production.winery': 'craft/winery',
  'production.brewery': 'craft/brewery',
  'production.cheese': 'craft/cheese',
  'production.pottery': 'craft/pottery',

  // Rental
  'rental.car': 'amenity/car_rental',
  'rental.storage': 'amenity/storage',
  'rental.bicycle': 'amenity/bicycle_rental',
  'rental.boat': 'amenity/boat_rental',
  'rental.ski': 'amenity/ski_rental',

  // Tourism
  'tourism.information': 'tourism/information',
  'tourism.information.office': 'tourism/information/office',
  'tourism.information.map': 'tourism/information/map',
  'tourism.information.ranger_station': 'tourism/information/ranger_station',
  'tourism.attraction.artwork': 'tourism/attraction/artwork',
  'tourism.attraction.viewpoint': 'tourism/attraction/viewpoint',
  'tourism.attraction.fountain': 'tourism/attraction/fountain',
  'tourism.attraction.clock': 'tourism/attraction/clock',
  'tourism.sights.place_of_worship': 'tourism/sights/place_of_worship',
  'tourism.sights.place_of_worship.church': 'tourism/sights/church',
  'tourism.sights.place_of_worship.chapel': 'tourism/sights/chapel',
  'tourism.sights.place_of_worship.cathedral': 'tourism/sights/cathedral',
  'tourism.sights.place_of_worship.mosque': 'tourism/sights/mosque',
  'tourism.sights.place_of_worship.synagogue': 'tourism/sights/synagogue',
  'tourism.sights.place_of_worship.temple': 'tourism/sights/temple',
  'tourism.sights.place_of_worship.shrine': 'tourism/sights/shrine',
  'tourism.sights.city_hall': 'tourism/sights/city_hall',
  'tourism.sights.conference_centre': 'tourism/sights/conference_centre',
  'tourism.sights.lighthouse': 'tourism/sights/lighthouse',
  'tourism.sights.windmill': 'tourism/sights/windmill',
  'tourism.sights.tower': 'tourism/sights/tower',
  'tourism.sights.battlefield': 'tourism/sights/battlefield',
  'tourism.sights.fort': 'tourism/sights/fort',
  'tourism.sights.castle': 'tourism/sights/castle',
  'tourism.sights.ruines': 'tourism/sights/ruins',
  'tourism.sights.archaeological_site': 'tourism/sights/archaeological_site',
  'tourism.sights.city_gate': 'tourism/sights/city_gate',
  'tourism.sights.bridge': 'tourism/sights/bridge',
  'tourism.sights.memorial': 'tourism/sights/memorial',

  // Camping
  'camping.camp_site': 'tourism/camp_site',
  'camping.caravan_site': 'tourism/caravan_site',

  // Amenity
  'amenity.toilet': 'amenity/toilet',
  'amenity.drinking_water': 'amenity/drinking_water',
  'amenity.give_box': 'amenity/give_box',

  // Beach
  'beach.beach_resort': 'tourism/beach_resort',

  // Adult
  'adult.nightclub': 'amenity/nightclub',
  'adult.stripclub': 'amenity/stripclub',
  'adult.casino': 'amenity/casino',
  'adult.adult_gaming_centre': 'amenity/adult_gaming_centre',

  // Building
  'building.residential': 'building/residential',
  'building.commercial': 'building/commercial',
  'building.industrial': 'building/industrial',
  'building.office': 'building/office',
  'building.catering': 'building/catering',
  'building.healthcare': 'building/healthcare',
  'building.university': 'building/university',
  'building.college': 'building/college',
  'building.dormitory': 'building/dormitory',
  'building.school': 'building/school',
  'building.driving_school': 'building/driving_school',
  'building.kindergarten': 'building/kindergarten',
  'building.public_and_civil': 'building/public',
  'building.sport': 'building/sport',
  'building.spa': 'building/spa',
  'building.place_of_worship': 'building/place_of_worship',
  'building.holiday_house': 'building/holiday_house',
  'building.accommodation': 'building/accommodation',
  'building.tourism': 'building/tourism',
  'building.transportation': 'building/transportation',
  'building.military': 'building/military',
  'building.service': 'building/service',
  'building.facility': 'building/facility',
  'building.garage': 'building/garage',
  'building.parking': 'building/parking',
  'building.toilet': 'building/toilet',
  'building.prison': 'building/prison',
  'building.entertainment': 'building/entertainment',
  'building.historic': 'building/historic',

  // Ski
  'ski.lift.chair_lift': 'aerialway/chair_lift',
  'ski.lift.gondola': 'aerialway/gondola',
  'ski.lift.cable_car': 'aerialway/cable_car',
  'ski.lift.tow_line': 'aerialway/drag_lift',
  'ski.lift.magic_carpet': 'aerialway/magic_carpet',

  // Highway
  'highway.residential': 'highway/residential',
  'highway.public': 'highway/public',
  'highway.service': 'highway/service',
  'highway.track': 'highway/track',
  'highway.footway': 'highway/footway',
  'highway.busway': 'highway/busway',
  'highway.cycleway': 'highway/cycleway',
  'highway.pedestrian': 'highway/pedestrian',
  'highway.path': 'highway/path',
  'highway.living_street': 'highway/living_street',
  'highway.primary': 'highway/primary',
  'highway.primary.link': 'highway/primary_link',
  'highway.secondary': 'highway/secondary',
  'highway.secondary.link': 'highway/secondary_link',
  'highway.tertiary': 'highway/tertiary',
  'highway.tertiary.link': 'highway/tertiary_link',
  'highway.trunk': 'highway/trunk',
  'highway.trunk.link': 'highway/trunk_link',
  'highway.motorway': 'highway/motorway',
  'highway.motorway.junction': 'highway/motorway_junction',
  'highway.motorway.link': 'highway/motorway_link',

  // Administrative
  administrative: 'boundary/administrative',

  // Postal Code
  postal_code: 'postal_code',

  // Political
  political: 'political',

  // Low Emission Zone
  low_emission_zone: 'low_emission_zone',

  // Populated Place
  'populated_place.hamlet': 'place/hamlet',
  'populated_place.village': 'place/village',
  'populated_place.neighbourhood': 'place/neighbourhood',
  'populated_place.suburb': 'place/suburb',
  'populated_place.town': 'place/town',
  'populated_place.city': 'place/city',
  'populated_place.county': 'place/county',
  'populated_place.municipality': 'place/municipality',
  'populated_place.district': 'place/district',
  'populated_place.region': 'place/region',
  'populated_place.state': 'place/state',
  'populated_place.province': 'place/province',

  // Heritage
  heritage: 'heritage',
  'heritage.unesco': 'heritage/unesco',

  // Pet
  'pet.dog_park': 'leisure/dog_park',
}

// Create reverse mapping for efficient bi-directional lookup
const OSM_TO_GEOAPIFY_MAPPING: Record<string, string> = {}
for (const [category, presetId] of Object.entries(GEOAPIFY_TO_OSM_MAPPING)) {
  OSM_TO_GEOAPIFY_MAPPING[presetId] = category
}

/**
 * Get Geoapify category for an OSM preset ID
 * @param presetId OSM preset ID (e.g., 'amenity/restaurant')
 * @returns Geoapify category string or null if not found
 */
export function getGeoapifyCategory(presetId: string): string | null {
  return OSM_TO_GEOAPIFY_MAPPING[presetId] || null
}

/**
 * Get OSM preset ID from Geoapify category
 * @param category Geoapify category string (e.g., 'catering.restaurant')
 * @returns OSM preset ID or null if not found
 */
export function getPresetFromGeoapifyCategory(category: string): string | null {
  return GEOAPIFY_TO_OSM_MAPPING[category] || null
}

/**
 * Get all supported OSM preset IDs for Geoapify
 * @returns Array of supported preset IDs
 */
export function getSupportedGeoapifyPresets(): string[] {
  return Object.values(GEOAPIFY_TO_OSM_MAPPING)
}

/**
 * Get all supported Geoapify categories
 * @returns Array of supported category strings
 */
export function getSupportedGeoapifyCategories(): string[] {
  return Object.keys(GEOAPIFY_TO_OSM_MAPPING)
}

/**
 * Check if a preset ID is supported by Geoapify
 * @param presetId OSM preset ID to check
 * @returns true if supported, false otherwise
 */
export function isGeoapifyPresetSupported(presetId: string): boolean {
  return presetId in OSM_TO_GEOAPIFY_MAPPING
}

/**
 * Check if a Geoapify category is supported (has OSM mapping)
 * @param category Geoapify category to check
 * @returns true if supported, false otherwise
 */
export function isGeoapifyCategorySupported(category: string): boolean {
  return category in GEOAPIFY_TO_OSM_MAPPING
}
