# Parchment Maps
A modern mapping and navigation app based on open data and open source.

## Requirements

- [Docker](https://www.docker.com/)
- Docker Compose
- At least 8GB RAM for state/region-level data (16GB+ for country or planet data)

## Setup

1. Inside the `server` directory, create an `.env.local` file and fill in the required environment variables:

```sh
cd server
touch .env.local
```

|Name                 |Description                                                |
|---------------------|-----------------------------------------------------------|
|SERVER_ORIGIN        |Base URL of the backend server                             |
|CLIENT_ORIGIN        |Base URL of the frontend server                            |
|DATABASE_URL         |Connection string for local development Postgres DB        |
|GMAIL_EMAIL          |Your Gmail email address                                   |
|GMAIL_APP_PASSWORD   |Your Gmail app password for sending emails from the server |

2. Inside the `web` directory, create an `.env.local` file and fill in the required environment variables:

```sh
cd ../web
touch .env.local
```

|Name                        |Description                                           |
|----------------------------|------------------------------------------------------|
|VITE_SERVER_ORIGIN          | The server base URL, typically http://localhost:5000
|VITE_MAPBOX_ACCESS_TOKEN    | Your Mapbox access token
|VITE_TRANSITLAND_API_KEY    | Your Transitland API key
|VITE_MAPTILER_API_KEY       | Your Maptiler API key


3. Back in the root directory, enable execution of the scripts:
```sh
chmod +x start.sh import.sh import.sh
```
4. Run the start script with the `--seed` flag:
```sh
./start.sh --seed
```
5. After a few moments, you will be prompted to enter your user details. Use your real email address, this will be used to sign in.
```sh
Migration finished
Seeding the database...
Enter first name: John
Enter last name: Doe
Enter email: email@example.com
Enter picture URL: https://github.com/john-doe.png
✅ Inserted 5 permissions
✅ Inserted 3 roles
✅ Assigned 0 permissions to role user
✅ Assigned 4 permissions to role alpha
✅ Assigned all 5 permissions to role admin
✅ Inserted user John Doe
✅ Assigned admin role to John Doe
Seed finished
App started, running on http://localhost:5173
```

## Geocoding & Routing Services

Parchment uses open-source geocoding and routing services for location search and navigation.

### Components

The system uses the following open-source components:

- **Pelias**: A modular, open-source geocoder built on top of OpenSearch
- **GraphHopper**: An open-source routing engine for calculating paths and directions
- **OpenStreetMap**: The base map data source for both services
- **OpenSearch**: Search engine used by Pelias (free Elasticsearch alternative)

### Setting Up Geocoding & Routing

The setup supports both regional (e.g., North Carolina) and planet-wide deployments. For development, using a region is recommended due to smaller data size and faster processing.

#### Quickstart

To set up with default options (North Carolina region):

```bash
# Make scripts executable
chmod +x *.sh

# Import geographic data (this may take some time)
./import.sh --region=north-carolina

# Start all services (including geocoding and routing)
./start.sh
```

For planet-wide deployment:

```bash
./import.sh --planet
./start.sh
```

To start the application without geo services:

```bash
./start.sh --no-geo
```

#### Import Script OptionsOptions

The `import.sh` script provides several options for control:

```bash
# Import data for a specific region (default is north-carolina)
./import.sh --region=california 

# Import planet data (much larger, requires more RAM)
./import.sh --planet

# Skip download if you already have the OSM data files
./import.sh --skip-download

# Update existing data with latest version
./import.sh --update
```

For help with all options:
```bash
./import.sh --help
```

#### Automating Updates

You can automatically update geographic data using a cron job:

```bash
# Edit crontab
crontab -e

# Add a line like this (runs every Sunday at midnight)
0 0 * * 0 /path/to/parchment/import.sh --region=north-carolina --update
```

### Service Endpoints

After setup, the following geocoding and routing services will be available:

- **Pelias Geocoding API**: http://localhost:4000
  - Example forward geocoding: `http://localhost:4000/v1/search?text=Chapel+Hill`
  - Example reverse geocoding: `http://localhost:4000/v1/reverse?point.lat=35.9132&point.lon=-79.0558`

- **GraphHopper Routing API**: http://localhost:8989
  - Example route: `http://localhost:8989/route?point=35.9132,-79.0558&point=36.0014,-78.9382&vehicle=car&type=json`

## Run the app

1. Run the script:
  ```sh
  ./start.sh [--prod] [--migrate] [--seed] [--no-geo]
  ```
  Flags:
  - `--prod`: Run in production mode
  - `--migrate`: Run migrations
  - `--seed`: Run migrations and seed the database. Use if running for the first time.
  - `--no-geo`: Start without geocoding and routing services
  
2. Open the app in your browser: [http://localhost:5173](http://localhost:5173)

Hot module reload is enabled, so you can make changes to the code and see them immediately. **Any packages you install or update with bun will not be available until you rebuild the `web` container.**

## Build for production

### Using start script

1. Run the script:
```sh
./start.sh --prod
```

```

## Troubleshooting

### Geocoding and Routing Services
If you already have a homelab configured with Docker Compose, you can include this project's `docker-compose.yml` beside your main compose file to spin up required the services in a bundle.
- **Services not starting**: Check logs with `docker-compose logs -f [service-name]`
- **Geocoding not working**: Ensure Pelias API is running with `docker ps | grep pelias-api`
- **Routing not working**: Check GraphHopper logs, it may still be processing data
- **No data found**: Run `./import.sh` to download and process geographic data
- **Data outdated**: Run `./import.sh --update` to refresh your geographic data
├─ parchment/
│  ├─ docker-compose.yml # This project's compose file
│  ├─ docker-compose.override.yml # Optional compose override
│     # Volumes generated by the app will be stored here
├─ my-other-service-1/
├─ my-other-service-2/
├─ docker-compose.yml # Your existing compose file
```

1. Copy `docker-compose.yml` to a new local folder on your machine, for homelabs this is typically `/opt`
```sh
cd /opt
mkdir parchment
cd parchment
curl -o docker-compose.yml https://raw.githubusercontent.com/alexwohlbruck/parchment/refs/heads/main/docker-compose.yml
```

2. Append the project config to your existing `docker-compose.yml`:

```yml
version: '3.7'
services:
```

## Troubleshooting

### Geocoding and Routing Services

- **Services not starting**: Check logs with `docker-compose logs -f [service-name]`
- **Geocoding not working**: Ensure Pelias API is running with `docker ps | grep pelias-api`
- **Routing not working**: Check GraphHopper logs, it may still be processing data
- **No data found**: Run `./import.sh` to download and process geographic data
- **Data outdated**: Run `./import.sh --update` to refresh your geographic data