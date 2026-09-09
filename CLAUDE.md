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

- Group entries under `### Added`, `### Changed`, or `### Fixed` within `[Unreleased]`. All three headings are always present, even when empty — append under the right one rather than adding or removing a heading. They exist as merge anchors: two branches that each have to invent a heading conflict, two branches filling in different existing headings do not. Empty headings are stripped back out at release time, so they never ship.
- One `*` bullet per change, written for users rather than developers: what it does for them, not which files moved.
- Keep each bullet short: usually one sentence, with a second only when it adds necessary user-facing context.
- Prefer plain, direct language over scene-setting or long explanations. If a bullet needs more than about 30 words, tighten it.
- Skip purely internal work (refactors, test-only changes, dependency bumps) — if a user wouldn't notice it, it doesn't belong here.
- Never edit the released `## [X.Y.Z]` sections. `deploy.sh` retitles `[Unreleased]` at release time and opens a fresh empty one; `scripts/changelog.sh` is the only thing that should rewrite the file.

## Frontend architecture (`web/src`)

These rules exist because the codebase drifted away from each of them. When
something here conflicts with what a nearby file does, follow the rule — the
neighbour is what we are moving away from.

### Where code goes

Organise by **module** (the entity: place, transit, directions, library,
identity, …), then by layer inside it. A module owns its UI, state and logic.

| Directory | Holds | Never holds |
|---|---|---|
| `views/` | Components a route renders, one folder per module | Child components. If the router doesn't name it, it belongs in `components/<module>/` |
| `components/<module>/` | Vue SFCs, plus small helpers only those SFCs use (`context.ts`, local `types.ts`) | A class or service the rest of the app calls. Two map strategies lived here for years |
| `components/ui/` | Design-system primitives, which may read ambient app context (theme, hotkeys) | Any domain module — place, transit, directions, library. A primitive that knows what a Place is has stopped being a primitive |
| `services/` | I/O and orchestration for a module | Reactive UI state — that is a store |
| `stores/` | Named singleton state | HTTP calls, or imports of `.vue` files |
| `composables/<module>/` | Reusable `use*` returning caller-scoped state | Module-level singleton state (that is a store), or logic used by exactly one component (co-locate it) |
| `lib/<module>/` | Pure, framework-free functions | Anything reaching into a store or service |

`lib/` root is for genuinely cross-cutting infrastructure only (api, toast,
connectivity, time, utils). A new file there needs a reason not to live in
`lib/<module>/`.

**Dependencies point one way:** `views → components → composables → stores →
services → lib`. A `lib/` file importing a store, or a service importing a
`.vue`, is a defect — fix the direction rather than adding the import.

`composables/` root is for the genuinely cross-cutting ones (`useAbortController`,
`useClipboard`, `useHotkeys`); anything a module owns goes in
`composables/<module>/`.

**Split a directory before it hits ~20 files.** Every flat dumping ground in
this repo started as "just a few more files here".

### Naming

- Files: kebab-case, except `composables/` (camelCase, mirroring the export)
  and `.vue` (PascalCase).
- Suffixes carry meaning and are not decorative: `.store.ts`, `.service.ts`,
  `.types.ts`, `.test.ts`. Do **not** add `.utils.ts` — a file in `lib/` is
  already utilities. Do not invent new suffixes.
- The filename must describe the contents. If the file exports one renderer,
  do not call it `*.utils.ts`; if it holds one serializer, do not call it
  `storage.ts`.
- The local identifier in an import matches the file it came from.
- No two files share a name unless they are the same thing at different
  layers, and even then prefer distinct names (`MapCanvas.vue` vs `Map.vue`).
- List components are singular-per-entity: `RouteList.vue`, not `RoutesList.vue`.

### Duplication

- The second copy of a block is a warning; the **third is a bug**. Extract it.
  Three hand-written copies of one dialog's params is how collections silently
  lost their icon pack.
- Before writing a helper, grep for it. Distance, capitalize and countdown
  formatting each existed 3–6 times here.
- Two exports with the same name in one package hide dead code: a live
  `getRouteColor` in `lib/transit/transit.ts` masked an unused one next to it
  long enough that the whole file it lived in went stale unnoticed.
- Frontend types that mirror the server must re-export from `@server/...`, not
  restate the shape. See `types/place.types.ts` for the pattern.

### Deleting

- Delete dead code the moment you find it; do not comment it out and do not
  leave it "for symmetry". Verify with a grep across `src/` and `e2e/` first.
- A feature removed from the UI is not removed until its component, its type,
  its store field and its dependency are gone.

### Reactivity and cleanup

- Every `on`/`addEventListener`/`setInterval`/`observe` needs its matching
  teardown in the same file, keyed to the same lifetime.
- `mitt`'s `off(type)` with no handler removes **every** listener for that
  type, including other modules'. Always pass the handler.
- Wrap large or non-plain payloads in `shallowRef`, and `markRaw` anything
  holding a map instance, a GL object or a Vue component. Deep reactivity over
  a route shape or a maplibre `Map` is a performance defect.
- Do not `watch(..., { deep: true })` an unbounded array to mirror it into a
  local ref. Watch an id, or read the prop.

### Dev-only code

Gate the **route**, not just the nav entry:
`...(import.meta.env.DEV ? [devRoute] : [])`. A DEV-gated menu item still ships
a reachable page — `/settings/developer` shipped working impersonation controls
to production this way.

### Tests

Test the shipped module, never a copy of its logic pasted into the test file.
If a test needs to reimplement a component's computed to test it, extract that
computed to `lib/` and test it there.

## Important rules

- Do NOT start new dev servers. The user runs their own.
- Do NOT merge to main. Work on feature branches.
- If a Linear ticket was linked for the relevant work, update the status of the ticket as work progresses.
- Use `bun` over `npm` for package management.
- Commit messages: short (5-20 words), distinct logical commits.
- Keep code structure clean, modular, and dry. Use concise, straightforward naming conventions and move code to appropriate modules when it isn't in the correct place.
- Comments are a last resort, not a deliverable. Default to none: clear names and small functions carry the meaning. Write one only when the code cannot say it itself — a non-obvious constraint, a gotcha in an external API, a why that the how doesn't show.
  - Hard cap: one or two lines. If it needs a paragraph, the code needs the work instead.
  - Never narrate the change: no "used to be X", no bug history, no explaining the fix to a reviewer. That belongs in the commit message and the PR body, which are the durable record. A comment that only makes sense next to the diff is dead the moment the diff lands.
  - Never restate the code, the test name, or the function name in prose.
  - Do not match the comment density of a heavily-commented file. Some existing files over-comment; that is not the standard to copy.
- "Modules" represent all code components for a single entity. Users, directions, search, settings, etc are all modules. These module identities are represented throught the codebase and should contain related UI, data, and business logic for that entity. Make sure to keep new and old code nicely modularized.
- Offer to refactor malformed code when we come across any. This is anything that doesn't follow our normal conventions or industry practices.
- When we add new features, integrations, modules, etc, update the relevant documentation in the sibiling `parchment-docs` repo.
- Write clean, functional tests for new code logic. Do not add frivilous or non-meaningful tests.
- Keep the swagger API documentation up-to-date and clean while making changes to the backend.
- Always apply a clean, minimalist, and refined style when designing UI.
- No uppercase tracking-wider text in UI.
- When creating pull requests, if applicable, run the app and take a screenshot of the feature or change and attach to the PR for visual confirmation.
