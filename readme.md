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

# Frontend configuration
VITE_PORT=5173

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

### Database Management
The database is automatically initialized with:
- Required permissions and roles
- Default admin user

To seed with a custom user:
```bash
docker exec parchment-server bun run seed:dev "FirstName" "LastName" "email@example.com" "https://example.com/picture.jpg"
```

### Debugging
Development mode includes:
- **Hot reload** for both frontend and backend
- **Bun debugger** available at `ws://127.0.0.1:6499/debug` or `https://debug.bun.sh/#127.0.0.1:6499/debug`
- **Source maps** for TypeScript debugging

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
