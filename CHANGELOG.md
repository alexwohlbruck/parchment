## Added
###  Barrelman
Barrelman integration introduced to provide faster, more capable OSM search and lookup capabilities. This is a from-scratch server hosted at https://barrelman.parchment.app and self-hostable. Repo and documentation here:
https://github.com/alexwohlbruck/barrelman

### Other
- POI types and categories with icon and color mapping
- Maki icon support for place type display
- Place detail widgets system (OSM tags, related places, transit)
- Nearby categories component for discovering places
- Overpass integration for querying OpenStreetMap data
- Place type chip component
- Keyboard shortcut hints in minimized side navigation
- Startup location options in behavior settings
- Abort controller composable for managing async requests
- App data caching layer
- Map bounds utilities
- Barrelman and search service tests
- Category service tests

## Changed
- Redesigned place header with category icons and colors
- Improved place list items with richer type information
- Refactored search utilities and search results display
- Enhanced category store with palette-based color assignment
- Updated Nominatim adapter response handling

## Fixed
- Bottom sheet fit-content scroll interaction
