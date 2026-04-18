### Added
- Barrelman tile server support — new integration renders self-hosted vector tiles with the OpenMapTiles schema, bundled with `osm-liberty` and `openmaptiles-default` styles and a basemap style config system
- Nested layer groups — hierarchical layer organization with clone-on-modify semantics, backed by server-side defaults (cycling, transit, mapillary, friends) and DB migrations `0024_layers_unified_model` through `0027`
- Fade basemap option — per-layer toggle that dims the underlying basemap when a layer is active, wired into `layer-visibility` service
- Refined cycling layer — expanded style rules covering bike lanes, trails, and route hierarchy, served through a new server-side tile proxy endpoint
- Unified routing adapters — `barrelman-graphhopper` and `barrelman-valhalla` adapters plus a shared `unified-routing.types` surface, letting trips use Barrelman, GraphHopper, or Valhalla interchangeably
- Custom GraphHopper profile for inner-city street speed limits, with a reusable `graphhopper-custom-model` builder
- Routing preferences UI overhaul — per-profile color system (`route-profile-colors`), richer elevation chart, and new layer-group helpers
- Draggable waypoint markers on the trip detail view, backed by `waypoints-layer` and `base-marker-layer` drag handlers
- Unified floating nav buttons across the drawer UI — new `SheetActionButtons` component used consistently by `BottomSheet`, `LeftSheet`, place, trip, friend, and collection views
- Smooth map padding transitions — map viewport animates in sync with drawer open/close via new `map-padding` utility

### Changed
- Layers system refactor — split monolithic `layer.constants.ts` into per-feature modules (`core-layers`, `cycling-layers`, `transit-layers`, `mapillary-layers`, `user-layer-templates`, etc.) and moved defaults server-side
- `LayerConfiguration` / `LayerGroupConfiguration` rebuilt around the new unified layer model and nested group semantics
- `RoutingPreferences` view rewritten to support multi-provider routing and the new profile color scheme
- `TripDetail` view restructured with improved waypoint handling and elevation chart integration
- Obstructing component logic in `useObstructingComponent` simplified and made reactive to drawer transitions
- UI spacing pass — tightened `BottomSheet`, `LeftSheet`, `MobileNavigation`, responsive dropdown/popover/dialog, and integrations page padding

### Fixed
- GraphHopper profile data issues — corrected custom-model serialization and downstream elevation/segment parsing in `TripDetail` and `directions.store`
