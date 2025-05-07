#!/bin/bash

# TODO: Add --headless option which only starts up the server/db without web client
# TODO: Update port flag to set external port for client/server, not internal
# TODO: Auto run seed script with onboarding flow

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
DATA_DIR="$SCRIPT_DIR/data"
CONFIG_DIR="$SCRIPT_DIR/config"

IS_PROD=false
IS_MIGRATE=false
IS_SEED=false
INCLUDE_GEO=true
VITE_PORT=5173

for arg in "$@"; do
  case $arg in
    --prod)
      IS_PROD=true
      ;;
    --migrate)
      IS_MIGRATE=true
      ;;
    --seed)
      IS_SEED=true
      ;;
    --port=*)
      VITE_PORT="${arg#*=}"
      ;;
    --no-geo)
      INCLUDE_GEO=false
      ;;
    --help)
      echo "Usage: $0 [--prod] [--migrate] [--seed] [--port=XXXX] [--no-geo]"
      echo "  --prod           Start in production mode"
      echo "  --migrate        Run database migrations"
      echo "  --seed           Seed the database with initial data"
      echo "  --port=XXXX      Set the port for the web client"
      echo "  --no-geo         Start without geo services (Pelias, GraphHopper)"
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg"
      echo "Use --help for usage information"
      exit 1
      ;;
  esac
done

# Ensure required directories exist
mkdir -p "$DATA_DIR"
mkdir -p "$CONFIG_DIR"
mkdir -p "$CONFIG_DIR/pelias"
mkdir -p "$CONFIG_DIR/graphhopper"

if $IS_PROD; then
  export DOCKERFILE=Dockerfile.prod
  export NODE_ENV=production
  echo "Running in production mode."
else
  export DOCKERFILE=Dockerfile.dev
  export NODE_ENV=development
  echo "Running in development mode."
fi

export VITE_PORT
export BUN_DEBUG_PORT=6499

# Start core services (web and server)
echo "Starting core services..."
docker-compose up --build web -d

echo "Waiting for postgres to start..."
while ! docker exec server-db pg_isready -q; do
  sleep 1
done

# Run migrations, seed DB
if $IS_MIGRATE || $IS_SEED; then
  echo "Running migrations..."
  docker exec parchment-server bun run migrate
fi

if $IS_SEED; then
  echo "Seeding the database..."
  read -p "Enter first name: " firstName
  read -p "Enter last name: " lastName
  read -p "Enter email: " email
  read -p "Enter picture URL: " picture
  docker exec parchment-server bun src/seed/seed.ts "$firstName" "$lastName" "$email" "$picture"
fi

# Start geo services if needed
if $INCLUDE_GEO; then
  echo "Starting geocoding and routing services..."
  
  # Check if data exists, warn if not
  if [ -d "$DATA_DIR/osm" ] && [ "$(ls -A $DATA_DIR/osm)" ]; then
    echo "OSM data found. Starting services..."
    
    # Start OpenSearch (required for Pelias)
    docker-compose up -d opensearch
    
    # Wait for OpenSearch to start
    echo "Waiting for OpenSearch to start..."
    until curl -s http://localhost:9200 > /dev/null; do
      echo "Waiting for OpenSearch..."
      sleep 5
    done
    
    # Start all geo services
    docker-compose up -d libpostal pelias-api placeholder interpolation polylines openstreetmap geonames graphhopper martin
    
    echo "Geo services started."
    echo "- Pelias geocoding API: http://localhost:4000"
    echo "- GraphHopper routing engine: http://localhost:8989"
  else
    echo "Warning: No OSM data found in $DATA_DIR/osm"
    echo "Run ./import.sh first to download and import geographic data"
    echo "Continuing without geo services..."
  fi
fi

echo "App started, running on http://localhost:$VITE_PORT"