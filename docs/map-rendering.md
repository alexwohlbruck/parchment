# Map rendering benchmarks

Run the live app in an isolated preview, sign in with a disposable development account, and save a Playwright storage state outside the repository. The benchmark changes that browser context's map settings and local layer visibility. It does not import data or change the shared renderer's defaults.

From `web/`:

```sh
BENCH_URL=https://your-preview.example \
BENCH_API_URL=https://your-preview-api.example \
BENCH_STORAGE_STATE=/private/path/state.json \
BENCH_OUTPUT=/private/path/results.json \
bun scripts/bench-map-rendering.mjs
```

The runner uses one Chromium instance, a 390 × 844 CSS-pixel viewport, and device pixel ratio 2. It compares the base map, transit, cycling, both overlays, and both overlays with terrain. Buildings, 3D objects, and detailed roads stay enabled in every configuration.

Each configuration runs at 1×, 4×, and 6× CPU slowdown. Each tier repeats a programmed pan, a pitch/rotation sweep, and two trusted touch drags. Touch movement is sent on a fixed cadence; slow input acknowledgements do not slow the generated gesture. Reset and initial tile settling are excluded from the measured interval; each interaction includes a 700 ms tail.

Results include animation-frame gap percentiles, map render submission durations, tasks over 50 ms, source-query timings, input acknowledgement delays, camera positions, and layer/source counts. Input acknowledgement latency is a CDP responsiveness proxy, not INP or touch-to-photon latency. Render submission duration includes synchronous driver waits and does not isolate GPU execution time.

CPU throttling does not emulate another device's GPU, memory bandwidth, refresh rate, or thermal behavior. Check the recorded WebGL renderer: software rendering and hardware rendering are different experiments. `BENCH_BROWSER_ARGS` accepts a JSON array of Chromium launch arguments to configure the local graphics backend. Keep that configuration identical between revisions.

Optional settings:

- `BENCH_REPEATS`: repetitions per scenario, default `2`.
- `BENCH_CONFIG`: comma-separated subset of `base,transit,cycling,combined,terrain`.
- `BENCH_RATES`: comma-separated CPU slowdown rates, default `1,4,6`.
- `BENCH_CAMERA`: JSON camera options, with `center` as `[longitude, latitude]`.
- `BENCH_PROFILE=1`: save a CPU profile beside the result for every measured interaction. Run profiling separately from timing comparisons.

The runner writes results after each interaction and captures a screenshot after each layer configuration. Results, screenshots, profiles, and authentication state can contain account data or private URLs; inspect them before sharing. Keep raw artifacts outside the repository.

Compare identical workloads in the same browser and graphics configuration. Run browsers serially, avoid concurrent builds/tests, and repeat promising results in alternating revision order. Treat a single maximum as an observation; use repeated frame-gap distributions and long-task totals to assess a change. Inspect screenshots and camera endpoints to verify that the intended layers and gestures actually rendered. Physical-device testing remains necessary before making device-specific performance claims.
