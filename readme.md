<img src="web/src/assets/parchment.svg" width="50" height="50" alt="" />

# Parchment Maps

A modern mapping and navigation app based on open data and open source technologies.

---

## Requirements

- **Docker** and **Docker Compose** (for Docker-based dev and deployment)
- **Git**
- **Bun** (optional; for standalone dev and running scripts)

---

## Environment variables

### Local development & production

Create `.env` from the template and set:

| Variable | Description |
|----------|-------------|
| `POSTGRES_DB` | Database name |
| `POSTGRES_USER` | Database user |
| `POSTGRES_PASSWORD` | Database password |
| `SERVER_ORIGIN` | Backend URL (e.g. `http://localhost:5000`) |
| `CLIENT_ORIGIN` | Frontend URL (e.g. `http://localhost:5173`) |
| `GMAIL_EMAIL` | Gmail address (user emails) |
| `GMAIL_APP_PASSWORD` | Gmail app password |
| `APP_TESTER_EMAIL` | Test user email (dev/e2e) |

---

## Development

### With Docker (recommended)

```bash
git clone https://github.com/alexwohlbruck/parchment.git
cd parchment
cp .env.example .env
# Edit .env with your values

./start.sh dev
```

- **Frontend:** http://localhost:5173  
- **API:** http://localhost:5000  
- **API docs:** http://localhost:5000/swagger  

Stop: `./start.sh dev --down`

### Standalone (server + web locally)

1. **Database** — Start the DB only (`docker compose -f docker-compose.dev.yml up -d parchment-db`) or use a local Postgres with PostGIS.
2. **Server** — `cd server && bun install && bun run dev` (set `DATABASE_URL`, `SERVER_ORIGIN`, `CLIENT_ORIGIN`, `GMAIL_*`, `APP_TESTER_EMAIL` in env).
3. **Web** — `cd web && bun install && bun dev` (set `VITE_SERVER_ORIGIN` and any other needed env).

---

## Build

### Local builds (no release)

| Target | Command |
|--------|---------|
| Docker images | `docker compose -f docker-compose.prod.yml build` |
| Desktop (Tauri) | `cd web && bun run build:desktop` |
| Android | `cd web && bun run build:android` |
| iOS | `cd web && bun run build:ios` |

### Releasing

1. Run **`./deploy.sh patch`** (or `minor`, `major`, or `--version X.Y.Z`).
2. The script:
   - Bumps version in `package.json`, `tauri.conf.json`, `Cargo.toml`, and Android `versionCode`
   - Prompts you to confirm and to add a `CHANGELOG.md` entry for the new version
   - Commits the version files, creates tag `vX.Y.Z`, and pushes
3. **Pushing the tag** triggers the [GitHub Actions Release](#github-actions-release) workflow (Docker images, Tauri desktop + mobile, GitHub Release with artifacts).

Required secrets: see table below.

---

## Deployment

### Standalone (single machine)

```bash
curl -o docker-compose.prod.yml https://raw.githubusercontent.com/alexwohlbruck/parchment/main/docker-compose.prod.yml
curl -o .env https://raw.githubusercontent.com/alexwohlbruck/parchment/main/.env.example
# Edit .env (see Environment variables), then:
docker compose -f docker-compose.prod.yml up -d
```

### Homelab / existing Docker setup

1. Add Parchment as a Compose include:

   ```bash
   mkdir -p parchment
   curl -o parchment/docker-compose.yml https://raw.githubusercontent.com/alexwohlbruck/parchment/main/docker-compose.prod.yml
   ```

2. Add required env vars to your main `.env` (see [Environment variables](#environment-variables) above).

3. In your main `docker-compose.yml`:

   ```yaml
   include:
     - parchment/docker-compose.yml
   ```

4. Start: `docker compose up -d`

To attach Parchment to a reverse-proxy network, add an override that puts `parchment-server` and `parchment-web` on your proxy network.

### GitHub Actions (release)

Create and push a release tag with `./deploy.sh patch` (or `minor` / `major`). The **Release** workflow then:

- Builds and pushes Docker images to Docker Hub  
- Builds Tauri desktop (macOS, Windows, Linux) and mobile (Android, iOS)  
- Creates a GitHub Release with the CHANGELOG section and uploads all artifacts  

**Repository secrets:**

| Secret | Required | Notes |
|--------|----------|--------|
| `DOCKERHUB_USERNAME` | Yes | Push Docker images |
| `DOCKERHUB_TOKEN` | Yes | Push Docker images |
| `TAURI_SIGNING_PRIVATE_KEY` | Yes | Sign Tauri desktop builds |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Yes | Decrypt signing key |
| `TAURI_SIGNING_PUBLIC_KEY` | Yes | Updater manifest |
| `APPLE_CERTIFICATE_BASE64`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_PROVISIONING_PROFILE_BASE64` | No | iOS builds |
| `APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_CONTENT` | No | TestFlight upload |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | No | Play Store upload |
| `GOOGLE_PLAY_TRACK` | No | `internal` \| `alpha` \| `beta` \| `production` |

**E2E:** Builds `.env.test` from the same [environment variables](#environment-variables) (or repo secrets / defaults).

---

## Other

| Task | Command |
|------|---------|
| Seed a user | `docker exec parchment-server bun run seed:dev "First" "Last" "email@example.com" "https://example.com/photo.jpg"` |
| Unit tests | `cd web && bun run test` |
| E2E tests | `cd web && bun run test:e2e` (requires Docker and `.env.test`) |

---

## License

This software is licensed under **Apache 2.0 with the Commons Clause**. You may use, modify, and self-host it; you may not sell the software or a product/service whose value derives substantially from it. See [LICENSE](LICENSE) for full terms.
