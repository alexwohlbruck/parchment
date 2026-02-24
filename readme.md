# Parchment Maps

A modern mapping and navigation app based on open data and open source technologies.

## 🚀 Quick Start

### Prerequisites
- [Docker](https://www.docker.com/) and [Docker Compose](https://docs.docker.com/compose/)
- [Git](https://git-scm.com/)

### 1. Clone and Setup
```bash
git clone https://github.com/alexwohlbruck/parchment.git
cd parchment
```

### 2. Environment Configuration
Copy the example environment file and configure your settings:
```bash
cp .env.example .env
```

Edit `.env` with your configuration:
```bash
# Database credentials
POSTGRES_DB=parchment
POSTGRES_USER=server_user
POSTGRES_PASSWORD=your_secure_password

# Server configuration
SERVER_ORIGIN=http://localhost:5000
CLIENT_ORIGIN=http://localhost:5173

# Email configuration (for user notifications)
GMAIL_EMAIL=your_email@gmail.com
GMAIL_APP_PASSWORD=your_gmail_app_password
APP_TESTER_EMAIL=your_test_email@gmail.com

# API Keys (get these from respective providers)
MAPBOX_ACCESS_TOKEN=your_mapbox_token
TRANSITLAND_API_KEY=your_transitland_key
MAPTILER_API_KEY=your_maptiler_key
MAPILLARY_ACCESS_TOKEN=your_mapillary_token
```

### 3. Start the Application

#### Development Mode (with hot-reload)
```bash
./start.sh dev
```

#### Production Mode (using published images)
```bash
./start.sh prod
```

The application will be available at:
- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:5000
- **API Documentation**: http://localhost:5000/swagger

### 4. Stop the Application
```bash
./start.sh dev --down    # Stop development
./start.sh prod --down   # Stop production
```

## 🛠️ Development

### Building for Production
```bash
# Build and push Docker images and mobile apps (requires Docker Hub access)
./deploy.sh patch    # Increment patch version and deploy
./deploy.sh minor    # Increment minor version and deploy
./deploy.sh major    # Increment major version and deploy
```

### GitHub Actions workflows

| Workflow | Trigger | What it does |
|----------|---------|----------------|
| **E2E Tests** | Push or pull request to `main` or `dev` | Runs web unit tests, then Playwright e2e tests (Docker test stack + dev server). Use a branch ruleset to require the **e2e** check before merging into `dev` or `main`. |
| **Release** | Push of a tag `v*` (e.g. `v0.0.16`) | Runs unit tests, builds Docker images (push to Docker Hub), builds Tauri Android (AAB), macOS (DMG), iOS (IPA), creates GitHub Release with CHANGELOG body and uploads assets. Optionally uploads AAB to Google Play if `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` is set. |

Required secrets: 
- **DOCKERHUB_USERNAME**, **DOCKERHUB_TOKEN** (for Release)
- **APPLE_CERTIFICATE_BASE64**, **APPLE_CERTIFICATE_PASSWORD**, **APPLE_PROVISIONING_PROFILE_BASE64** (for iOS builds - see [iOS Signing Setup Guide](docs/ios-signing-setup.md))

Optional secrets:
- **GOOGLE_PLAY_SERVICE_ACCOUNT_JSON**, **GOOGLE_PLAY_TRACK** (for Android Play Store upload)
- **APP_STORE_CONNECT_API_KEY_ID**, **APP_STORE_CONNECT_ISSUER_ID**, **APP_STORE_CONNECT_API_KEY_CONTENT** (for automatic TestFlight upload)
- **E2E_MAPBOX_ACCESS_TOKEN** (E2E Tests, for map tests)

### Releases (CI/CD)

**Version and changelog:** The app version lives in `web/package.json` (and is synced to `server/package.json`, `web/src-tauri/tauri.conf.json`, and `web/src-tauri/Cargo.toml` by `deploy.sh`). Release notes are kept in **`CHANGELOG.md`** at the repo root ([Keep a Changelog](https://keepachangelog.com/) format). That file is the source for GitHub Release bodies.

**How to cut a release:**
1. Bump the version (e.g. `./deploy.sh patch`) and update `CHANGELOG.md` with a new `## [X.Y.Z] - date` section.
2. Commit, push, then create and push a tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.
3. The **Release** workflow runs on tag push: builds Docker images (pushed to Docker Hub), builds Tauri Android (AAB), macOS (DMG), and iOS (IPA), then creates a **GitHub Release** for that tag with the CHANGELOG section as the body and uploads the built artifacts as release assets.

**Secrets:** In the repo’s GitHub Actions secrets, set `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` so the workflow can push images. For iOS builds, configure Apple code signing (e.g. `APPLE_SIGNING_IDENTITY`, `APPLE_DEVELOPMENT_TEAM`) if you use them.

**Consuming release notes (app “What’s new” / landing page):** Use the [GitHub Releases API](https://docs.github.com/en/rest/releases/releases). For example:
- **Latest release:** `GET https://api.github.com/repos/alexwohlbruck/parchment/releases/latest` → `body` is markdown release notes, `tag_name` is the version.
- **Release by version:** `GET https://api.github.com/repos/alexwohlbruck/parchment/releases/tags/v{X.Y.Z}`.
- **Release history:** `GET https://api.github.com/repos/alexwohlbruck/parchment/releases` (paginated).

The app can compare `tag_name` (or a parsed version) with the current `APP_VERSION` to show “What’s new” on update; the landing page can list releases from the same API.

**Android versionCode / iOS build:** `deploy.sh` updates the app version everywhere and also sets **Android `versionCode`** in `web/src-tauri/tauri.conf.json` (derived from the version so it always increases for Play Store). iOS uses the same `version` string for both the user-facing version and the build number (CFBundleVersion); Tauri does not yet expose a separate iOS build number in config.

**Publishing app bundles to the stores:** The release workflow uploads the **AAB** and **IPA** to the **GitHub Release** and can **automatically upload the AAB to Google Play** when configured.

- **Google Play (automatic):** If you set the secret **`GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`** (full JSON key content) in the repo’s GitHub Actions secrets, the release workflow will upload the AAB to Play Console after creating the GitHub Release. Optional secret **`GOOGLE_PLAY_TRACK`**: set to `internal`, `alpha`, `beta`, or `production` (defaults to `internal` if unset). Setup: (1) Enable [Google Play Android Developer API](https://console.cloud.google.com/apis/library/androidpublisher.googleapis.com); (2) Create a service account in Google Cloud, download its JSON key; (3) In [Play Console](https://play.google.com/console) → Users and permissions, invite the service account email and grant “Release to production” (or the track you use); (4) Put the JSON key contents in GitHub secret `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`. The app must have at least one manual upload to Play before the first API upload.
- **App Store:** Download the `.ipa` from the GitHub Release and upload via [App Store Connect](https://appstoreconnect.apple.com/) (Transporter or Xcode), or automate with [fastlane](https://fastlane.tools/) and Apple credentials in CI.

### iOS Deployment Setup

For automatic iOS builds and App Store deployment, see:
- **[iOS Signing Setup Guide](docs/ios-signing-setup.md)** - Complete guide to configure Apple certificates and provisioning profiles
- **[iOS Deployment Checklist](docs/ios-deployment-checklist.md)** - Quick reference for releases
- **[Verification Script](scripts/verify-ios-signing.sh)** - Test your signing setup locally

Required GitHub secrets: `APPLE_CERTIFICATE_BASE64`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_PROVISIONING_PROFILE_BASE64`

Optional (for automatic TestFlight upload): `APP_STORE_CONNECT_API_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`, `APP_STORE_CONNECT_API_KEY_CONTENT`

### Database Management
The database is automatically initialized with:
- **PostGIS Extension**: Spatial data support for bookmarks and location features
- **Spatial Indexes**: GIST indexes for optimal location queries  
- **Required permissions and roles**
- **Default admin user**

To seed with a custom user:
```bash
docker exec parchment-server bun run seed:dev "FirstName" "LastName" "email@example.com" "https://example.com/picture.jpg"
```

### Debugging
Development mode includes:
- **Hot reload** for both frontend and backend
- **Bun debugger** available at `ws://127.0.0.1:6499/debug` or `https://debug.bun.sh/#127.0.0.1:6499/debug`
- **Source maps** for TypeScript debugging

## Testing

**Unit tests (Vitest)** — From `web/`: `bun run test` (or `bun run test:ui` / `bun run test --watch`). Tests live in `web/src/**/*.{test,spec}.ts`. The web build runs unit tests before building (`vitest run`). Pre-commit runs only the web unit suite (Husky + lint-staged at repo root); e2e is not run on commit.

**E2E tests (Playwright)** — Require Docker. Copy `web/e2e/env.test.example` to `web/e2e/env.test` (or `.env.test` in repo root), set `APP_TESTER_EMAIL` and optionally `E2E_MAPBOX_ACCESS_TOKEN` for map tests. From `web/`: `bun run test:e2e` (starts the test stack and runs tests); `bun run test:e2e:ui` for interactive UI. Test user receives OTP `0000-0000`. E2E runs in CI only (not on pre-commit).

**CI** — The pipeline runs web unit tests and then e2e tests on every push and pull request to `main` and `dev`. To block merging to `dev` until tests pass, use a **ruleset** (recommended) or a classic branch protection rule: **Settings → Rules → Rulesets** → **New ruleset** → set target to **dev** (or "Include by pattern" `dev`) → add rule **Require status checks to pass** → add status check **e2e** → Save. (Classic: **Settings → Branches** → Add rule for `dev` → Require status checks → select **e2e**.)

## 🗺️ Geocoding Setup (Optional)

Parchment can use Pelias for advanced geocoding and address search.

### Prerequisites
```bash
# Install Pelias CLI
git clone https://github.com/pelias/docker.git pelias-cli
cd pelias-cli
sudo ln -s $(pwd)/pelias /usr/local/bin/pelias
cd ..
```

### Quick Setup
```bash
# For local development (North Carolina data)
./import.sh

# For production (global data - requires >1TB storage)
./import.sh planet
```

Geocoding services will be available at:
- **Pelias API**: http://localhost:4000
- **Elasticsearch**: http://localhost:9200

## 🚢 Production Deployment

### Standalone Installation
```bash
# Download and start
curl -o docker-compose.prod.yml https://raw.githubusercontent.com/alexwohlbruck/parchment/main/docker-compose.prod.yml
curl -o .env https://raw.githubusercontent.com/alexwohlbruck/parchment/main/.env.example
# Edit .env with your settings
docker-compose -f docker-compose.prod.yml up -d
```

### Homelab Integration

For existing Docker setups, use includes to keep everything organized:

```
your-homelab/
├── docker-compose.yml          # Your main compose file
├── .env                        # Environment variables
└── parchment/
    └── docker-compose.yml      # Parchment services
```

**Setup:**
```bash
# Download Parchment
mkdir -p parchment
curl -o parchment/docker-compose.yml https://raw.githubusercontent.com/alexwohlbruck/parchment/main/docker-compose.prod.yml

# Download .env template and add Parchment config
curl -o parchment/.env.example https://raw.githubusercontent.com/alexwohlbruck/parchment/main/.env.example
# Copy Parchment variables from parchment/.env.example to your root .env file

# Add to your main docker-compose.yml
include:
  - parchment/docker-compose.yml

# Start everything
docker-compose up -d
```

**Custom Networks (for reverse proxies):**

Create `docker-compose.override.yml`:
```yaml
services:
  server:
    networks:
      - default
      - your_proxy_network
  web:
    networks:
      - default  
      - your_proxy_network

networks:
  your_proxy_network:
    external: true
```

### Troubleshooting

If you encounter database issues:

```bash
# Check PostGIS is enabled
docker exec -it parchment-db psql -U server_user -d parchment -h localhost -c "SELECT PostGIS_Version();"

# Check spatial index exists
docker exec -it parchment-db psql -U server_user -d parchment -h localhost -c "\d bookmarks"
```

## 📱 Mobile & Desktop Apps

Parchment includes Tauri-based applications for desktop and mobile:

### Desktop App
```bash
cd web
bun run dev:desktop    # Development
bun run build:desktop  # Production build
```

### Mobile Apps
```bash
cd web
# Android
bun run dev:android      # Development
bun run build:android    # Production AAB
bun run build:android:apk # Production APK

# iOS
bun run dev:ios         # Development
bun run build:ios       # Production build
```

## 🔧 Configuration

### API Keys Required
- **Mapbox**: For map tiles and geocoding
- **Transitland**: For public transit data
- **Maptiler**: For additional map styles
- **Mapillary**: For street-level imagery

### Email Configuration
Gmail app passwords are required for:
- User registration confirmations
- Password reset emails
- System notifications

## 📄 License

This project is licensed under the **AGPL-3.0** license.
- ✅ **Free to self-host** for personal, family, and friends
- ✅ **All features available** when self-hosting  
- ❌ **Cannot sell as a service** without sharing source code

See the [LICENSE](LICENSE) file for details.
