/**
 * Cities whose street grids are rigidly aligned to a single bearing offset from
 * true north. When the map is centered over one of these and the "snap to street
 * grid" setting is on, releasing a rotation gesture within a few degrees of a
 * grid-aligned bearing snaps the map to it — the same way Mapbox snaps to
 * north-up by default.
 *
 * `bearing` is the grid's rotation in degrees clockwise from true north. A
 * square grid has 4-fold rotational symmetry, so the snap logic folds this
 * mod 90 and also matches the 90°-rotated orientations (see `gridOrientations`)
 * — values may therefore be given as any of the four equivalents (e.g. Boston's
 * grid reads 340°, the same grid as 70°).
 *
 * `center`/`radiusKm` bound where the lock is active. Many entries are downtown
 * cores tilted relative to a cardinal surrounding grid, so their radii are kept
 * small; uniformly-gridded cities (Manhattan, Buenos Aires, Sapporo…) use
 * larger radii.
 *
 * Bearings were verified by measuring the azimuth of long, straight grid streets
 * from OpenStreetMap way geometry (cross-checked against a perpendicular street
 * and documented sources where available). Cities whose cores measured as
 * essentially cardinal (Kansas City, Omaha, Christchurch) or have no single
 * coherent grid (Valparaíso) were dropped — the north-up snap already covers
 * cardinal grids. A few entries that survive are only slightly off cardinal
 * (Baltimore, Calgary, Adelaide, Buenos Aires ≈ 3°).
 */
export interface GriddedCity {
  name: string
  center: { lng: number; lat: number }
  /** Grid rotation, degrees clockwise from true north. */
  bearing: number
  /** Activation radius from `center`, in kilometers. */
  radiusKm: number
}

export const GRIDDED_CITIES: GriddedCity[] = [
  // United States
  {
    name: 'New York (Manhattan), NY',
    center: { lng: -73.9712, lat: 40.7831 },
    bearing: 29,
    radiusKm: 10,
  },
  {
    name: 'St. Louis, MO',
    center: { lng: -90.1994, lat: 38.627 },
    bearing: 16,
    radiusKm: 3,
  },
  {
    name: 'Detroit (Downtown), MI',
    center: { lng: -83.0458, lat: 42.3314 },
    bearing: 330,
    radiusKm: 3,
  },
  {
    name: 'Los Angeles (Downtown), CA',
    center: { lng: -118.2468, lat: 34.0407 },
    bearing: 37,
    radiusKm: 3,
  },
  {
    name: 'San Francisco (SoMa), CA',
    center: { lng: -122.3972, lat: 37.7785 },
    bearing: 45,
    radiusKm: 2.5,
  },
  {
    name: 'Seattle (Downtown), WA',
    center: { lng: -122.3344, lat: 47.605 },
    bearing: 328,
    radiusKm: 2.5,
  },
  {
    name: 'Baltimore (Downtown), MD',
    center: { lng: -76.6122, lat: 39.2904 },
    bearing: 357,
    radiusKm: 3,
  },
  {
    name: 'New Orleans (French Quarter), LA',
    center: { lng: -90.0648, lat: 29.958 },
    bearing: 38,
    radiusKm: 1.5,
  },
  {
    name: 'Denver (Downtown), CO',
    center: { lng: -104.9903, lat: 39.7447 },
    bearing: 45,
    radiusKm: 2.5,
  },
  {
    name: 'Minneapolis (Downtown), MN',
    center: { lng: -93.265, lat: 44.9778 },
    bearing: 31,
    radiusKm: 2.5,
  },
  {
    name: 'Dallas (Downtown), TX',
    center: { lng: -96.7977, lat: 32.7791 },
    bearing: 346,
    radiusKm: 2.5,
  },
  {
    name: 'Savannah (Historic), GA',
    center: { lng: -81.0913, lat: 32.0746 },
    bearing: 18,
    radiusKm: 1.5,
  },
  {
    name: 'Austin (Downtown), TX',
    center: { lng: -97.7431, lat: 30.2672 },
    bearing: 18,
    radiusKm: 2.5,
  },
  {
    name: 'Oakland (Downtown), CA',
    center: { lng: -122.2711, lat: 37.8044 },
    bearing: 26,
    radiusKm: 2,
  },
  {
    name: 'Tacoma (Downtown), WA',
    center: { lng: -122.4443, lat: 47.2529 },
    bearing: 351,
    radiusKm: 2,
  },
  {
    name: 'Pittsburgh (Golden Triangle), PA',
    center: { lng: -80.0007, lat: 40.4406 },
    bearing: 27,
    radiusKm: 1.5,
  },
  {
    name: 'Cincinnati (Downtown), OH',
    center: { lng: -84.5125, lat: 39.1014 },
    bearing: 349,
    radiusKm: 2,
  },
  {
    name: 'Philadelphia, PA',
    center: { lng: -75.1652, lat: 39.9526 },
    bearing: 9,
    radiusKm: 4,
  },
  {
    name: 'Boston (Back Bay), MA',
    center: { lng: -71.081, lat: 42.3503 },
    bearing: 340,
    radiusKm: 1.5,
  },
  {
    name: 'Portland (Downtown), OR',
    center: { lng: -122.6742, lat: 45.5202 },
    bearing: 21,
    radiusKm: 2.5,
  },
  {
    name: 'Milwaukee (Downtown), WI',
    center: { lng: -87.9065, lat: 43.0389 },
    bearing: 356,
    radiusKm: 2.5,
  },
  {
    name: 'Sacramento (Downtown), CA',
    center: { lng: -121.4944, lat: 38.5816 },
    bearing: 19,
    radiusKm: 2.5,
  },
  {
    name: 'Cleveland (Downtown), OH',
    center: { lng: -81.6944, lat: 41.4993 },
    bearing: 328,
    radiusKm: 2,
  },
  {
    name: 'Columbus (Downtown), OH',
    center: { lng: -82.9988, lat: 39.9612 },
    bearing: 352,
    radiusKm: 2.5,
  },
  {
    name: 'Louisville (Downtown), KY',
    center: { lng: -85.7585, lat: 38.2527 },
    bearing: 8,
    radiusKm: 2.5,
  },
  {
    name: 'Richmond (Downtown), VA',
    center: { lng: -77.436, lat: 37.5407 },
    bearing: 37,
    radiusKm: 2,
  },
  {
    name: 'Buffalo (Downtown), NY',
    center: { lng: -78.8784, lat: 42.8864 },
    bearing: 13,
    radiusKm: 2,
  },

  // Canada
  {
    name: 'Toronto, ON',
    center: { lng: -79.3832, lat: 43.6532 },
    bearing: 343,
    radiusKm: 6,
  },
  {
    name: 'Montreal, QC',
    center: { lng: -73.5673, lat: 45.5017 },
    bearing: 33,
    radiusKm: 3,
  },
  {
    name: 'Halifax, NS',
    center: { lng: -63.5752, lat: 44.6488 },
    bearing: 340,
    radiusKm: 1.5,
  },
  {
    name: 'Vancouver (Downtown), BC',
    center: { lng: -123.1187, lat: 49.282 },
    bearing: 45,
    radiusKm: 2,
  },
  {
    name: 'Calgary (Downtown), AB',
    center: { lng: -114.0719, lat: 51.0447 },
    bearing: 3,
    radiusKm: 2.5,
  },

  // Australia & New Zealand
  {
    name: 'Melbourne (Hoddle Grid), VIC',
    center: { lng: 144.9631, lat: -37.8136 },
    bearing: 340,
    radiusKm: 2,
  },
  {
    name: 'Adelaide, SA',
    center: { lng: 138.6007, lat: -34.9285 },
    bearing: 357,
    radiusKm: 2.5,
  },
  {
    name: 'Hobart, TAS',
    center: { lng: 147.3272, lat: -42.8821 },
    bearing: 43,
    radiusKm: 1.5,
  },
  {
    name: 'Wellington (Te Aro), NZ',
    center: { lng: 174.7787, lat: -41.2924 },
    bearing: 23,
    radiusKm: 1.5,
  },

  // Europe
  {
    name: 'Barcelona (Eixample), Spain',
    center: { lng: 2.162, lat: 41.3915 },
    bearing: 45,
    radiusKm: 3,
  },
  {
    name: 'Mannheim, Germany',
    center: { lng: 8.466, lat: 49.4875 },
    bearing: 31,
    radiusKm: 1.5,
  },
  {
    name: 'Helsinki (Kamppi), Finland',
    center: { lng: 24.932, lat: 60.168 },
    bearing: 325,
    radiusKm: 1.5,
  },

  // Latin America
  {
    name: 'La Plata, Argentina',
    center: { lng: -57.9545, lat: -34.9215 },
    bearing: 42,
    radiusKm: 3.5,
  },
  {
    name: 'Buenos Aires, Argentina',
    center: { lng: -58.3816, lat: -34.6037 },
    bearing: 357,
    radiusKm: 6,
  },

  // Africa & Asia
  {
    name: 'Mogadishu, Somalia',
    center: { lng: 45.3182, lat: 2.0469 },
    bearing: 341,
    radiusKm: 2,
  },
  {
    name: 'Sapporo, Japan',
    center: { lng: 141.3545, lat: 43.0618 },
    bearing: 350,
    radiusKm: 5,
  },
  {
    name: 'Cape Town (City Bowl), South Africa',
    center: { lng: 18.418, lat: -33.9249 },
    bearing: 42,
    radiusKm: 2,
  },
]
