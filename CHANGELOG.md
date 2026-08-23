## [Unreleased]

### Added

* Canvases — your own maps, in a new tab of your library. A canvas is a stack of layers you assemble: imagery or data you style yourself, layers borrowed from your library, and collections of saved places drawn as points. Switch a canvas on and it draws over the basemap like anything else; open it and it takes over the panel beside the map so you can arrange it against the map itself
* A canvas is either shareable or private, and you can change your mind. A shareable one is stored so it can be published with a link one day; a private one is end-to-end encrypted, and only devices holding your recovery key can open it. Switching between them under Canvas details re-packages the whole canvas in one go — and making one private revokes any public link, since there would be nothing left for that link to show. A device that hasn't imported your recovery key can still make and edit shareable canvases
* A data sources browser for canvases. One half is a curated library of datasets that need no setup — time zones, OpenStreetMap and topographic tiles, elevation, railways, nautical charts — and picking one makes a layer you can restyle. The other half is your own file or a URL. Live database connections (Postgres, BigQuery, Snowflake) are listed but not built yet, and say so
* Bring your own data to a canvas. Drop in a GeoJSON, KML, GPX or CSV file — a CSV just needs latitude and longitude columns — and it lands as a layer, drawn the way its contents suggest: points as dots, tracks as lines, boundaries as filled shapes. Switch any of them to a heatmap, recolour them, resize them, or label each point from one of its own columns. Files are read on your device and stored inside the canvas, so a private canvas can hold imported data the server never sees
* Draw straight onto a canvas, with no layer involved. A toolbar sits over the map for as long as a canvas is open: pins, lines, routes, polygons, rectangles and circles, each on a single-key shortcut. The route tool snaps to the street network as you click, in walking, cycling or driving mode, using the same engine as directions. The shape follows your cursor as you draw — a rubber band to the next point, and rectangles and circles previewed at full size — and an open shape is finished by a double-click or by clicking back on the point you started from. A tool stays picked until you choose another or press Escape, so a run of pins is a run of clicks. Hold Shift to constrain what you are drawing: a line or an edge holds a round angle, a rectangle becomes a square, a circle takes a round radius. Rectangles take three clicks rather than two — a side, then its depth — so one can sit at any angle instead of square to the screen. Whatever you just drew opens for naming straight away, and every mark stays editable afterwards: drag any of its points to reshape it, drag the middle of an edge to add one, double-click a point to take it out, or rename it, recolour it, give a pin its own icon, or keep the name for your own list without printing it on the map — and when you do print it, choose which side of the mark it sits on. Reshaping a route sends it back through the routing engine, so it still follows the streets, and the shape crawls while the answer is on its way. Every mark carries its own measurements, worked out the same way the measure tool works them out — a line's length, a shape's area and perimeter, a circle's radius, circumference and area — with the headline figure beside its name in the list and the rest inside. The route tool is offered only when something is configured that can actually plan one. Marks you make are kept apart from data you brought — they always draw on top, and they're listed under the layer stack rather than in it
* A travel time tool on the canvas: click a point and the area you can reach from it — on foot, by bike, by car or on transit — becomes a mark you can name, recolour and keep, rather than something that vanishes when the tool closes
* Undo and redo across a whole canvas, on ⌘Z and ⌘⇧Z or from the toolbar — layers, marks, names and colours alike. A run of quick edits, like typing a name, steps back as one thing rather than one keystroke at a time. Mid-shape, undo takes back the last point you placed instead
* Canvases can hold a saved route, and a People layer showing friends who are sharing their location with you, live. Nobody's position is ever written into the canvas; the layer only records whose to draw
* Share a canvas by link. Anyone with the link can open it and see its layers on the map without signing in, and revoking the link shuts that off immediately. Only shareable canvases can have one — a private canvas has nothing the server could show a visitor, and making a canvas private revokes its link on the spot
* A rebuilt layer editor. Building a layer now happens in the panel beside the map rather than in a dialog on top of it, and the layer is drawn as you work — a colour, a line width or a zoom cutoff is judged against the map you will actually see it on. It covers every kind of source: raster imagery, elevation, vector tiles, GeoJSON pasted straight in, and single images pinned to four corners. Style properties are laid out by what they draw — Stroke, Shape, Icon, Label — and anything you have not set shows its default rather than being written into your layer
* The map flies to a layer's data the first time it loads. Point a layer at a council's aerial imagery or paste a list of trailheads and you land on it, instead of hunting for it from wherever you happened to be. Pasted GeoJSON also picks its own renderer from what's in it — points draw as circles, lines as lines — so a layer never comes up blank because it was pointed at the wrong one
* Layers can be imported from a Mapbox Studio or Maputnik style. Paste the style, pick a layer from it, and it opens in the editor with its source attached. Anything that will not travel — a Mapbox-hosted source, sprite images or fonts from the original style — is called out before you import rather than after it renders nothing
* Photos on a place open full size. Tapping one in the strip grows it out of the thumbnail into a full screen viewer you can pinch to zoom into, drag around and swipe between, and flick away to close. Until now the strip was all there was — you could scroll past a photo but never actually look at it
* A layer store, reached from the Layers tab of your library. It holds every ready-made layer Parchment ships with, so anything you delete can be added back — there is no separate "restore defaults" any more. Terrain, Time Zones, Air Quality, Wildfires and OSM Notes now start out in the store rather than in your library, so a fresh library only carries what most people want on the map

### Changed

* Parchment's own layers are no longer editable. Many of them are more than a block of map styling — transit stops you can tap for departures, friends moving around live, the day and night terminator — and opening them in the layer editor exposed settings that could not describe what they actually do. They can still be reordered, regrouped, toggled and deleted; the store puts back anything you remove
* Taking over one of Parchment's layers to make your own copy is gone, along with the copies-and-originals bookkeeping behind it. Layers you built yourself are untouched
* Deleting one of Parchment's layer groups now takes the layers inside it too, instead of scattering them across the top of your library. Adding the group back from the store brings the whole set with it. Your own layers filed inside such a group are moved out rather than deleted
* OSM notes are now a layer like any other: it sits in your library, reorders with everything else, and its place in the layer selector follows the order you set — rather than being pinned to the bottom of the list

* One picker, everywhere something can be recoloured — a pin, a collection, a layer's styling, a mark on a canvas. They all now open the same icon and colour picker over the same palette, so picking teal means the same teal wherever you pick it. Anything the palette doesn't cover can be typed in as a colour value, or taken straight off the screen with an eyedropper where the browser has one

### Fixed

* Escape works again in views that bind it alongside another. Several parts of the app listen for Escape at once, and closing any one of them quietly took the others' handling with it — so Escape could stop dismissing a panel until the page was reloaded

## [0.6.0] - 2026-08-18

### Added

* A WiFi shortcut in the search palette. It isn't a kind of place — it browses everywhere carrying free wireless, so cafes, libraries and hotels all turn up
* Service alerts from the transit agency, wherever they affect you: on a line, on a stop's departure board, and on the legs of a planned trip. A detour, a suspension or a lift out of service now shows up in the app instead of sending you to the agency's website. They read as a row of small cards you swipe through rather than a wall of text — what is actually happening now comes first, scheduled overnight work is counted off to the side, and tapping one opens the agency's full wording
* Twenty-five more browse shortcuts: train stations, airports, places of worship, schools, childcare, ice cream, dentists, urgent care, beauty salons, laundry, car wash, car rental, pet stores, farmers markets, dog parks, public art, viewpoints, nature reserves, beaches, picnic areas, fountains, showers, public bookcases, outdoor gyms and bike repair stations

### Changed

* Right-clicking the map shows the place's own icon, in its category colour, instead of a generic pin — a cafe reads as a cafe before you open it
* The search palette opens instantly. It used to wait on your recent searches — which are encrypted, so they have to be fetched and unlocked first — before drawing anything at all, leaving the first open of a session on a spinner. Your shortcuts and frequent places now appear immediately and recents drop in as they arrive
* "Bus Stops" is now "Transit", and covers tram and rail platforms alongside buses
* Searching "wifi" finds the category under that name rather than "Wi-Fi Hotspot", and bike repair stands are called that instead of "Bicycle Repair Tool Stand" — both in search and on the place itself. Searching "bike repair stand", "repair stand", "outdoor gym" or "calisthenics" now finds the right category too
* Recents on the Library home no longer stop at five — the list starts with ten and keeps loading more as you scroll
* Departure boards now cover the next three hours, with a "Show later departures" button for the rest of the day. The board used to be sized by a fixed number of runs rather than by time, which meant it showed barely the next 45 minutes at a busy subway platform and five hours at a ferry landing — and at a stop that had shut for the night, nothing at all
* A transit leg is now drawn on the trip's own timeline rather than in a card beside it. The line runs straight through the card — the stop you board at, every stop along the way and the stop you get off at are dots on the same line as the rest of the journey, instead of a second timeline nested inside the first
* Departures on another day now say which day. A run more than a couple of hours out shows its clock time instead of an ever-growing "10h 21m", and the first run of each new day is marked. A tram at 1:45 AM that still belongs to tonight's timetable reads "Tonight" rather than "Tomorrow" — the timetable's own service day decides, not the calendar. A stop closed for the night now says so above its next day's departures

### Fixed

* Recents on the Library home now include your searches, not just the places you opened. A category or brand you browsed showed up in the search palette's recents but was missing from the home list — the two now show the same history, newest first, and tapping a search there runs it again
* The "Inside" and "Located in" rows on a place no longer run their first two cards together — every card in the row is evenly spaced
* Opening hours are read properly. Parchment now understands the full OpenStreetMap hours notation instead of a rough approximation of it, and several common ways of writing hours were being read wrongly or thrown away entirely: a place open "08:00-12:00, 13:00-18:00" lost its whole afternoon, hours written as "9:00" rather than "09:00" reported the place shut all morning, and weekend ranges like "Sa-Su" were discarded, leaving no hours at all. Bars and diners that stay open past midnight now stay open on screen until they actually close, rather than flipping to "Closed" at midnight. Places that only open part of the year, keep different hours on public holidays, or open from sunrise to sunset are now read as written
* Hours for a place in another time zone are worked out on that place's clock, and the page now says which clock it is showing — so a shop in Tokyo reads "Open now" while it is the middle of the night where you are, with its local time alongside
* A place whose opening hours are a note rather than a schedule no longer announces itself as open around the clock. "Temporarily closed", "by appointment" and the like have no hours to read, and were being taken as an unbroken week — so a business that had shut its doors advertised itself as open 24 hours. What the mapper actually wrote is now shown in place of an open-or-closed status
* The "Open now" filter judges each place on its own clock. Search results carried no time zone of their own, so filtering a city several hours ahead of you was done against your clock, and could hide places that were open
* Places that have permanently closed now say so instead of showing "Open now". A shut-down business is usually marked in OpenStreetMap by retiring its category — a closed cafe becomes a "disused cafe" — and Parchment only recognised a rarer, separate marking, so most closed places kept advertising the hours they kept when they were trading. The old weekly schedule is no longer shown, closure holds even when the hours came from another listing service, and closed places now sort below everything still open in search
* Aerial tramway, cable car and gondola stations are recognised as transit stations. The Roosevelt Island Tramway rendered as an ordinary building, with no departures and no lines served
* A station's departure board is now that station's departures. Opening the Roosevelt Island Tramway listed mostly Q32, M15 and Q60 buses bound for Penn Station, from stops across the street — a stop standing on the place now claims the board, and its platforms travel with it
* Trams and streetcars are no longer labelled buses. Every tram route in every feed was being read as a bus on the way in, so they carried a bus name and a bus icon throughout the app
* A route with no short name shows its mode rather than an internal number. The Roosevelt Island Tramway wore a green "10092" badge, which is its id in the timetable and means nothing to a rider
* Stations are now matched to the right stop rather than the closest one. A ferry terminal would pick up the bus stop across the street and show its departures under the ferry's name; the same happened at rail stations sitting metres from a bus shelter. The station's own mode is now preferred, and reached for further out — a ferry landing's stop sits at the end of the pier
* A departure weeks away no longer turns up on a board beside trains due in minutes. Where a station's board merges several nearby stops, one seldom-used neighbour could contribute a run from the far side of the timetable
* The departure board has been redesigned around one idea: what the agency tells us and what we merely estimate should never look the same. A run that has departed or been cancelled fades back, because it genuinely isn't an option. A run we only think you might not reach keeps its full weight and just changes colour, because you are often closer to the platform than we can tell. Every departure now sits on the same footprint, so the row reads as one rhythm instead of a ragged line
* Departures that are running late or early now say so. The agency has been publishing the delay all along and we were quietly throwing it away — a live departure now shows its timetabled time struck through beside the real one, so "2:21 2:24" reads at a glance, with the new time tinted when a vehicle is off schedule
* Cancelled departures stay on the board, struck through and clearly labelled, instead of silently disappearing. A train vanishing with no explanation was worse than seeing it was pulled. Parchment won't reroute your later connections onto a cancelled run, but you can still tap one if you know better
* The realtime indicator no longer disappears from a departure you have to hurry for — whether a time is a live prediction and whether you can make it are two different things, and the board now shows both
* "Arrive early" now goes down to zero for riders happy to step straight onto the train, and it finally applies to the departure board: the margin you set is what decides which departures get flagged as a tight connection. It used to be a fixed three minutes there regardless of your preference
* The departure board no longer greys out trains you can plainly catch. It used to hold on to the walking time from when you planned the trip, so a seven-minute walk still read as seven minutes even once you were standing on the platform. The walk now counts down as you approach the stop — from your actual position when location is on, otherwise from the clock — and any departure on the board can be picked, whether it's already gone or looks like a stretch. Those still read as departed or as a "hurry" or "may miss", but they're a hint now, not a lock

## [0.5.11] - 2026-08-03

                      },
                      "transitBufferMinutes": {
                        "minimum": 0,
                        "maximum": 5,
                        "type": "number"
                      },
                      },
                      "transitBufferMinutes": {
                        "minimum": 0,
                        "maximum": 5,
                        "type": "number"
                      },
                      },
                      "transitBufferMinutes": {
                        "minimum": 0,
                        "maximum": 5,
                        "type": "number"
                      },
                      },
                      "transitBufferMinutes": {
                        "minimum": 0,
                        "maximum": 5,
                        "type": "number"
                      },
                      },
                      "transitBufferMinutes": {
                        "minimum": 0,
                        "maximum": 5,
                        "type": "number"
                      },
                      },
                      "transitBufferMinutes": {
                        "minimum": 0,
                        "maximum": 5,
                        "type": "number"
                      },
  maxWalkingDistance: t.Optional(t.Number({ minimum: 0 })),
  maxTransfers: t.Optional(t.Number({ minimum: 0 })),
  transitBufferMinutes: t.Optional(t.Number({ minimum: 0, maximum: 5 })),

  // UI state
  useKnownVehicleLocations: t.Optional(t.Boolean()),
}

/**
 * Display-name overrides for presets whose iD-schema name reads like tagging
 * documentation rather than something a person would look for on a map. Applied
 * wherever a preset is named for a user — the place-type line under a search
 * result, and the browsable category registry (see `category.service`), which
 * also keeps the original wording as a search alias.
 *
 * English only: other locales keep the schema's own translation.
 */
export const PRESET_NAME_OVERRIDES: Record<string, string> = {
  'internet_access/wlan': 'WiFi',
  'amenity/bicycle_repair_station': 'Bike Repair Stand',
}

export function getPresetName(
  preset: PresetDefinition,
  language: Language = 'en-US',
): string {
  if (getLanguageCode(language) === 'en') {
    return PRESET_NAME_OVERRIDES[preset.id] ?? preset.name
  }

  const c = createCache()
      id.startsWith('leisure/picnic_table') ||
      id.startsWith('leisure/firepit') ||
      id.startsWith('tourism/picnic_site') ||
      id.startsWith('amenity/bench') ||
      id.startsWith('amenity/shelter') ||
      id.startsWith('amenity/drinking_water') ||
      id.startsWith('amenity/fountain') ||
      id.startsWith('natural/'),
    category: 'park',
  },
      id.startsWith('amenity/college') ||
      id.startsWith('amenity/library') ||
      id.startsWith('amenity/public_bookcase') ||
      id.startsWith('amenity/kindergarten') ||
      id.startsWith('amenity/childcare') ||
      id.startsWith('amenity/language_school') ||
      id.startsWith('amenity/music_school') ||
      id.startsWith('amenity/driving_school'),
  {
    match: (id) =>
      id.startsWith('shop/') ||
      id.startsWith('amenity/marketplace'),
    category: 'store',
  },

      id.startsWith('amenity/parking') ||
      id.startsWith('amenity/toilets') ||
      id.startsWith('amenity/shower') ||
      id.startsWith('internet_access') ||
      id.startsWith('tourism/hotel') ||
      id.startsWith('tourism/motel') ||
      id.startsWith('tourism/hostel') ||
import { getLanguageCode } from '../lib/i18n'
import { getPlaceCategory, resolveIcon } from '../lib/place-categories'
import { PRESET_NAME_OVERRIDES } from '../lib/osm-presets'
import { logWarn } from '../lib/logger'

/**
  // Cycling
  'amenity/bicycle_parking':  ['bike rack', 'bike racks', 'bike stand', 'bike lock', 'cycle rack', 'bicycle stand', 'bicycle rack', 'cycle parking'],
  'amenity/bicycle_repair_station': ['bike repair', 'bike fix', 'bicycle fix', 'bike tool station', 'bike pump', 'bike repair stand', 'bicycle repair stand', 'repair stand', 'bike tools'],
  'amenity/bicycle_rental':   ['bike hire', 'bike share', 'bikeshare', 'cycle hire'],
  'shop/bicycle':             ['bike shop', 'bike store', 'cycle shop', 'cycling store'],

  'leisure/sports_centre':    ['sports center', 'sports complex', 'recreation center', 'rec center'],
  'leisure/dog_park':         ['off leash area', 'dog run', 'off-leash park'],
  'leisure/fitness_station':  ['outdoor gym', 'exercise station', 'workout station', 'calisthenics', 'pull up bar'],
  'leisure/picnic_table':     ['picnic area', 'picnic spot', 'picnic bench'],
  'leisure/golf_course':      ['golf club', 'golf links', 'driving range'],
  'leisure/stadium':          ['arena', 'sports stadium', 'ballpark', 'amphitheater'],
}


/**
 * Check if two strings are a fuzzy prefix match — one is a prefix of the other
 * and the length difference is small. Handles plurals in any language without
        const aliases: string[] = []

        // Rename the presets whose schema wording doesn't suit a map UI,
        // keeping the original as an alias so it stays searchable.
        const nameOverride =
          apiLang === 'en' ? PRESET_NAME_OVERRIDES[presetId] : undefined
        if (nameOverride && nameOverride !== localizedName) {
          aliases.push(localizedName)
          localizedName = nameOverride
        }

        // Add terms from translations if available
        const translationData = presetTranslations[presetId]
        if (translationData?.terms) {
const SEARCH_BACKSTOP_TIMEOUT = 30_000

/**
 * Radius a sparse tag-only browse widens to (see `searchByCategory`). Metro
 * scale rather than unbounded: the nearest-first walk has to test the tag on
 * each candidate, so the radius is what stops it wandering across a continent.
 */
const TAG_BROWSE_WIDEN_RADIUS_M = 100_000

/**
 * Build an axios instance whose in-flight requests are bounded by `limiter`.
 * Slots are held only for the HTTP round-trip — acquired in the request
   * offset, so pages stay consistent. No total count is computed (a COUNT over a
   * broad category is itself expensive); the client paginates until a short page.
   *
   * `presetId` is empty for an attribute browse (e.g. everywhere with WiFi),
   * which filters on `filterTags` alone. That tier-2 widen keeps a radius: with
   * no category to drive the GIN scan, dropping it would sort every tagged
   * place on the planet by distance.
   */
  async searchByCategory(
    presetId: string,
      lat,
      lng,
      ...(presetId ? { categories: [presetId] } : {}),
      limit,
      ...(offset ? { offset } : {}),
      ...(options?.filterTags ? { tags: options.filterTags } : {}),
    }

    if (!presetId && !options?.filterTags) return []

    // Tier 1: viewport-scoped (bounded radius → KNN).
    let rows: any[] = (await post({ ...baseBody, radius })).data || []

    // Tier 2: widen when the viewport is sparse — omit the radius so barrelman
    // uses the category-index scan (fast even for a thin category), or grow it
    // to metro scale for a tag-only browse, which has no such index to lean on.
    if (rows.length < minResults) {
      const widened = presetId ? baseBody : { ...baseBody, radius: TAG_BROWSE_WIDEN_RADIUS_M }
      rows = (await post(widened)).data || []
    }

    return rows.map((r: any) => this.adaptPlace(r, options?.language))
    })

    test('attribute preset: browses on tags with no category', async () => {
      const cap = setupCapability()
      mockGetCategoryById.mockReturnValue({ tags: { internet_access: 'wlan' } })

      await searchByCategory('internet_access/wlan', { bounds })

      expect(cap.searchByCategory).toHaveBeenCalledWith(
        '',
        bounds,
        expect.objectContaining({ filterTags: { internet_access: 'wlan' } }),
      )
    })

    test('attribute preset with only wildcard tags keeps the category path', async () => {
      const cap = setupCapability()
      mockGetCategoryById.mockReturnValue({ tags: { internet_access: '*' } })

      await searchByCategory('internet_access', { bounds })

      expect(cap.searchByCategory).toHaveBeenCalledWith(
        'internet_access',
        bounds,
        expect.objectContaining({ filterTags: undefined }),
      )
    })

    test('returns empty array when no integration is configured', async () => {
      mockGetConfiguredIntegrations.mockReturnValue([])
      expect(await searchByCategory('amenity/cafe', { bounds })).toEqual([])
}

/**
 * OSM tag keys Barrelman turns into `geo_places.categories` entries — mirrors
 * POI_KEYS in its `import/osm2pgsql-flex.lua`. A preset keyed on anything else
 * describes an attribute a place *has* rather than a kind of place, so it can
 * only be searched as a tag filter.
 */
const CATEGORY_TAG_KEYS = new Set([
  'amenity', 'shop', 'tourism', 'leisure', 'office', 'craft',
  'healthcare', 'social_facility', 'historic', 'man_made',
  'aeroway', 'public_transport', 'emergency', 'place',
  'building', 'natural', 'landuse', 'waterway', 'power',
  'railway', 'highway', 'barrier', 'entrance', 'playground',
  'club', 'gambling', 'advertising', 'cuisine',
])

/**
 * Derive the primary Barrelman category and extra OSM tag filters from a preset ID.
 *
 *   1. Send the parent preset ID as the category filter
 *   2. Pass the additional discriminating tags (cuisine=pizza) as a secondary filter
 *
 * Attribute presets (`internet_access/wlan` — the "WiFi" shortcut) have no
 * category at all: they come back with an empty `categoryId` and browse purely
 * on tags, which finds every cafe, library or hotel carrying the tag.
 */
function derivePresetFilter(presetId: string): {
  categoryId: string
  const presetTags = (preset?.tags || {}) as Record<string, string>

  const tagKeys = Object.keys(presetTags)
  if (tagKeys.length > 0 && !tagKeys.some(key => CATEGORY_TAG_KEYS.has(key))) {
    // Wildcard values can't be matched by JSONB containment. If that's all the
    // preset has, fall through rather than browsing with no filter at all.
    const filterTags = Object.fromEntries(
      Object.entries(presetTags).filter(([, value]) => value !== '*'),
    )
    if (Object.keys(filterTags).length > 0) return { categoryId: '', filterTags }
  }

  const parts = presetId.split('/')
  if (parts.length <= 2) {
    // Top-level preset (e.g. amenity/restaurant) — no extra filtering needed
  maxWalkingDistance?: number // meters
  maxTransfers?: number
  transitBufferMinutes?: number // 0-5, minutes to arrive early at stop

  // UI state
  useKnownVehicleLocations?: boolean
import { useTrackerLocationsLayer } from '@/composables/useTrackerLocationsLayer'
import { useVehiclesStore } from '@/stores/vehicles.store'
import { useRecentsStore } from '@/stores/recents.store'
import { PermissionId } from '@/types/auth.types'
import {
  connect as realtimeConnect,
const trackerLocationsLayer = useTrackerLocationsLayer()
const vehiclesStore = useVehiclesStore()
const recentsStore = useRecentsStore()
const { isMobileScreen } = useResponsive()
const isDev = import.meta.env.DEV
const { openExternalLink } = useExternalLink()
  categoryStore.init()
  categoryPaletteStore.loadPalette()
  // Recents fill the search palette's idle state. Fetching + decrypting them
  // here means opening the palette renders from memory rather than waiting on
  // the encrypted blob.
  void recentsStore.ensureSearchesHydrated()
  void recentsStore.ensurePlacesHydrated()
  // Initialize friend locations layer (watches visibility and polls accordingly)
  // Requires social permissions — skip for free users to avoid 403s
  if (authService.hasPermission(PermissionId.SOCIAL_READ)) {
  >
    <Card
      data-sheet-scroll
      class="bg-muted-light shadow-none overflow-y-auto pointer-events-auto w-full md:w-104 h-full flex flex-col rounded-l-none border-foreground/5 border-l-0 border-y-0 justify-start"
      style="--background: var(--card);"
    >
<script setup lang="ts">
import {
  computed,
  inject,
  ref,
  watch,
  nextTick,
  onMounted,
  onUnmounted,
} from 'vue'
import { storeToRefs } from 'pinia'
import { useDark } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import PresetPlacesRow from '@/components/library/PresetPlacesRow.vue'
import { appEventBus } from '@/lib/eventBus'
import { findScrollAncestor } from '@/lib/scroll'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { PlaceCard } from '@/components/place/card'
})

/**
 * Recents infinite scroll. The E2EE blob is fully decrypted in memory, so
 * "loading more" is just revealing more of the array — pages exist only to
 * keep the initial dashboard render short.
 *
 * The scroll surface belongs to the host sheet, and this listens to it
 * directly — deliberately, because the two tidier-looking options both fail
 * here. A sentinel at the end of the list only enters view on the sheet's very
 * last pixel of scroll, and not at all once the list has trailing padding.
 * `useInfiniteScroll` never binds to a scroll element that resolves after
 * mount, so it sat silent through every scroll in Firefox.
 */
const RECENTS_PAGE_SIZE = 10
const RECENTS_LOAD_MARGIN = 200
const visibleRecentsCount = ref(RECENTS_PAGE_SIZE)
const visibleRecents = computed(() =>
  recentPlaces.value.slice(0, visibleRecentsCount.value),
)
const hasMoreRecents = computed(
  () => visibleRecentsCount.value < recentPlaces.value.length,
)

const rootEl = ref<HTMLElement | null>(null)
let scrollEl: HTMLElement | null = null

/**
 * Reveal the next page once the sheet is scrolled within `RECENTS_LOAD_MARGIN`
 * of its end, then re-check: a page that doesn't make the sheet scrollable
 * would otherwise leave no way to ask for the one after it.
 *
 * Paging a hidden list would page all of it — the palette covers this section,
 * and a covered sheet has nothing to scroll, which reads as "at the end".
 */
function revealMore(margin: number) {
  if (!scrollEl || paletteFocused.value || !hasMoreRecents.value) return
  const remaining =
    scrollEl.scrollHeight - scrollEl.clientHeight - scrollEl.scrollTop
  if (remaining > margin) return
  visibleRecentsCount.value += RECENTS_PAGE_SIZE
  nextTick(() => revealMore(margin))
}

const onSheetScroll = () => revealMore(RECENTS_LOAD_MARGIN)
/** Margin 0, so a sheet the user can already scroll keeps its first page. */
const fillUnscrollableSheet = () => nextTick(() => revealMore(0))

onMounted(() => {
  scrollEl = findScrollAncestor(rootEl.value)
  scrollEl?.addEventListener('scroll', onSheetScroll, { passive: true })
  fillUnscrollableSheet()
})

onUnmounted(() => scrollEl?.removeEventListener('scroll', onSheetScroll))

// Recents decrypt asynchronously, so the list usually lands after mount.
watch(recentPlaces, fillUnscrollableSheet)

const libraryTabs = computed(() => [
  {
    id: 'collections',

<template>
  <!-- min-h-full + shrink-0, never h-full: the sheet is a flex column, so a
       shrinkable child gets squeezed back to the sheet's height while the list
       grows past it. The content then spills out of its own box and every
       trailing padding lands above the last card instead of below it. -->
  <div ref="rootEl" class="flex flex-col min-h-full shrink-0 pb-6">
    <div class="space-y-4 flex-1">
      <!-- Inline command palette -->
      <div class="relative rounded-xl bg-card">
        <div class="space-y-2">
          <PlaceCard
            v-for="place in visibleRecents"
            :key="place.id"
            :display="recentPlaceToDisplay(place, { isDark })"
            variant="row"
import RealtimeIndicator from '@/components/transit/RealtimeIndicator.vue'

/**
 * One card on the board: the run, plus the plain facts about it. The caller
 * describes *what is true*; this component decides how that looks. Nothing
 * here is a gate — every run stays selectable, because the rider knows their
 * own situation better than a walking estimate does.
 */
export interface BoardCard {
  ms: number
  route?: { shortName?: string; color?: string; textColor?: string }
  card: {
    /** Countdown, e.g. "5 min" / "now" / "3m ago". */
    lead: string
    /** Clock time of the run. */
    sub?: string
    /** Timetabled time, when a live prediction has superseded it. */
    scheduledSub?: string
    /** Signed seconds off the timetable (+late / -early). */
    delaySec?: number
    title?: string
    planned?: boolean
    departed?: boolean
    unreachable?: boolean
    hurry?: boolean
    cancelled?: boolean
    live?: boolean
    arriving?: boolean
    clickable?: boolean
 * Glanceable countdown cards for the runs around the planned departure —
 * Transit-app style. Scrolls horizontally through roughly the next hour;
 * tapping a run re-plans the trip around it.
 *
 * ── The visual language ──────────────────────────────────────────────
 * Each channel answers exactly one question, and never borrows another's:
 *
 *   ring      → is this the run you're taking?  (selection, nothing else)
 *   colour    → how does this run stand for you? (one ramp, one resolver)
 *   footnote  → the word for that, or the clock  (one line, one slot)
 *   live dot  → where did that time come from?   (prediction vs schedule)
 *
 * The countdown is the hero, so the *countdown itself* takes the status
 * colour. An earlier pass gave status its own filled badge, which made the
 * metadata louder than the departure time it described and forced every chip
 * to a different width. Colouring the number instead is both quieter and more
 * visible, and it keeps the chips on one grid.
 *
 * Colour is resolved once, in `status()`, so the number and the word beneath
 * it can never disagree — and so no two conditions can both emit a text colour
 * and race on stylesheet order.
 *
 * Strikethrough means one thing only: this time is void or superseded. So a
 * cancelled run's countdown is struck, and a beaten timetable time is struck.
 * A departed run is not — it happened; "3m ago" already says so.
 *
 * The scroll-position bookkeeping lives here rather than in the trip view: it
 * is per-board DOM state (which edge fades to show, and the one-time scroll
const emit = defineEmits<{ choose: [ms: number] }>()

type Card = BoardCard['card']

/** Minutes off schedule worth colouring. Under a minute is timetable noise. */
const DELAY_NOTICE_SEC = 60

/**
 * The single status a run carries, worst news first — a cancelled run has
 * nothing else worth saying, and "probably can't" outranks "only just".
 * Returns the colour too, so the countdown and the word below it are always
 * resolved together and can never disagree.
 */
function status(card: Card): { word: string | null; tone: string } {
  if (card.cancelled) return { word: 'cancelled', tone: 'text-red-600 dark:text-red-400' }
  if (card.departed) return { word: null, tone: 'text-muted-foreground/70' }
  if (card.unreachable) return { word: 'may miss', tone: 'text-orange-600 dark:text-orange-400' }
  if (card.hurry) return { word: 'hurry', tone: 'text-amber-600 dark:text-amber-400' }
  if (card.arriving) return { word: null, tone: 'text-parchment-600 dark:text-parchment-400' }
  return { word: null, tone: '' }
}

/** Gone or pulled — the operator's word, not our guess. Recedes as context. */
function isPast(card: Card) {
  return Boolean(card.departed || card.cancelled)
}

/**
 * The countdown is the loudest thing on the chip, so it carries the status
 * colour itself rather than ceding the job to a badge that would out-shout it.
 * Struck only when the run is void.
 */
function numberClass(card: Card): string {
  const { tone } = status(card)
  if (card.cancelled) return 'line-through text-muted-foreground/70'
  return tone || 'text-foreground'
}

/** Running late reads warm, running early reads cool; on time stays quiet. */
function clockClass(card: Card): string {
  const delay = card.delaySec ?? 0
  if (delay >= DELAY_NOTICE_SEC) return 'text-red-600 dark:text-red-400'
  if (delay <= -DELAY_NOTICE_SEC) return 'text-sky-600 dark:text-sky-400'
  return 'text-muted-foreground'
}

const scroller = ref<HTMLElement | null>(null)
const edges = ref({ start: false, end: false })
/** The scroll-past-departed nudge is one-shot; refreshes must not re-yank. */

/**
 * Put the first comfortably catchable run at the left edge, leaving a sliver
 * of the past as a scroll-back hint. They stay reachable by scrolling; this
 * only picks the resting position. When nothing is reachable (rider still far
 * out) fall back to the first upcoming run, so the board never rests on a wall
 * of departed cards.
 */
function scrollToFirstAvailable(el: HTMLElement, cards: BoardCard[]) {
  let first = cards.findIndex(c => !c.card.departed && !c.card.unreachable)
  if (first < 0) first = cards.findIndex(c => !c.card.departed)
  if (first <= 0) return
  const button = el.children[first] as HTMLElement | undefined
  if (!button) return
      @scroll="onScroll"
    >
      <!-- Every chip is the same fixed width and the same three rows —
           identity, time, footnote — so the board reads as a rhythm and the
           eye can scan straight down one column. The border is transparent
           rather than absent so selecting a run doesn't shift the row by 2px. -->
      <button
        v-for="item in cards"
        :key="item.ms"
        type="button"
        class="shrink-0 w-[78px] flex flex-col items-center justify-center gap-1.5 px-2 py-2.5 rounded-xl border-2 border-transparent bg-muted/40 text-center tabular-nums transition-colors cursor-pointer hover:bg-muted/70"
        :class="[
          item.card.planned && !lineColor && 'border-parchment-500',
          busy && 'opacity-50 pointer-events-none',
        ]"
        :style="item.card.planned && lineColor ? { borderColor: `#${lineColor}` } : {}"
        :title="item.card.title"
        :aria-label="item.card.title"
        @click="item.card.clickable && emit('choose', item.ms)"
      >
        <!-- Identity: which train this is, and whether its time is live. Past
             runs fade the bullet on its own rather than under a blanket card
             opacity, which would desaturate the line colour into mud. -->
        <div class="flex items-center justify-center gap-1 leading-none h-[22px]">
          <RouteBullet
            v-if="item.route?.shortName ?? lineName"
            size="sm"
            :color="item.route ? item.route.color : lineColor"
            :text-color="item.route ? item.route.textColor : lineTextColor"
            :class="isPast(item.card) && 'opacity-45'"
          />
          <RealtimeIndicator
            v-if="item.card.live"
            :real-time="true"
            :class="!isPast(item.card) && 'animate-pulse'"
          />
        </div>

        <!-- When it goes — the hero, and the element that carries the status
             colour. Nothing is allowed to be louder than this. -->
        <div
          data-testid="countdown"
          class="text-[15px] font-semibold leading-none whitespace-nowrap"
          :class="numberClass(item.card)"
        >{{ item.card.lead }}</div>

        <!-- One footnote slot, in priority order: what's wrong with this run,
             else the timetable it beat, else just the clock. Keeping it to a
             single line is what lets every chip share one width. -->
        <div data-testid="footnote" class="text-[10px] leading-none whitespace-nowrap">
          <span
            v-if="status(item.card).word"
            class="font-semibold"
            :class="status(item.card).tone"
          >{{ status(item.card).word }}</span>
          <template v-else-if="item.card.sub">
            <span
              v-if="item.card.scheduledSub"
              class="line-through text-muted-foreground/50 mr-0.5"
            >{{ item.card.scheduledSub }}</span><span
              :class="clockClass(item.card)"
            >{{ item.card.sub }}</span>
          </template>
        </div>
      </button>
    </div>

import { CommandName, useCommandStore } from '@/stores/command.store'
import { useAppStore } from '@/stores/app.store'
import { useRecentsStore } from '@/stores/recents.store'
import { HotkeyId } from '@/stores/hotkey.store'
import { AppRoute } from '@/router'
import {
}

// The idle search state renders before recents have been fetched and decrypted
// (see the empty-query branch in command.store), so the list is rebuilt once
// they arrive. Only while the input is empty: with a query typed, the options
// come from a server search that shouldn't be re-issued for this.
const recentsStore = useRecentsStore()
watch(
  () => [recentsStore.searches, recentsStore.places],
  () => {
    if (isSearch.value && !query.value && activeArgument.value) {
      loadArgumentOptions()
    }
  },
)

// Watch for command/argument changes to load options
watch(activeArgument, async newArg => {
  if (newArg) {
import type { Place } from '@/types/place.types'
import { useAppService } from '@/services/app.service'
import { findScrollAncestor } from '@/lib/scroll'
import { Skeleton, SkeletonText } from '@/components/ui/skeleton'

import PlaceHeader from './header/PlaceHeader.vue'
let stuckRaf = 0

// Stuck exactly when the bar can rise no higher than its docked line — not
// merely when scrolling begins.
function measureStuck() {
  const bar = tabBarRef.value
  if (!bar) return
  scrollRootEl = findScrollAncestor(bar)
  scrollRootEl?.addEventListener('scroll', onRootScroll, { passive: true })
  measureStuck()
}
import { ref, watch, onMounted, nextTick } from 'vue'
import { provideSheetPage } from '@/composables/useSheetPage'
import { findScrollAncestor } from '@/lib/scroll'

// Stack lifecycle and route reconciliation (path-change clears, view-query
// sync) are owned by the composable now — see `provideSheetPage`.
const scrollStack: number[] = []

onMounted(() => {
  // includeHidden: this only ever sets scrollTop itself, and a collapsed
  // sheet's container is overflow-hidden yet still scrolls programmatically.
  scrollAncestor = findScrollAncestor(hostRef.value, { includeHidden: true })
})

watch(depth, (newDepth, oldDepth) => {
const hasMore = computed(() => relatedData.value.hasMore ?? false)

function parentToPlace(parent: RelatedParent): Place {
  return {
    id: parent.id,
}

// Compact preview: up to 3 children, or every parent/admin ancestor
const previewItems = computed<Place[]>(() =>
  strategy.value === 'children'
    ? children.value.slice(0, 3)
    : parents.value.map(parentToPlace),
)

// Each related strategy (parent / children / admin) becomes its own tab so
// multiple related sections don't collide.
const tabId = computed(() => `related:${strategy.value}`)
    />

    <!-- Horizontal scroll preview, bleeding to the panel edges -->
    <div class="ml-[-0.75rem] mr-[-0.75rem] w-[calc(100%+1.5rem)] relative">
      <div
        class="w-full overflow-x-auto touch-pan-x snap-x snap-mandatory flex gap-3 scroll-px-3 scrollbar-hidden [&>*:first-child]:ml-3 [&>*:last-child]:mr-3"
      >
        <div
          v-for="item in previewItems"
          :key="item.id"
          class="w-64 flex-none snap-start"
        >
          <PlaceListItem :place="item" />
        </div>
      </div>
    </div>
  </template>
</template>

<script setup lang="ts">
/**
 * "This time is a live prediction, not the timetable." Deliberately just an
 * icon: it answers where the number came from, not whether the vehicle is
 * running late. Pass `delay` to append how far off schedule it is — a caller
 * that already shows the scheduled time elsewhere should leave it off rather
 * than saying the same thing twice.
 */
import { computed } from 'vue'
import { WifiIcon } from 'lucide-vue-next'

interface Props {
  realTime: boolean
  delay?: number // seconds, signed (+late / -early)
  color?: string // CSS color (e.g. "#4CAF50")
}

})

/** Under a minute off is timetable noise, not news. */
const DELAY_NOTICE_SEC = 60

const delayLabel = computed(() => {
  const delay = props.delay
  if (delay == null || Math.abs(delay) < DELAY_NOTICE_SEC) return null
  const mins = Math.round(Math.abs(delay) / 60)
  return delay > 0 ? `${mins} min late` : `${mins} min early`
})

const isLate = computed(() => (props.delay ?? 0) >= DELAY_NOTICE_SEC)
</script>

<template>
  <span v-if="realTime" class="inline-flex items-center gap-1">
    <WifiIcon
      class="size-3 shrink-0 rotate-45"
      :style="color ? { color } : undefined"
      :class="!color && 'text-muted-foreground'"
    />
    <span
      v-if="delayLabel"
      class="text-[10px] font-medium leading-none whitespace-nowrap"
      :class="isLate ? 'text-red-600 dark:text-red-400' : 'text-sky-600 dark:text-sky-400'"
    >{{ delayLabel }}</span>
  </span>
</template>

  { id: 'shop/bakery', labelKey: key('bakeries'), icon: 'Croissant', category: 'food_and_drink' },
  { id: 'amenity/charging_station', labelKey: key('evCharging'), icon: 'BatteryCharging', category: 'commercial_services' },
  // `public_transport=platform` rather than `highway=bus_stop`: it's the modern
  // tagging every mode shares, so one chip covers bus, tram and rail stops
  // (bus stops carry both tags, so none are lost).
  { id: 'public_transport/platform', labelKey: key('transitStops'), icon: 'Bus', category: 'commercial_services' },
  { id: 'railway/station', labelKey: key('trainStations'), icon: 'TrainFront', category: 'commercial_services' },
  { id: 'leisure/fitness_centre', labelKey: key('gyms'), icon: 'Dumbbell', category: 'sport_and_leisure' },
  { id: 'amenity/place_of_worship', labelKey: key('placesOfWorship'), icon: 'Church', category: 'default' },
  { id: 'amenity/school', labelKey: key('schools'), icon: 'GraduationCap', category: 'education' },
  { id: 'amenity/ice_cream', labelKey: key('iceCream'), icon: 'IceCreamCone', category: 'food_and_drink' },

  // ── Occasional ──────────────────────────────────────
  { id: 'shop/clothes', labelKey: key('clothing'), icon: 'Shirt', category: 'store' },
  { id: 'amenity/bicycle_parking', labelKey: key('bikeParking'), icon: 'Bike', category: 'commercial_services' },
  { id: 'amenity/library', labelKey: key('libraries'), icon: 'Library', category: 'education' },
  { id: 'amenity/dentist', labelKey: key('dentists'), icon: 'Smile', category: 'medical' },
  { id: 'amenity/clinic', labelKey: key('urgentCare'), icon: 'BriefcaseMedical', category: 'medical' },
  { id: 'shop/beauty', labelKey: key('beautySalons'), icon: 'Sparkles', category: 'commercial_services' },
  { id: 'shop/laundry', labelKey: key('laundry'), icon: 'WashingMachine', category: 'commercial_services' },
  { id: 'amenity/car_wash', labelKey: key('carWash'), icon: 'SprayCan', category: 'commercial_services' },
  { id: 'amenity/car_rental', labelKey: key('carRental'), icon: 'Car', category: 'commercial_services' },
  { id: 'aeroway/aerodrome', labelKey: key('airports'), icon: 'Plane', category: 'commercial_services' },
  { id: 'leisure/dog_park', labelKey: key('dogParks'), icon: 'Dog', category: 'sport_and_leisure' },
  { id: 'amenity/childcare', labelKey: key('childcare'), icon: 'Baby', category: 'education' },
  { id: 'shop/pet', labelKey: key('petStores'), icon: 'Bone', category: 'store' },
  { id: 'amenity/marketplace', labelKey: key('farmersMarkets'), icon: 'Carrot', category: 'store' },
  // Not a place type — `internet_access=wlan` is an attribute of cafes,
  // libraries, hotels … The server turns this preset into a tag filter so the
  // chip browses everywhere with WiFi (see derivePresetFilter).
  { id: 'internet_access/wlan', labelKey: key('wifi'), icon: 'Wifi', category: 'commercial_services' },

  // ── Situational ─────────────────────────────────────
  { id: 'tourism/museum', labelKey: key('museums'), icon: 'Amphora', category: 'arts_and_entertainment' },
  { id: 'amenity/waste_basket', labelKey: key('trashCans'), icon: 'Trash2', category: 'default' },
  { id: 'leisure/picnic_table', labelKey: key('picnicTables'), icon: 'Table', category: 'park' },
  { id: 'tourism/picnic_site', labelKey: key('picnicAreas'), icon: 'ShoppingBasket', category: 'park' },
  { id: 'amenity/fountain', labelKey: key('fountains'), icon: 'Droplets', category: 'park' },
  { id: 'amenity/shower', labelKey: key('showers'), icon: 'ShowerHead', category: 'commercial_services' },
  { id: 'amenity/public_bookcase', labelKey: key('publicBookcases'), icon: 'BookOpen', category: 'education' },
  { id: 'leisure/fitness_station', labelKey: key('outdoorGyms'), icon: 'Weight', category: 'sport_and_leisure' },
  { id: 'amenity/bicycle_repair_station', labelKey: key('bikeRepair'), icon: 'Bolt', category: 'sport_and_leisure' },
  { id: 'amenity/shelter', labelKey: key('shelters'), icon: 'TentTree', category: 'park' },
  { id: 'amenity/post_box', labelKey: key('postBoxes'), icon: 'Inbox', category: 'commercial_services' },
  { id: 'emergency/defibrillator', labelKey: key('defibrillators'), icon: 'HeartPulse', category: 'medical' },
  { id: 'tourism/artwork', labelKey: key('publicArt'), icon: 'Palette', category: 'arts_and_entertainment' },
  { id: 'tourism/viewpoint', labelKey: key('viewpoints'), icon: 'Binoculars', category: 'arts_and_entertainment' },
  { id: 'leisure/nature_reserve', labelKey: key('natureReserves'), icon: 'TreePine', category: 'park' },
  { id: 'natural/beach', labelKey: key('beaches'), icon: 'Umbrella', category: 'park' },
]

          "attractions": "Attractions",
          "libraries": "Libraries",
          "wifi": "WiFi",
          "police": "Police",
          "restrooms": "Restrooms",
          "drinkingWater": "Drinking Water",
          "recycling": "Recycling",
          "bikeParking": "Bike Parking",
          "transitStops": "Transit",
          "trainStations": "Train Stations",
          "airports": "Airports",
          "placesOfWorship": "Places of Worship",
          "schools": "Schools",
          "childcare": "Childcare",
          "iceCream": "Ice Cream",
          "dentists": "Dentists",
          "urgentCare": "Urgent Care",
          "beautySalons": "Beauty Salons",
          "laundry": "Laundry",
          "carWash": "Car Wash",
          "carRental": "Car Rental",
          "dogParks": "Dog Parks",
          "publicArt": "Public Art",
          "viewpoints": "Viewpoints",
          "natureReserves": "Nature Reserves",
          "beaches": "Beaches",
          "petStores": "Pet Stores",
          "farmersMarkets": "Farmers Markets",
          "picnicAreas": "Picnic Areas",
          "fountains": "Fountains",
          "showers": "Showers",
          "publicBookcases": "Public Bookcases",
          "outdoorGyms": "Outdoor Gyms",
          "bikeRepair": "Bike Repair",
          "postBoxes": "Post Boxes",
          "defibrillators": "Defibrillators"
        },
          "attractions": "Atracciones",
          "libraries": "Bibliotecas",
          "wifi": "WiFi",
          "police": "Policía",
          "restrooms": "Baños",
          "drinkingWater": "Agua potable",
          "recycling": "Reciclaje",
          "bikeParking": "Aparcabicicletas",
          "transitStops": "Transporte",
          "trainStations": "Estaciones de tren",
          "airports": "Aeropuertos",
          "placesOfWorship": "Lugares de culto",
          "schools": "Escuelas",
          "childcare": "Guarderías",
          "iceCream": "Heladerías",
          "dentists": "Dentistas",
          "urgentCare": "Urgencias",
          "beautySalons": "Salones de belleza",
          "laundry": "Lavandería",
          "carWash": "Lavado de autos",
          "carRental": "Alquiler de autos",
          "dogParks": "Parques para perros",
          "publicArt": "Arte público",
          "viewpoints": "Miradores",
          "natureReserves": "Reservas naturales",
          "beaches": "Playas",
          "petStores": "Tiendas de mascotas",
          "farmersMarkets": "Mercados",
          "picnicAreas": "Áreas de pícnic",
          "fountains": "Fuentes",
          "showers": "Duchas",
          "publicBookcases": "Bibliotecas libres",
          "outdoorGyms": "Gimnasios al aire libre",
          "bikeRepair": "Reparación de bicis",
          "postBoxes": "Buzones",
          "defibrillators": "Desfibriladores"
        },
            // Look up for optional enrichment (name, icon color), but navigate
            // regardless — categoryId alone is enough for Search.vue to work.
            // The curated list is the second source because the registry is
            // capped at 1000 presets and most everyday categories fall past it;
            // without this a shortcut lands on a title derived from its preset
            // id ("Wlan" for internet_access/wlan).
            const category = categoryStore.getCategoryById(categoryId)
            const common = COMMON_CATEGORIES.find(c => c.id === categoryId)
            const name = category?.name ?? (common ? t(common.labelKey) : undefined)
            const iconCategory = category?.iconCategory ?? common?.category
            await router.push({
              name: AppRoute.SEARCH_RESULTS,
              query: {
                categoryId,
                ...(name ? { categoryName: name } : {}),
                ...(iconCategory ? { categoryIconCategory: iconCategory } : {}),
              },
            })
          } else if (itemId.startsWith('brand:')) {
              // ── Empty query → frequents, common categories, recents. ──
              if (!q) {
                // Deliberately NOT awaited: recents live in an encrypted blob
                // that has to be fetched and decrypted, and blocking on it made
                // the first palette open sit on a spinner even though the
                // frequents and category shortcuts are already in memory. The
                // palette re-runs this once hydration lands, filling the
                // Recents section in place.
                void recentsStore.ensureSearchesHydrated()
                void recentsStore.ensurePlacesHydrated()

                // Frequents: Home / Work / School / custom, rendered as tiles.
                const bookmarksStore = useBookmarksStore()

  /**
   * Ensure the given kind has been loaded from the server at least once.
   *
   * Callers fire these on every palette open / dashboard mount, so the work is
   * memoized per user: the first call owns the fetch+decrypt and every later
   * one gets that same promise back without touching the refs again. Leaving
   * the refs alone matters — a re-assignment is a new array identity, which
   * would re-trigger any watcher that reloads a list from the store and loop.
   *
   * A failed hydrate (offline, locked keys) clears the memo so the next call
   * retries, and never rejects: recents are an enhancement, and a caller that
   * awaited a rejection would lose the rest of its list with them.
   */
  type Hydration = { userId: string; promise: Promise<void> } | null
  const hydrations: Record<'searches' | 'places', Hydration> = {
    searches: null,
    places: null,
  }

  function hydrateOnce(
    kind: 'searches' | 'places',
    load: (userId: string) => Promise<void>,
  ): Promise<void> {
    const userId = currentUserId()
    if (!userId) return Promise.resolve()

    const inFlight = hydrations[kind]
    if (inFlight?.userId === userId) return inFlight.promise

    const promise = load(userId).catch(err => {
      console.warn(`[recents:${kind}] hydrate failed, will retry:`, err)
      hydrations[kind] = null
    })
    hydrations[kind] = { userId, promise }
    return promise
  }

  function ensureSearchesHydrated(): Promise<void> {
    return hydrateOnce('searches', async userId => {
      searches.value = await recentSearches.hydrate(userId)
    })
  }

  function ensurePlacesHydrated(): Promise<void> {
    return hydrateOnce('places', async userId => {
      places.value = await recentPlaces.hydrate(userId)
    })
  }

  function recordSearch(query: string) {
  maxWalkingDistance?: number // meters
  maxTransfers?: number
  transitBufferMinutes?: number // 0-5, minutes to arrive early at stop

  // ── UI state (not sent to routing engine) ──
  useKnownVehicleLocations?: boolean
          <div class="flex items-center justify-between">
            <Label class="text-sm font-normal">Arrive early</Label>
            <span class="text-xs text-muted-foreground">{{
              (preferences.transitBufferMinutes ?? 2) === 0
                ? 'Cut it fine'
                : `${preferences.transitBufferMinutes ?? 2} min`
            }}</span>
          </div>
          <Slider
            :model-value="[preferences.transitBufferMinutes ?? 2]"
            :min="0"
            :max="5"
            :step="1"
            @update:model-value="val => val && updatePreference('transitBufferMinutes', val[0])"
          />
          <p class="text-[11px] text-muted-foreground">
            Margin to leave between reaching the stop and the vehicle leaving.
            Trips are planned around it, and departures you'd only just make are
            flagged on the board.
          </p>
        </div>

import { useDirectionsService } from '@/services/directions.service'
import { useMapService } from '@/services/map.service'
import { useGeolocationService } from '@/services/geolocation.service'
import {
  departureReachability,
  remainingAccessWalkSec,
  type DepartureReachability,
} from '@/lib/transit-reachability'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
const mapService = useMapService()
const themeStore = useThemeStore()
// Live position, so the approach walk on the departure board decays as the
// rider actually closes on the stop.
const geo = useGeolocationService()
const { formatDistance, formatElevation } = useUnits()

// ── Upcoming departures per transit segment ─────────────────────────
  /** True when the time comes from a GTFS-RT prediction, not the schedule. */
  realTime: boolean
  /** Signed seconds against the timetable (+late, -early); realtime runs only. */
  delaySec?: number
  /** Timetabled departure, shown struck beside the live time when they differ. */
  scheduledMs?: number
  /** The operator has pulled this run. Kept on the board as an explanation
   *  rather than silently vanishing. */
  cancelled?: boolean
  /** Which route this departure is — shown on merged "4 or 5" boards so the
   *  rider knows whether each run is the 4 or the 5. */
  route?: { shortName?: string; color?: string; textColor?: string }
const didAutoSelectDeparture = ref(false)

// Clock driving the departed/hurry chip states (and the decaying approach
// walk behind them); departures re-fetch keeps the
// realtime predictions fresh as vehicles move.
const nowMs = ref(Date.now())
const tickTimer = setInterval(() => { nowMs.value = Date.now() }, 10_000)
          ? seg.routeOptions.map((o: { shortName?: string }) => o.shortName)
          : [seg.lineName]
        // Cancelled runs stay in the pool — a train vanishing off the board
        // with no explanation is worse than one struck through as cancelled.
        const sameLine = all.filter((d) => routeNames.includes(d.route?.shortName))
        // Same direction: by GTFS direction_id when present (reliable across
        // the 4 and 5, which carry different headsigns), else by headsign.
        let pool: typeof sameLine
        // GTFS-RT prediction for it. Keep the route so a merged board can show
        // which train each run is.
        const byMs = new Map<
          number,
          {
            realTime: boolean
            delaySec?: number
            scheduledMs?: number
            cancelled: boolean
            route?: DepartureOption['route']
          }
        >()
        for (const d of pool) {
          const depMs = new Date(d.departureTime).getTime()
          // Keep already-departed runs (down to the past window) — they show as
          // departed and give the rider useful "just missed it" context.
          if (depMs < fetchFromMs) continue
          const prev = byMs.get(depMs)
          const schedMs = d.scheduledDepartureTime
            ? new Date(d.scheduledDepartureTime).getTime()
            : undefined
          byMs.set(depMs, {
            realTime: (prev?.realTime ?? false) || d.realTime === true,
            delaySec: prev?.delaySec ?? (typeof d.delay === 'number' ? d.delay : undefined),
            scheduledMs: prev?.scheduledMs ?? schedMs,
            // A run only counts as cancelled when no source still runs it.
            cancelled: (prev?.cancelled ?? true) && d.cancelled === true,
            route:
              prev?.route ??
              (d.route
            ms,
            realTime: info.realTime,
            delaySec: info.delaySec,
            scheduledMs: info.scheduledMs,
            cancelled: info.cancelled,
            route: info.route,
            label: formatTime(new Date(ms)),
          }))
}

/** Default the first transit leg to its earliest catchable run — including a
 *  "hurry" one, so the rider lands on the soonest train they can still make.
 *  Runs once per trip; a no-op when that's already the planned run. (This is
 *  only the default: the rider can still pick any run on the board.) */
function selectFirstAvailableDeparture() {
  const t = trip.value
  if (!t) return
  )
  if (idx < 0) return
  const firstCatchable = (segmentDepartures.value[idx] ?? []).find((d) => {
    if (d.cancelled) return false
    const state = depState(idx, d)
    return state === 'ok' || state === 'hurry'
  })
  if (firstCatchable && !isCurrentDeparture(segs[idx], firstCatchable.ms)) {
    void chooseDeparture(idx, firstCatchable.ms)
  }
 *  always present so the cards stay uniform. Recomputes off the nowMs tick. */
function depCountdown(ms: number): { lead: string; sub: string } {
  const clock = formatClockCompact(new Date(ms))
  const deltaMs = ms - nowMs.value
  // Already departed — detect by exact sign (not the rounded minute, which would
  // fold the last ~30s into "now") so a struck card never reads "now".
  // ahead of the cached window — fall through to the API in that case.
  if (sched.length > 0 && sched[0].ms <= minMs) {
    // Never auto-roll a downstream connection onto a cancelled run — the rider
    // may knowingly pick one on the board, but we won't choose it for them.
    const cached = sched.find((d) => d.ms >= minMs && !d.cancelled)
    if (cached) return cached.ms
  }
  try {

// ── Departure chip states (Transit-app style) ────────────────────────
// departed: the vehicle is gone. unreachable: still upcoming, but not on
// foot from where the rider is. hurry: catchable, but only just — the walk
// leaves under 3 minutes of slack. live: time comes from GTFS-RT.
// All of these are hints; none of them block a rebook.

/** Approach walk still ahead of the rider for this boarding, when it's the
 *  trip's first transit leg (0 otherwise — mid-trip positions depend on
 *  earlier legs, so only "departed" can be judged there). Decays as the rider
 *  actually closes on the stop rather than staying pinned to the plan. */
function remainingWalkSec(segmentIndex: number): number {
  const t = trip.value
  if (!t) return 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!isFirst) return 0
  const prev = segs[segmentIndex - 1]
  if (prev?.mode !== 'walking') return 0
  const planned = movingDuration(prev)
  // Arrival at the stop excludes the platform wait folded into the walk leg.
  const arrivalMs = asMs(prev.endTime) - (prev.waitSeconds ?? 0) * 1000
  return remainingAccessWalkSec(
    {
      plannedSec: planned,
      arrivalMs,
      distanceM: prev.distance,
      stop: segs[segmentIndex]?.departureStop?.location ?? null,
      position: geo.lngLat.value,
      accuracyM: geo.accuracy.value,
    },
    nowMs.value,
  )
}

/** The rider's "arrive early" margin, in seconds. Read from the transit slice
 *  directly rather than the merged `routingPreferences` — a multimodal trip
 *  resolves those against the biking slice, which carries no transit keys. */
const graceSec = computed(
  () => (directionsStore.modePreferences.transit?.transitBufferMinutes ?? 2) * 60,
)

function depState(segmentIndex: number, dep: DepartureOption): DepartureReachability {
  return departureReachability(
    dep.ms,
    nowMs.value,
    remainingWalkSec(segmentIndex),
    graceSec.value,
  )
}

/** Minutes late (positive) or early (negative) worth telling the rider about.
 *  Under a minute is timetable noise, not news. */
const DELAY_NOTICE_SEC = 60

/** What is true about a run. Purely factual — how any of it *looks* is the
 *  board's business, not this view's:
 *   • planned     — the run the trip currently boards
 *   • departed    — already gone
 *   • unreachable — upcoming, but probably not on foot in time
 *   • hurry       — you'd make it with less than your margin spare
 *   • arriving    — imminent, i.e. "now"
 *   • cancelled   — pulled by the operator
 *   • live        — the time is a GTFS-RT prediction rather than the schedule
 *   • delaySec    — how far that prediction sits off the timetable
 *  Every card stays selectable regardless — the rider may well know something
 *  the estimate doesn't. */
interface DepCard {
  planned: boolean
  departed: boolean
  unreachable: boolean
  hurry: boolean
  arriving: boolean
  cancelled: boolean
  live: boolean
  clickable: boolean
  lead: string
  sub: string
  /** Timetabled time, when a live prediction has superseded it. */
  scheduledSub?: string
  delaySec?: number
  route?: DepartureOption['route']
  title: string
}
  const planned = isCurrentDeparture(segment, dep.ms)
  const state = depState(segmentIndex, dep)
  const departed = state === 'departed'
  // The reachability hints stand even on the selected card — you still have to
  // rush for (or have likely missed) it — so `planned` doesn't suppress them.
  const unreachable = state === 'unreachable'
  const hurry = state === 'hurry'
  const cancelled = dep.cancelled === true
  const { lead, sub } = depCountdown(dep.ms)
  const arriving = !departed && !cancelled && lead === 'now'
  const name = dep.route?.shortName ?? segment.lineName
  const switchTo = `Switch to the ${name} at ${dep.label}`

  // Only worth showing the timetable alongside the prediction when they
  // actually disagree — otherwise every live card grows a redundant second time.
  const delaySec = dep.delaySec
  const offSchedule =
    delaySec != null &&
    Math.abs(delaySec) >= DELAY_NOTICE_SEC &&
    dep.scheduledMs != null
  const scheduledSub = offSchedule
    ? formatClockCompact(new Date(dep.scheduledMs!))
    : undefined
  const delayPhrase = offSchedule
    ? delaySec! > 0
      ? `${Math.round(delaySec! / 60)} min late`
      : `${Math.round(-delaySec! / 60)} min early`
    : null

  return {
    planned,
    departed,
    unreachable,
    hurry,
    arriving,
    cancelled,
    live: dep.realTime,
    clickable: !planned,
    lead,
    sub,
    scheduledSub,
    delaySec,
    route: dep.route,
    // The tooltip spells out what each badge means the first time someone
    // hovers one, and always says the run is still selectable — the badges
    // are a read on your chances, not a refusal.
    title: cancelled
      ? `Cancelled — the ${name} at ${dep.label} isn't running`
      : planned
        ? joinStatus('Planned departure', delayPhrase)
        : departed
          ? `Departed at ${dep.label}`
          : unreachable
            ? `You may miss this one — the ${name} leaves at ${dep.label}, sooner than you can reach the stop. Pick it anyway if you're closer than we think`
            : hurry
              ? `Catchable if you hurry — the ${name} leaves at ${dep.label}`
              : joinStatus(switchTo, delayPhrase),
  }
}

/** "Planned departure" + "3 min late" → "Planned departure — 3 min late". */
function joinStatus(base: string, extra: string | null): string {
  return extra ? `${base} — ${extra}` : base
}

/** Per-segment board cards, each enriched with its visual state. Recomputes off
 *  the nowMs tick and whenever fresh departures land. */
const boardCards = computed(() => {
}

/** Clock time without the AM/PM. Every departure chip is one fixed width, and
 *  the countdown sitting right above already says which side of noon this is —
 *  so the day period is the first thing to go. Locales that don't use one are
 *  unaffected. */
function formatClockCompact(date: Date): string {
  return new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' })
    .formatToParts(date)
    .filter((p) => p.type !== 'dayPeriod')
    .map((p) => p.value)
    .join('')
    .trim()
}

function onRouteProfileChange(
  segmentIndex: number,
  profile: RouteProfileType | null,
[mcp_servers.superconductor]
url = "http://localhost:31418/mcp?sc_token=c8e68b2dc9f5dff53c99870b8991a7eb&worktree=%2FUsers%2Falexwohlbruck%2FDocuments%2Fcode%2Fparchment%2F"

# Parchment

## Architecture

- **Parchment server** (API): runs in Docker as `parchment-server`, port 5000. Restart with `docker compose -f docker-compose.dev.yml restart parchment-server`
- **Parchment web** (Vite): runs on port 5173. HMR handles client code changes. Do NOT start a new dev server.
- **Barrelman** (geospatial engine): separate repo at `../barrelman`, Docker container `barrelman`, port 5001. Runs with hot-reload in dev (`bun --hot`, source mounted) — `src/` changes apply instantly, no rebuild. The `.env` defaults `COMPOSE_FILE` to base + dev override, so `cd ../barrelman && docker compose up -d barrelman` uses HMR. Only rebuild (`docker compose up -d --build barrelman`) for dependency or `Dockerfile`/`Dockerfile.dev` changes.
- **Parchment DB**: Docker container `parchment-db`
- **Barrelman DB**: Docker container `barrelman-db`, port 5434

## When to restart what

- **Client code changes** (`web/src/`): Vite HMR picks them up automatically
- **Server code changes** (`server/src/`): `bun --hot` in Docker picks them up automatically (source is volume-mounted from `./server` into the container). If hot reload fails: `docker compose -f docker-compose.dev.yml restart parchment-server`
- **Barrelman code changes** (`../barrelman/src/`): `bun --hot` picks them up automatically (source volume-mounted via the dev compose override). If hot reload fails: `docker compose -f ../barrelman/docker-compose.yml -f ../barrelman/docker-compose.dev.yml restart barrelman`. Rebuild the image only for dependency / `Dockerfile` changes.
- **Barrelman import scripts** (`../barrelman/import/`, `../barrelman/scripts/`): mounted into the container; re-run them directly, no rebuild.

## Release notes

`CHANGELOG.md` is cumulative ([Keep a Changelog](https://keepachangelog.com/en/1.1.0/)). When a user-facing feature or fix is complete, append an entry under `## [Unreleased]` at the top — do not wait for release time.

- Group entries under `### Added`, `### Changed`, or `### Fixed` within `[Unreleased]`. Create the heading if it isn't there; otherwise append to the existing one.
- One `*` bullet per change, written for users rather than developers: what it does for them, not which files moved. Match the tone of the released sections below it.
- Skip purely internal work (refactors, test-only changes, dependency bumps) — if a user wouldn't notice it, it doesn't belong here.
- Never edit the released `## [X.Y.Z]` sections. `deploy.sh` retitles `[Unreleased]` at release time and opens a fresh empty one; `scripts/changelog.sh` is the only thing that should rewrite the file.

## Important rules

- Do NOT start new dev servers. The user runs their own.
- Do NOT merge to main. Work on feature branches.
- If a Linear ticket was linked for the relevant work, update the status of the ticket as work progresses.
- Use `bun` over `npm` for package management.
- Commit messages: short (5-20 words), distinct logical commits.
- Keep code structure clean, modular, and dry. Use concise, straightforward naming conventions and move code to appropriate modules when it isn't in the correct place. Add comments when the code is not intuitive at a glance or to convey important context/information.
- "Modules" represent all code components for a single entity. Users, directions, search, settings, etc are all modules. These module identities are represented throught the codebase and should contain related UI, data, and business logic for that entity. Make sure to keep new and old code nicely modularized.
- Offer to refactor malformed code when we come across any. This is anything that doesn't follow our normal conventions or industry practices.
- When we add new features, integrations, modules, etc, update the relevant documentation in the sibiling `parchment-docs` repo.
- Write clean, functional tests for new code logic. Do not add frivilous or non-meaningful tests.
- Keep the swagger API documentation up-to-date and clean while making changes to the backend.
- Always apply a clean, minimalist, and refined style when designing UI.
- No uppercase tracking-wider text in UI.

import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import DepartureBoard, { type BoardCard } from './DepartureBoard.vue'

/**
 * These assert the board's *visual language*, not its pixels — each channel
 * answers one question and never borrows another's. The rules are easy to
 * erode one convenient exception at a time, so they're pinned here.
 */

function card(overrides: Partial<BoardCard['card']> = {}, ms = 1_000): BoardCard {
  return {
    ms,
    route: { shortName: '4', color: '00933C', textColor: 'FFFFFF' },
    card: { lead: '5 min', sub: '2:24', clickable: true, ...overrides },
  }
}

function mountBoard(cards: BoardCard[]) {
  return mount(DepartureBoard, { props: { cards, lineName: '4' } })
}

/** The chip element for card `i`. */
function chip(wrapper: ReturnType<typeof mountBoard>, i = 0) {
  return wrapper.findAll('button')[i]
}

/** The countdown — the hero line, and the one that carries status colour. */
function countdown(wrapper: ReturnType<typeof mountBoard>, i = 0) {
  return chip(wrapper, i).get('[data-testid="countdown"]')
}

/** The single footnote slot: status word, else timetable pair, else clock. */
function footnote(wrapper: ReturnType<typeof mountBoard>, i = 0) {
  return chip(wrapper, i).get('[data-testid="footnote"]')
}

function bullet(wrapper: ReturnType<typeof mountBoard>, i = 0) {
  return chip(wrapper, i).get('.route-bullet')
}

describe('status wording', () => {
  it('says nothing on a comfortable run — just the clock', () => {
    const w = mountBoard([card()])
    expect(footnote(w).text()).toBe('2:24')
  })

  it('labels a tight run "hurry" and a likely-missed one "may miss"', () => {
    const w = mountBoard([card({ hurry: true }), card({ unreachable: true }, 2_000)])
    expect(footnote(w, 0).text()).toBe('hurry')
    expect(footnote(w, 1).text()).toBe('may miss')
  })

  it('shows only the worst news — cancelled outranks the rest', () => {
    const w = mountBoard([card({ cancelled: true, unreachable: true, hurry: true })])
    expect(footnote(w).text()).toBe('cancelled')
  })

  it('ranks "may miss" above "hurry" when both somehow apply', () => {
    const w = mountBoard([card({ unreachable: true, hurry: true })])
    expect(footnote(w).text()).toBe('may miss')
  })

  it('leaves a departed run wordless — "3m ago" already says it', () => {
    const w = mountBoard([card({ departed: true, lead: '3m ago' })])
    expect(footnote(w).text()).toBe('2:24')
  })
})

describe('the countdown carries the status colour, so nothing out-shouts it', () => {
  it('tints the countdown itself rather than adding a louder badge', () => {
    const w = mountBoard([card({ hurry: true }), card({ unreachable: true }, 2_000)])
    expect(countdown(w, 0).classes().join(' ')).toContain('amber')
    expect(countdown(w, 1).classes().join(' ')).toContain('orange')
  })

  it('resolves one colour at a time, never two competing', () => {
    // Two text-colour classes on one element would race on stylesheet order.
    const w = mountBoard([card({ unreachable: true, hurry: true, arriving: true })])
    const colours = countdown(w)
      .classes()
      .filter(c => c.startsWith('text-') && !c.startsWith('text-['))
    expect(colours).toHaveLength(1)
  })
})

describe('receding separates operator facts from our estimates', () => {
  it('mutes a departed or cancelled run — it genuinely is not an option', () => {
    const w = mountBoard([card({ departed: true }), card({ cancelled: true }, 2_000)])
    expect(countdown(w, 0).classes().join(' ')).toContain('muted-foreground')
    expect(countdown(w, 1).classes().join(' ')).toContain('muted-foreground')
    // The bullet fades on its own; a blanket card opacity would desaturate
    // the line colour into mud.
    expect(bullet(w, 0).classes()).toContain('opacity-45')
    expect(bullet(w, 1).classes()).toContain('opacity-45')
  })

  it('never mutes a run we merely estimated you would miss', () => {
    // The whole point of the reachability work: our guess must not make a
    // run look unavailable, because the rider is often closer than we think.
    const w = mountBoard([card({ unreachable: true }), card({ hurry: true }, 2_000)])
    for (const i of [0, 1]) {
      expect(countdown(w, i).classes().join(' ')).not.toContain('muted-foreground')
      expect(bullet(w, i).classes()).not.toContain('opacity-45')
    }
  })
})

describe('the board keeps one rhythm', () => {
  it('gives every chip the same width, whatever its status', () => {
    const w = mountBoard([
      card(),
      card({ hurry: true }, 2_000),
      card({ unreachable: true }, 3_000),
      card({ cancelled: true }, 4_000),
      card({ departed: true, lead: '3m ago' }, 5_000),
    ])
    for (let i = 0; i < 5; i++) {
      expect(chip(w, i).classes()).toContain('w-[78px]')
    }
  })

  it('keeps the footnote to a single line — status replaces the clock', () => {
    const w = mountBoard([card({ hurry: true, sub: '2:24', scheduledSub: '2:21' })])
    expect(footnote(w).text()).toBe('hurry')
  })
})

describe('strikethrough means void or superseded, nothing else', () => {
  it('strikes a cancelled run\'s countdown', () => {
    const w = mountBoard([card({ cancelled: true })])
    expect(countdown(w).classes()).toContain('line-through')
  })

  it('does not strike a departed run — it happened, it is not void', () => {
    const w = mountBoard([card({ departed: true, lead: '3m ago' })])
    expect(chip(w).html()).not.toContain('line-through')
  })

  it('strikes only the timetable time it beat when running late', () => {
    const w = mountBoard([card({ scheduledSub: '2:21', sub: '2:24', delaySec: 180 })])
    expect(countdown(w).classes()).not.toContain('line-through')
    expect(footnote(w).html()).toMatch(/line-through[^>]*>2:21/)
    expect(footnote(w).text()).toContain('2:24')
  })
})

describe('selection owns the border, and only the border', () => {
  it('rings the planned run', () => {
    const w = mountBoard([card({ planned: true })])
    expect(chip(w).classes()).toContain('border-parchment-500')
  })

  it('leaves every other run a transparent border, so nothing shifts', () => {
    const w = mountBoard([card(), card({ hurry: true }, 2_000), card({ departed: true }, 3_000)])
    for (let i = 0; i < 3; i++) {
      expect(chip(w, i).classes()).toContain('border-transparent')
    }
  })

  it('still rings, and still mutes, a planned run that has departed', () => {
    // The two channels are independent — neither suppresses the other.
    const w = mountBoard([card({ planned: true, departed: true, lead: '1m ago' })])
    expect(chip(w).classes()).toContain('border-parchment-500')
    expect(countdown(w).classes().join(' ')).toContain('muted-foreground')
  })

  it('rings without tinting the fill, so a selected run never reads as an error', () => {
    const w = mountBoard([card({ planned: true })])
    expect(chip(w).classes()).toContain('bg-muted/40')
    expect(chip(w).attributes('style') ?? '').not.toContain('background')
  })
})

describe('selection', () => {
  it('emits the chosen run', async () => {
    const w = mountBoard([card({}, 4_242)])
    await chip(w).trigger('click')
    expect(w.emitted('choose')?.[0]).toEqual([4_242])
  })

  it('lets the rider pick a run we think they will miss', async () => {
    const w = mountBoard([card({ unreachable: true }, 7_000)])
    await chip(w).trigger('click')
    expect(w.emitted('choose')?.[0]).toEqual([7_000])
  })

  it('lets the rider pick one that already departed', async () => {
    const w = mountBoard([card({ departed: true, lead: '3m ago' }, 8_000)])
    await chip(w).trigger('click')
    expect(w.emitted('choose')?.[0]).toEqual([8_000])
  })

  it('no chip is ever disabled', () => {
    const w = mountBoard([
      card({ departed: true }),
      card({ cancelled: true }, 2_000),
      card({ unreachable: true }, 3_000),
    ])
    expect(w.findAll('button[disabled]')).toHaveLength(0)
  })

  it('does not re-emit for the run already selected', async () => {
    const w = mountBoard([card({ planned: true, clickable: false })])
    await chip(w).trigger('click')
    expect(w.emitted('choose')).toBeUndefined()
  })
})

/**
 * Scroll-surface lookup for panel views.
 *
 * A view rendered inside a sheet doesn't own its scroll container — the host
 * sheet does (LeftSheet's Card on desktop, BottomSheet's container on mobile),
 * and both tag it with `data-sheet-scroll`. Views that need the scrolling
 * element itself — to save/restore a position, or to drive infinite scroll —
 * resolve it through here rather than assuming a particular ancestor.
 *
 * The walk up the tree is a fallback for hosts that don't carry the tag.
 */

export interface FindScrollAncestorOptions {
  /**
   * Also match `overflow-y: hidden` ancestors. Those still scroll
   * programmatically, so save/restore wants them; anything reacting to a
   * *user* scroll does not.
   */
  includeHidden?: boolean
}

export function findScrollAncestor(
  el: HTMLElement | null,
  { includeHidden = false }: FindScrollAncestorOptions = {},
): HTMLElement | null {
  if (!el) return null

  const tagged = el.closest('[data-sheet-scroll]') as HTMLElement | null
  if (tagged) return tagged

  let node = el.parentElement
  while (node) {
    const overflowY = getComputedStyle(node).overflowY
    if (
      overflowY === 'auto' ||
      overflowY === 'scroll' ||
      (includeHidden && overflowY === 'hidden')
    ) {
      return node
    }
    node = node.parentElement
  }
  return null
}

import { describe, expect, it } from 'vitest'
import {
  departureReachability,
  remainingAccessWalkSec,
} from './transit-reachability'

const NOW = new Date('2026-08-14T14:00:00Z').getTime()
const MIN = 60_000

// Grand Central-ish, and a point ~800m west of it.
const STOP = { lat: 40.7527, lng: -73.9772 }
const BLOCKS_AWAY = { lat: 40.7527, lng: -73.9677 }

describe('remainingAccessWalkSec', () => {
  it('returns the full walk before the rider is due to set off', () => {
    const remaining = remainingAccessWalkSec(
      { plannedSec: 420, arrivalMs: NOW + 10 * MIN },
      NOW,
    )
    expect(remaining).toBe(420)
  })

  it('decays as the plan says the rider should be walking', () => {
    // 3 minutes into a 7 minute walk.
    const remaining = remainingAccessWalkSec(
      { plannedSec: 420, arrivalMs: NOW + 4 * MIN },
      NOW,
    )
    expect(remaining).toBe(240)
  })

  it('reaches zero once the plan has the rider at the stop', () => {
    const remaining = remainingAccessWalkSec(
      { plannedSec: 420, arrivalMs: NOW - 2 * MIN },
      NOW,
    )
    expect(remaining).toBe(0)
  })

  it('prefers the live position over the schedule', () => {
    // The schedule still thinks the rider is 7 minutes out, but they're
    // standing at the stop.
    const remaining = remainingAccessWalkSec(
      {
        plannedSec: 420,
        arrivalMs: NOW + 7 * MIN,
        stop: STOP,
        position: { lat: STOP.lat + 0.0001, lng: STOP.lng },
        accuracyM: 12,
      },
      NOW,
    )
    expect(remaining).toBeLessThan(30)
  })

  it('scales the position estimate by the pace implied by the plan', () => {
    // 800m of planned walk over 400s → 2 m/s, so ~800m out still reads as a
    // few minutes of walking (plus the detour allowance).
    const remaining = remainingAccessWalkSec(
      {
        plannedSec: 400,
        distanceM: 800,
        arrivalMs: NOW + 400_000,
        stop: STOP,
        position: BLOCKS_AWAY,
        accuracyM: 10,
      },
      NOW,
    )
    expect(remaining).toBeGreaterThan(300)
    expect(remaining).toBeLessThanOrEqual(400)
  })

  it('ignores a fix too coarse to place the rider', () => {
    const remaining = remainingAccessWalkSec(
      {
        plannedSec: 420,
        arrivalMs: NOW + 7 * MIN,
        stop: STOP,
        position: STOP,
        accuracyM: 2000,
      },
      NOW,
    )
    expect(remaining).toBe(420)
  })

  it('never exceeds the planned walk', () => {
    const remaining = remainingAccessWalkSec(
      {
        plannedSec: 120,
        arrivalMs: NOW + 60 * MIN,
        stop: STOP,
        position: BLOCKS_AWAY,
        accuracyM: 10,
      },
      NOW,
    )
    expect(remaining).toBe(120)
  })

  it('is zero when there is no approach walk (mid-trip boarding)', () => {
    expect(remainingAccessWalkSec({ plannedSec: 0 }, NOW)).toBe(0)
  })
})

describe('departureReachability', () => {
  const GRACE = 180 // the default 3-minute margin, in seconds

  it('marks past runs departed', () => {
    expect(departureReachability(NOW - MIN, NOW, 0, GRACE)).toBe('departed')
    expect(departureReachability(NOW - MIN, NOW, 420, GRACE)).toBe('departed')
  })

  it('marks upcoming runs inside the remaining walk unreachable', () => {
    expect(departureReachability(NOW + 2 * MIN, NOW, 420, GRACE)).toBe('unreachable')
  })

  it('flags a run you would only just make as hurry', () => {
    // 9 min out, 7 min walk → 2 min spare, under the 3 min margin.
    expect(departureReachability(NOW + 9 * MIN, NOW, 420, GRACE)).toBe('hurry')
  })

  it('is ok once the walk plus the margin fits', () => {
    expect(departureReachability(NOW + 11 * MIN, NOW, 420, GRACE)).toBe('ok')
    expect(departureReachability(NOW + 20 * MIN, NOW, 420, GRACE)).toBe('ok')
  })

  it('never nags when the rider asks for no margin', () => {
    // Grace 0 means "stepping straight on is fine" — only a walk you truly
    // cannot finish downgrades the run.
    expect(departureReachability(NOW + 30_000, NOW, 0, 0)).toBe('ok')
    expect(departureReachability(NOW + 8 * MIN, NOW, 420, 0)).toBe('ok')
    expect(departureReachability(NOW + 6 * MIN, NOW, 420, 0)).toBe('unreachable')
  })

  it('widens the hurry band as the rider asks for more margin', () => {
    const lead = NOW + 9 * MIN
    expect(departureReachability(lead, NOW, 420, 60)).toBe('ok')
    expect(departureReachability(lead, NOW, 420, 300)).toBe('hurry')
  })

  it('applies the margin even with no approach walk to judge', () => {
    // Mid-trip transfer: we can't model the walk, but "leaves inside your
    // margin" is still worth flagging.
    expect(departureReachability(NOW + MIN, NOW, 0, GRACE)).toBe('hurry')
    expect(departureReachability(NOW + 5 * MIN, NOW, 0, GRACE)).toBe('ok')
  })

  it('defaults to no margin when none is given', () => {
    expect(departureReachability(NOW + 8 * MIN, NOW, 420)).toBe('ok')
  })

  it('reopens runs the rider has walked into reach of', () => {
    // A 5-minute-out train with 7 minutes of static walk reads unreachable...
    expect(departureReachability(NOW + 5 * MIN, NOW, 420, GRACE)).toBe('unreachable')
    // ...but is plainly catchable once the walk has decayed to a minute.
    expect(departureReachability(NOW + 5 * MIN, NOW, 60, GRACE)).toBe('ok')
  })
})

/**
 * How catchable is a given departure, right now?
 *
 * The planner hands us a static approach walk ("7 min to the platform"), but a
 * rider reading the departure board has usually already spent part of it. Held
 * static, the board keeps insisting the rider is 7 minutes out while they stand
 * on the platform watching catchable trains read as missed. So the remaining
 * walk decays: from the live position when we have one, otherwise from the
 * plan's own schedule.
 *
 * The result is a hint, never a gate — see `departureReachability`.
 */

import type { LngLat } from '@/types/map.types'
import { distanceMeters } from './measure.utils'

/** Walking pace assumed when the plan carries no usable distance. */
const DEFAULT_WALK_SPEED_MPS = 1.35
/** Sane bounds for a pace inferred from the plan, so one odd leg can't imply
 *  a sprint or a crawl. */
const MIN_WALK_SPEED_MPS = 0.7
const MAX_WALK_SPEED_MPS = 2.2
/** Straight-line distance undershoots a real walking route — street grids and
 *  station entrances add roughly a third. */
const DETOUR_FACTOR = 1.3
/** A fix this coarse can't tell "at the platform" from "a block away". */
const MAX_USABLE_ACCURACY_M = 150

export interface AccessWalk {
  /** Moving seconds of the planned approach walk (excludes platform wait). */
  plannedSec: number
  /** When the plan has the rider reaching the stop (ms epoch), wait excluded. */
  arrivalMs?: number
  /** Metres of the planned approach walk, used to infer the rider's pace. */
  distanceM?: number
  /** The boarding stop, for the position-based estimate. */
  stop?: LngLat | null
  /** Live position; ignored when absent or too coarse to be meaningful. */
  position?: LngLat | null
  accuracyM?: number | null
}

/**
 * Seconds of approach walk still ahead of the rider. Never exceeds the planned
 * walk: the failure we care about is the board being too pessimistic, so when
 * the estimates disagree we trust the plan as the ceiling.
 */
export function remainingAccessWalkSec(walk: AccessWalk, nowMs: number): number {
  const planned = Math.max(0, walk.plannedSec)
  if (planned === 0) return 0

  // Position first — it reflects where the rider actually is, not where the
  // plan assumed they'd be.
  if (
    walk.stop &&
    walk.position &&
    (walk.accuracyM == null || walk.accuracyM <= MAX_USABLE_ACCURACY_M)
  ) {
    const pace = walk.distanceM
      ? clamp(walk.distanceM / planned, MIN_WALK_SPEED_MPS, MAX_WALK_SPEED_MPS)
      : DEFAULT_WALK_SPEED_MPS
    const remaining =
      (distanceMeters(walk.position, walk.stop) * DETOUR_FACTOR) / pace
    return clamp(remaining, 0, planned)
  }

  // Otherwise assume the rider is keeping to the plan: the walk burns down as
  // the clock passes its scheduled arrival at the stop.
  if (walk.arrivalMs != null) {
    return clamp((walk.arrivalMs - nowMs) / 1000, 0, planned)
  }

  return planned
}

/**
 * How a run reads on the board:
 *   • departed     — already gone
 *   • unreachable  — still upcoming, but not on foot from where the rider is
 *   • hurry        — you'd make it, but with less than your grace period spare
 *   • ok           — comfortable
 *
 * `graceSec` is the rider's own margin (the "arrive early" preference): how
 * much slack they want between reaching the platform and the doors closing.
 * At 0 they're happy to step straight on, and nothing ever reads as a hurry.
 *
 * All four are cosmetic. Rebooking is never gated on them: the rider knows
 * things we don't (they're on the platform, they'll run, they're being driven).
 */
export type DepartureReachability = 'departed' | 'unreachable' | 'hurry' | 'ok'

export function departureReachability(
  departureMs: number,
  nowMs: number,
  remainingWalkSec: number,
  graceSec = 0,
): DepartureReachability {
  const leadMs = departureMs - nowMs
  if (leadMs < 0) return 'departed'
  const walkMs = Math.max(0, remainingWalkSec) * 1000
  if (leadMs < walkMs) return 'unreachable'
  // Comfortable means the walk *plus* the rider's margin fits in the lead.
  const comfortableMs = walkMs + Math.max(0, graceSec) * 1000
  if (comfortableMs > 0 && leadMs < comfortableMs) return 'hurry'
  return 'ok'
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}
