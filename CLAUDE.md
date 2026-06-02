# Parchment

## Architecture

- **Parchment server** (API): runs in Docker as `parchment-server`, port 5000. Restart with `docker compose -f docker-compose.dev.yml restart parchment-server`
- **Parchment web** (Vite): runs on port 5173. HMR handles client code changes. Do NOT start a new dev server.
- **Barrelman** (geospatial engine): separate repo at `../barrelman`, Docker container `barrelman`, port 5001. Rebuild with `cd ../barrelman && docker build -t alexwohlbruck/barrelman:latest . && docker compose up -d barrelman`
- **Parchment DB**: Docker container `parchment-db`
- **Barrelman DB**: Docker container `barrelman-db`, port 5434

## When to restart what

- **Client code changes** (`web/src/`): Vite HMR picks them up automatically
- **Server code changes** (`server/src/`): `bun --hot` in Docker picks them up automatically (source is volume-mounted from `./server` into the container). If hot reload fails: `docker compose -f docker-compose.dev.yml restart parchment-server`
- **Barrelman code changes** (`../barrelman/src/`): must rebuild and restart — `cd ../barrelman && docker build -t alexwohlbruck/barrelman:latest . && docker compose up -d barrelman`

## Important rules

- Do NOT start new dev servers. The user runs their own.
- Do NOT merge to main. Work on feature branches.
- Use `bun` over `npm` for package management.
- No uppercase tracking-wider text in UI.
- Commit messages: short (5-20 words), distinct logical commits.
