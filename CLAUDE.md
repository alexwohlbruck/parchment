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
- When creating pull requests, if applicable, run the app and take a screenshot of the feature or change and attach to the PR for visual confirmation.
