### Added
- OSM Notes layer — toggle in layers panel to view OpenStreetMap notes on the map, with grid-based tile caching (0.5° tiles, 24h TTL, 500 note cap)
- Note detail view — view note comments, status, and metadata with sticky header (back button, status badge, external link to OSM) and fixed footer actions
- Note commenting — add comments to open notes, resolve notes, or reopen resolved notes with per-action loading spinners
- Note creation — right-click context menu "Add note" places a draggable amber pulsing marker, submit via form panel
- OSM OAuth2 integration — connect your OpenStreetMap account to associate notes with your profile

### Changed
- Place detail view only removes its own marker instead of calling `removeAllMarkers`, preserving note layer markers
- Added `text-2xs` (0.625rem) font size to Tailwind theme
