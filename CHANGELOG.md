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
