# Map rendering performance — 28 October 2026

POI elevation and landmark building checks caused avoidable main-thread stalls. The patch caches unchanged work, breaks those passes into cooperative chunks, and removes an eager geometry expansion in 3D object placement. It improves typical frame gaps under CPU pressure; substantial rendering stalls remain.

## Main comparison

These are CPU proxies on one shared GPU, not measurements of three physical phones. Values below are medians of 15 scenario-level p95 frame gaps per tier, not pooled frame percentiles. Lower is better.

| CPU slowdown | Before | After | Reduction | Worst observed gap before → after |
| --- | ---: | ---: | ---: | ---: |
| 1× | 233 ms | 200 ms | 14% | 567 → 400 ms |
| 4× | 833 ms | 533 ms | 36% | 1783 → 900 ms |
| 6× | 1000 ms | 550 ms | 45% | 2333 → 1350 ms |

Of 45 matched scenarios, p95 improved in 37, increased in 4, and was effectively unchanged in 4 (1 ms tolerance). This is a single-pass screening matrix, with separate focused profiling and longer observation passes; it is not a confidence interval or a device certification.

## Every camera/layer case

Each cell is before → after p95 animation-frame gap, in milliseconds. The base map includes buildings, detailed roads, and 3D objects.

| Configuration | CPU | Pan | Tilt + rotate | Trusted touch drag |
| --- | ---: | ---: | ---: | ---: |
| Base + 3D | 1× | 283 → 150 | 233 → 200 | 300 → 233 |
| Base + 3D | 4× | 767 → 467 | 800 → 400 | 617 → 367 |
| Base + 3D | 6× | 1167 → 500 | 1300 → 433 | 583 → 533 |
| Transit + 3D | 1× | 233 → 267 | 183 → 217 | 200 → 167 |
| Transit + 3D | 4× | 1783 → 517 | 1317 → 567 | 767 → 450 |
| Transit + 3D | 6× | 817 → 517 | 900 → 817 | 1017 → 500 |
| Cycling + 3D | 1× | 317 → 117 | 183 → 183 | 200 → 200 |
| Cycling + 3D | 4× | 1167 → 683 | 833 → 433 | 683 → 533 |
| Cycling + 3D | 6× | 867 → 1350 | 1717 → 550 | 1217 → 500 |
| Transit + cycling + 3D | 1× | 200 → 150 | 183 → 183 | 267 → 200 |
| Transit + cycling + 3D | 4× | 1000 → 700 | 1100 → 900 | 417 → 383 |
| Transit + cycling + 3D | 6× | 1517 → 400 | 933 → 867 | 800 → 783 |
| Both overlays + terrain + 3D | 1× | 333 → 333 | 483 → 333 | 567 → 233 |
| Both overlays + terrain + 3D | 4× | 1300 → 733 | 700 → 683 | 1483 → 900 |
| Both overlays + terrain + 3D | 6× | 917 → 933 | 1000 → 667 | 2333 → 850 |

## Causes and patches

* **POI elevation hydration:** the profiled 4× combined-layer pan sampled about 1296 ms in hydration before the change and 180 ms afterward. Rebuilding the footprint grid and repeating point-in-polygon joins dominated this app-side path. The patch reuses unchanged footprint indexes and elevations, limits refreshes to relevant changes, and yields between batches.
* **Landmark containment:** the same pan sampled about 398 ms in landmark gathering before and 119 ms afterward. Containment grouping and scans now yield between batches and coalesce arriving changes. Both passes use a shared scheduler with a 4 ms cooperative budget; a single native source query can still exceed that budget.
* **3D object exclusion geometry:** the longer 6× cycling pan sampled about 1360 → 185 ms in object gathering, with 1053 ms attributed to exclusion indexing before the change (that function was not observed in samples in the repeat; this does not establish zero cost). An eager `areas.flatMap(...)` decoded/projected all areas before the first yield. The follow-up uses lazy polygon projection and yields while traversing the areas.
* **Startup style race:** an async object-model load could complete while a replacement style was still parsing, producing “Style is not done loading.” Object setup and deck setup now defer to the next loaded style in that state. POI sources are mounted before deferring their expensive hydration, avoiding a late style mutation during startup.

Profile values are cumulative sampled inclusive CPU time across a separate profiling window, not per-call wall times. Parent and child values overlap. Profiling was separate from the main timing matrix. The geometry follow-up was validated with its focused repeat and targeted tests; the complete 45-case matrix measures the earlier POI/landmark patch.

## Remaining stalls and limits

* The 6× cycling pan regressed from 867 to 1,350 ms p95 in the screening pass. Its map render submission reached 1,122 ms; source queries in that case were at most 70 ms. That localizes the largest observed stall to the render path, but does not distinguish engine layout, model upload, driver waiting, or GPU execution. The 1.35-second gap did not reproduce in the longer repeat (783 ms peak before the geometry follow-up, 650 ms after).
* The 6× terrain pan was 917 → 933 ms p95. Two 1× transit cases increased by about 33 ms. These remain in the results rather than being filtered out.
* Tile reception/decoding, symbol placement, garbage collection, native source queries, and render/driver calls remain visible in profiles. Dedicated GPU timing and a worker/renderer trace are the next investigations before attributing the remaining render stalls to a specific GPU operation.
* The longer final 6× cycling pass had all 5,314 POIs loaded after pan and drag. The extreme tilt still had pending POI source work after five seconds. The fixed 4× combined-layer profile had 5,314 POIs loaded after all three interactions with the ordinary 700 ms tail.
* Long-task counts increased from 955 to 1,048, while observed long-task time fell from 181.1 to 150.2 seconds across shorter total measured intervals (254.0 → 201.5 seconds). More smaller tasks and more rendered frames are compatible with better responsiveness; these totals do not establish lower battery use.
* The app still polls global style readiness during layer initialization. That can wait on unrelated tile sources; replacing the poll with narrower lifecycle readiness would be a useful separate refactor.

## Method and validation

* MapLibre development preview; one Chromium browser at a time; 390 × 844 CSS pixels; DPR 2; hardware-accelerated WebGL on the host recorded in the JSON artifacts.
* Midtown Manhattan, center [-73.984, 40.7549], zoom 15.5, initial pitch 55°, bearing 20°. Five layer configurations at 1×, 4×, and 6× CDP CPU slowdown, with three camera workloads each.
* Pan and tilt/rotation use two 1,600 ms camera animations. Touch dragging sends two 24-step trusted touch paths at a fixed 16 ms host cadence. Touch coalescing and inertia can produce different end centers under load; endpoints are recorded. Programmed camera sweeps are deterministic; physical two-finger recognition was checked separately.
* Each main interaction includes a 700 ms post-gesture tail; supplementary cycling passes use five seconds. Camera reset runs at 1× CPU outside the measured interval. Profiling runs are excluded from the main timing table.
* Initial fixed-version base/transit measurements had different mounted layer counts and were excluded. Their replacement runs wait for the search, bookmark, and collection sources. All 45 selected comparisons have matching configuration-start layer/source counts. The other 27 cases were already initialized and retained; the subsequent initial-mount ordering fix leaves their steady-state path unchanged.
* Layer counts include 256 layers / 19 sources for base and cycling, 373 / 36 with transit, and 373 / 37 with terrain. Cycling enables 24 basemap style layers; transit adds 117 style layers in this viewport.
* A separate trusted two-finger gesture at 4× CPU moved pitch from 35° to 80°. 3D objects were present, 4,292 POIs were loaded for the new view, and no page errors were recorded.
* Full frontend suite: 255 files / 4,082 tests passed before the follow-ups. After the startup-ordering and geometry follow-ups, all 779 targeted tests passed, including the new lazy-geometry regression test. Final TypeScript check passed. The final cold-start gesture check recorded zero page errors and confirmed the object layer was present.
* All comparisons use the same preview/backend, credentials, map settings, and graphics backend. Network timing, cache warmth, and real-time map data are not fully controlled. CPU slowdown does not emulate phone GPU, memory bandwidth, thermal behavior, Safari, or a native WebView. Physical-device and production-build measurements are still needed for device-specific claims.

## Review data

* [Scenario comparison CSV](../.github/pr-assets/map-rendering.csv).
* [Benchmark instructions](map-rendering.md).
* [Two-finger tilt screenshot](../.github/pr-assets/map-rendering.png).

Raw browser profiles and authenticated artifacts are retained outside the public repository.
