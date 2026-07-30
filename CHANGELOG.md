# Changelog

All notable changes to Parchment are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

* New isochrone measurement tool — drop a point on the map and see how far you can get from it in a given time on foot, by bike, by car or on transit, drawn as shaded travel-time bands with the area each one covers. It also works in reverse, showing everywhere that can reach the point in time

### Fixed

* The final step of a set of directions now shows the arrival flag again instead of a turn arrow

## [0.5.8] - 2026-07-29

### Changed

* Place search is dramatically faster — results now appear as you type instead of lagging a beat behind, and suggestions no longer flicker or briefly show matches for an earlier keystroke

### Fixed

* Neighbouring businesses that share a name — two locations of the same chain on one street, adjacent mall units — no longer collapse into a single map pin when their street addresses clearly differ

## [0.5.7] - 2026-07-27

### Changed

* Inviting users now respects your own roles — you can assign any role you already hold when inviting someone (so alpha testers can invite other alpha testers), and the invite form only offers the roles you're allowed to grant

## [0.5.6] - 2026-07-23

### Added

* Alpha testers can now invite new users

### Fixed

* Time zones map layer now loads correctly in production again

## [0.5.5] - 2026-07-23

### Fixed

* Time zones map layer now loads correctly in production again

## [0.5.3] - 2026-07-20

### Added

* Compass heading beam — the location marker now shows a live direction beam that widens when the compass reading is less certain

### Changed

* Refreshed heading typography — headings now use the Exposure display typeface, with weight tuned per heading level
* Further error-reporting reliability and hosted-deployment tile fixes

### Fixed

* Saved map layers now load immediately after a fresh sign-in, instead of only after a reload

## [0.5.2] - 2026-07-19

### Changed

* More reliable error reporting — server-side errors and crashes now consistently reach the observability pipeline, including a live-reconfigure path when logging settings change
* Hosted-deployment fixes for basemap map tiles

## [0.5.1] - 2026-07-18

### Changed

* Subscription billing groundwork — license verification and Polar billing configuration wired up for the hosted service (no change for self-hosted instances)
* Clearer self-hosting setup — the example environment file now points self-hosters to full-access mode and marks billing variables as hosted-only
* Assorted fixes and internal improvements

## [0.5.0] - 2026-07-17

### Added

* Air quality & wildfire map layers — new Air Quality and Wildfire layer groups powered by OpenAQ and NASA FIRMS, with live readouts that follow each region's own AQI standard and aggregate nearby monitoring stations
* Look Around street imagery — peek at street-level imagery right from a place's detail view, opening full-screen with smoother navigation and mobile polish
* Brand search — find every location of a chain with real brand logos and browse them on the map
* Reorganized search — dedicated Recents and Categories sections, results that page as you scroll and reframe the map as they widen, ranked nearest-first
* Transit departure board — a transit-style board with live countdown cards, and interchangeable routes merged into a single trip (e.g. "4 or 5")
* Smarter trip planning — better handling of shared vehicles, parking, and walking time in multimodal directions
* Redesigned place detail — routable tabs, with home, work, and school presets across the dashboard, collections, and directions
* Richer place info from Foursquare — reviews, cuisine, and more
* Map rotation snapping — snap the map to north or to a city's street grid as you rotate

### Changed

* Reorganized settings into clearer Behavior and Appearance sections, with full-screen dialogs on mobile and a consistent close button
* More resilient third-party integrations with automatic background retries
* Quieter, cleaner server logging, plus assorted performance and reliability improvements

## [0.4.0] - 2026-06-24

### Added

* Transit trip planner — full multimodal directions that combine walking, transit, cycling, driving, rideshare, and shared bikes/scooters into one ranked list of trips, powered by a MOTIS unified routing graph
* Live transit — real-time vehicle positions on the map (NYC MTA bus & subway, LIRR, Metro-North, and NYC Ferry) with schedule-aware interpolation, an Apple Maps–style route detail panel, and a stop departures widget
* Transit trip detail — a unified timeline with line-colored cards, board/alight stops, intermediate stops, service alerts, and a departure picker that instantly re-plans the trip around a later run
* Shared mobility — direct bikeshare/scooter trips and transit access/egress via GBFS (Citi Bike), with live dock availability, rental fare estimates, and unlock deep links
* Rideshare — Uber and Lyft as a directions mode and as transit access/egress, with price ranges and pickup ETAs
* Smarter trip ranking — balanced sort weighs fares as time, surfaces least-transfer and simpler one-seat rides, and is wheelchair-aware (entrance snapping, fare-gate delays, park-and-ride)
* Shareable, recoverable trips — directions encode in the URL and trips persist server-side, so a shared or refreshed link restores the exact plan
* Redesigned mobile directions sheet — opens at a content-fitted peek showing just the inputs and expands to full once results load

## [0.3.0] - 2026-05-31

### Added

* Multimodal trip planner — plan trips with transit, walking, cycling, driving, and park-and-ride combinations powered by MOTIS and GraphHopper
* Multi-itinerary transit — returns multiple trip candidates from MOTIS, scored across fastest, fewest transfers, and least walking
* Departure time picker and sort preferences for trip planning
* Transit detail view — route-colored timeline segments, departure cards, and stop lists
* Realtime transit indicators — wifi icon and delay labels on departure boards and trip segments, powered by GTFS-RT
* Park-and-ride support — finds parking near transit stops and composes drive→park→transit→walk trips
* Per-waypoint time constraints — departAfter, arriveBy, and dwellTime on any stop
* Onboarding wizard — profile setup, alias, recovery key, passkey, theme, and subscription steps for new users
* Admin user management — user detail pages, role CRUD, permission management, impersonation, and pagination
* Avatar upload and serving
* Dashboard with inline command palette, pinned bookmarks, and card layout

### Changed

* Full UI redesign — warm neominimal theme, 3D depth styling on buttons/inputs/cards, Geist and Boston Angel typography
* Redesigned friends page, place detail, trip timeline, settings sidebar, and library layout
* Redesigned trip detail timeline with colored segments and aligned mode icons
* Migrated transit departures from Transitland to Barrelman (MOTIS stoptimes)
* Removed dead Transitland code from place service

### Fixed

* Widget transit detection crashing on Place amenities shape
* Dialog open animation flying in from top-left corner
* Orphaned and duplicated markers on style reload and drag
* Cycling/walking speed using wrong GraphHopper modifier
* Command palette vertical positioning after dialog centering change
* Location sharing, auth middleware, and polygon layer bugs
* Marker layer watcher leaks causing stale map markers

## [0.2.0] - 2026-05-21

### Added

* Basic subscription tier — a new $1/month plan that unlocks all user content features like bookmarks, collections, friends, location sharing, map notes, custom layers, and integrations
* Per-feature permission guards — server endpoints now enforce granular permissions so free users get a read-only experience while subscribers unlock content creation
* Upgrade prompts — free users see a clear upgrade banner when they visit Library, Friends, or Timeline
* 3-tier billing page — settings now shows a side-by-side comparison of Free, Basic, and Premium plans with live pricing from Polar
* Search within visible map area — search results now respect the unobstructed map viewport instead of the full screen bounds

## [0.1.6] - 2026-04-29

### Added

* Live friend locations — friends on the map now move in real time instead of waiting for the next refresh, with stronger privacy and security under the hood
* Smoother map movement — friend markers glide between updates instead of jumping, so the map feels more natural to watch
* Easier on your battery — map animations now pause when nothing is moving and use less power overall
* Timeline page — a new dedicated page (with map view and nav shortcut on mobile and desktop) for browsing where you’ve been
* Recent visits on places — place pages now show a timeline of your past visits, powered by your connected Dawarich account
* Dawarich location history support — connect Dawarich to bring your full location history into Parchment

## [0.1.5] - 2026-04-26

### Added

* Realtime system — server-side update pipeline plus web client manager and store handlers for live data sync
* Federated collection sharing — full sharing model with roles, resharing policies, public links, and federated identity support
* Google Docs–style Share Dialog — unified sharing UI with access list, avatars, real names, and public link controls
* Public link lifecycle — mint, revoke, and unauthenticated resolver endpoints
* Versioned collection keys — key rotation orchestrator and scheme-aware encryption support
* Dual-scheme integrations — support for multiple encryption schemes with client hydration and persistence
* Dawarich integration scaffold — E2EE-only integration plumbing and config schema
* Icon system expansion — Lucide alias search, Maki icons tab, and extended icon color options
* Virtualized icon picker — performant large icon grids via virtualization
* Settings search — fuzzy search for faster navigation
* Theme system expansion — extended palette, accent-aware neutrals, and additional theme options
* Toast improvements — ghost-style actions and contextual “View” actions
* Bookmark UX enhancements — collection picker, state badging, and improved interaction flows

### Changed

* Settings UI overhaul — colored icons, submenu structure, and improved navigation
* Share system refactor — replaced legacy dialogs with a unified Share Dialog
* Collections model — now uses last-saved pointer instead of default collection
* Bookmark behavior — second click now performs silent un-save and move
* Icon system wiring — consistent usage across bookmarks and collections
* Integration system refactor — scheme-aware CRUD, filtering, and hydration
* i18n expansion — identity, auth, and key management strings localized (en/es)
* Security UX — “Security” reframed as “Encryption keys” with clearer flows and warnings
* Passkey flow — consolidated to single biometric with automatic encrypted data restore
* Account and dialogs UI polish — tighter layouts, clearer states, improved copy across settings and recovery flows
* Alerts and theming — semantic variants, dark mode support, and refined color scales

### Fixed

* Bookmark write-gate vulnerability and related i18n key issue
* Remove-from-collection endpoint URL bug
* Collection picker ordering instability while open
* Cleanup of orphaned peer state after E2EE identity reset
* Integration controller error handling (distinguish known vs unexpected errors)
* Dependents endpoint scoping and userId leak
* Device-transfer race condition during sealed-seed upload
* Crypto boot checks and environment configuration reliability

### Removed

* Legacy ShareWithFriendDialog in favor of unified sharing flow
* Unused v1 location encryption helpers and stale TODO / placeholder code
* Location history tracking system

## [0.1.4] - 2026-04-18

### Added
* Barrelman tile server support — new integration renders self-hosted vector tiles with the OpenMapTiles schema, bundled with `osm-liberty` and `openmaptiles-default` styles and a basemap style config system
* Nested layer groups — hierarchical layer organization with clone-on-modify semantics, backed by server-side defaults (cycling, transit, mapillary, friends) and DB migrations `0024_layers_unified_model` through `0027`
* Fade basemap option — per-layer toggle that dims the underlying basemap when a layer is active, wired into `layer-visibility` service
* Refined cycling layer — expanded style rules covering bike lanes, trails, and route hierarchy, served through a new server-side tile proxy endpoint
* Unified routing adapters — `barrelman-graphhopper` and `barrelman-valhalla` adapters plus a shared `unified-routing.types` surface, letting trips use Barrelman, GraphHopper, or Valhalla interchangeably
* Custom GraphHopper profile for inner-city street speed limits, with a reusable `graphhopper-custom-model` builder
* Routing preferences UI overhaul — per-profile color system (`route-profile-colors`), richer elevation chart, and new layer-group helpers
* Draggable waypoint markers on the trip detail view, backed by `waypoints-layer` and `base-marker-layer` drag handlers
* Unified floating nav buttons across the drawer UI — new `SheetActionButtons` component used consistently by `BottomSheet`, `LeftSheet`, place, trip, friend, and collection views
* Smooth map padding transitions — map viewport animates in sync with drawer open/close via new `map-padding` utility

### Changed
* Layers system refactor — split monolithic `layer.constants.ts` into per-feature modules (`core-layers`, `cycling-layers`, `transit-layers`, `mapillary-layers`, `user-layer-templates`, etc.) and moved defaults server-side
* `LayerConfiguration` / `LayerGroupConfiguration` rebuilt around the new unified layer model and nested group semantics
* `RoutingPreferences` view rewritten to support multi-provider routing and the new profile color scheme
* `TripDetail` view restructured with improved waypoint handling and elevation chart integration
* Obstructing component logic in `useObstructingComponent` simplified and made reactive to drawer transitions
* UI spacing pass — tightened `BottomSheet`, `LeftSheet`, `MobileNavigation`, responsive dropdown/popover/dialog, and integrations page padding

### Fixed
* GraphHopper profile data issues — corrected custom-model serialization and downstream elevation/segment parsing in `TripDetail` and `directions.store`

## [0.1.2-1] - 2026-04-05

### Added
* OSM Notes layer — toggle in layers panel to view OpenStreetMap notes on the map, with grid-based tile caching (0.5° tiles, 24h TTL, 500 note cap)
* Note detail view — view note comments, status, and metadata with sticky header (back button, status badge, external link to OSM) and fixed footer actions
* Note commenting — add comments to open notes, resolve notes, or reopen resolved notes with per-action loading spinners
* Note creation — right-click context menu "Add note" places a draggable amber pulsing marker, submit via form panel
* OSM OAuth2 integration — connect your OpenStreetMap account to associate notes with your profile

### Changed
* Place detail view only removes its own marker instead of calling `removeAllMarkers`, preserving note layer markers
* Added `text-2xs` (0.625rem) font size to Tailwind theme

## [0.1.1] - 2026-04-02

### Added
* Search along route — find places along a polyline corridor via new `/search/route` endpoint and client-side `searchAlongRoute` service
* Building interior discovery — any building or office area now shows category chips (offices, shops, restaurants, cafes, toilets, drinking water, parking) for exploring what's inside
* Category-enriched search index — POI category labels (e.g. "apartments", "theme park") are now included in the tsvector, so queries like "winnifred apartments" find "The Winnifred"
* Airport code search — IATA/ICAO codes (e.g. "CLT", "AVL") now surface airports via a dedicated codes column and GIN index
* Acronym and abbreviation search — auto-generated abbreviations (e.g. "uncc" → University of North Carolina at Charlotte) stored in `name_abbrev` column with B-tree index
* Barrelman integration tests — 21 integration tests covering exact name match, airport codes, acronyms, global search, local bias, category search, category demotion, and performance

### Changed
* Search ranking overhaul — replaced hard radius filter with proximity-aware ORDER BY (`text_rank / (1 + distance / decay)`) so results are globally available but locally biased
* FTS similarity boost — exact name matches get a relevance boost via `similarity()` threshold, so "Carowinds" ranks above "Days Inn Near Carowinds"
* Category demotion — roads (`highway/*`) and surveillance cameras are demoted in search results to reduce noise
* Search results interleaving — server now returns categories, bookmarks, recent places, and external places interleaved by relevance score instead of grouped by type
* Client search simplified — removed client-side category search and re-sorting; trusts server-side relevance ordering
* Preserve integration ranking — removed pure-distance re-sort in `place.service.ts` that was destroying Barrelman's text-relevance ranking
* Children endpoint — category filter now supports prefix matching (e.g. "office" matches "office/lawyer", "office/accountant")
* Codes generation — rewrote `generate-codes.ts` to use a single SQL UPDATE (~70K rows in seconds vs hours-long batch iteration)
* Import pipeline — `run-import.sh` and `update-osm.sh` now include codes generation step and rebuild tsvector with category labels

### Fixed
* "Carowinds" search ranking — exact name match now ranks first instead of behind partial mentions like "Days Inn Near Carowinds"
* "AVL" / "AVL airport" not finding Asheville Regional Airport — fixed by adding dedicated codes column with IATA/ICAO tags and GIN index
* GIN index not used for code lookups — changed from `= ANY(codes)` to `codes @> ARRAY[query]` which GIN supports
* Search layer sequential scan — split OR condition into separate queries to allow both indexes to be used
* Post-fetch re-rank decay mismatch — aligned SQL and post-fetch decay to same 50km half-life
* `lat=0` falsy bug regression test — ensured lat=0 (equator) doesn't skip location-aware search

## [0.1.0] - 2026-03-31

### Added
###  Barrelman
Barrelman integration introduced to provide faster, more capable OSM search and lookup capabilities. This is a from-scratch server hosted at https://barrelman.parchment.app and self-hostable. Repo and documentation here:
https://github.com/alexwohlbruck/barrelman

### Other
* POI types and categories with icon and color mapping
* Maki icon support for place type display
* Place detail widgets system (OSM tags, related places, transit)
* Nearby categories component for discovering places
* Overpass integration for querying OpenStreetMap data
* Place type chip component
* Keyboard shortcut hints in minimized side navigation
* Startup location options in behavior settings
* Abort controller composable for managing async requests
* App data caching layer
* Map bounds utilities
* Barrelman and search service tests
* Category service tests

### Changed
* Redesigned place header with category icons and colors
* Improved place list items with richer type information
* Refactored search utilities and search results display
* Enhanced category store with palette-based color assignment
* Updated Nominatim adapter response handling

### Fixed
* Bottom sheet fit-content scroll interaction

[Releases before 0.1.0](https://github.com/alexwohlbruck/parchment/releases?q=v0.0) are listed on GitHub.
