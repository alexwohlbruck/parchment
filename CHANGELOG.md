### Added
- Search along route — find places along a polyline corridor via new `/search/route` endpoint and client-side `searchAlongRoute` service
- Building interior discovery — any building or office area now shows category chips (offices, shops, restaurants, cafes, toilets, drinking water, parking) for exploring what's inside
- Category-enriched search index — POI category labels (e.g. "apartments", "theme park") are now included in the tsvector, so queries like "winnifred apartments" find "The Winnifred"
- Airport code search — IATA/ICAO codes (e.g. "CLT", "AVL") now surface airports via a dedicated codes column and GIN index
- Acronym and abbreviation search — auto-generated abbreviations (e.g. "uncc" → University of North Carolina at Charlotte) stored in `name_abbrev` column with B-tree index
- Barrelman integration tests — 21 integration tests covering exact name match, airport codes, acronyms, global search, local bias, category search, category demotion, and performance

### Changed
- Search ranking overhaul — replaced hard radius filter with proximity-aware ORDER BY (`text_rank / (1 + distance / decay)`) so results are globally available but locally biased
- FTS similarity boost — exact name matches get a relevance boost via `similarity()` threshold, so "Carowinds" ranks above "Days Inn Near Carowinds"
- Category demotion — roads (`highway/*`) and surveillance cameras are demoted in search results to reduce noise
- Search results interleaving — server now returns categories, bookmarks, recent places, and external places interleaved by relevance score instead of grouped by type
- Client search simplified — removed client-side category search and re-sorting; trusts server-side relevance ordering
- Preserve integration ranking — removed pure-distance re-sort in `place.service.ts` that was destroying Barrelman's text-relevance ranking
- Children endpoint — category filter now supports prefix matching (e.g. "office" matches "office/lawyer", "office/accountant")
- Codes generation — rewrote `generate-codes.ts` to use a single SQL UPDATE (~70K rows in seconds vs hours-long batch iteration)
- Import pipeline — `run-import.sh` and `update-osm.sh` now include codes generation step and rebuild tsvector with category labels

### Fixed
- "Carowinds" search ranking — exact name match now ranks first instead of behind partial mentions like "Days Inn Near Carowinds"
- "AVL" / "AVL airport" not finding Asheville Regional Airport — fixed by adding dedicated codes column with IATA/ICAO tags and GIN index
- GIN index not used for code lookups — changed from `= ANY(codes)` to `codes @> ARRAY[query]` which GIN supports
- Search layer sequential scan — split OR condition into separate queries to allow both indexes to be used
- Post-fetch re-rank decay mismatch — aligned SQL and post-fetch decay to same 50km half-life
- `lat=0` falsy bug regression test — ensured lat=0 (equator) doesn't skip location-aware search
