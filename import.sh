#!/bin/bash

# Exit on any error
set -e

# Default parameters
REGION="north-carolina"
USE_PLANET=false
SKIP_DOWNLOAD=false
UPDATE=false

# Parse arguments
for arg in "$@"; do
  case $arg in
    --region=*)
      REGION="${arg#*=}"
      ;;
    --planet)
      USE_PLANET=true
      ;;
    --skip-download)
      SKIP_DOWNLOAD=true
      ;;
    --update)
      UPDATE=true
      ;;
    --help)
      echo "Usage: $0 [--region=NAME] [--planet] [--skip-download] [--update]"
      echo "  --region=NAME     Region to import (default: north-carolina)"
      echo "  --planet          Use planet data instead of region"
      echo "  --skip-download   Skip data download, use existing files"
      echo "  --update          Update existing data with latest version"
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg"
      echo "Use --help for usage information"
      exit 1
      ;;
  esac
done

# Directory setup
DATA_DIR="./data"
CONFIG_DIR="./config"

# Create necessary directories
mkdir -p $DATA_DIR/osm
mkdir -p $DATA_DIR/placeholder
mkdir -p $DATA_DIR/interpolation
mkdir -p $DATA_DIR/polylines
mkdir -p $DATA_DIR/geonames
mkdir -p $DATA_DIR/graphhopper/graph-cache

mkdir -p $CONFIG_DIR/pelias
mkdir -p $CONFIG_DIR/graphhopper

# Download OSM data if needed
if [ "$SKIP_DOWNLOAD" = false ]; then
  if [ "$USE_PLANET" = true ]; then
    echo "Downloading planet OSM data (this will take a long time)..."
    if [ ! -f $DATA_DIR/osm/planet-latest.osm.pbf ] || [ "$UPDATE" = true ]; then
      echo "Downloading planet data from OpenStreetMap..."
      wget -O $DATA_DIR/osm/planet-latest.osm.pbf https://planet.openstreetmap.org/pbf/planet-latest.osm.pbf
    else
      echo "Planet data already exists, skipping download"
      echo "Use --update to download fresh data"
    fi
    OSM_FILENAME="planet-latest.osm.pbf"
  else
    echo "Downloading regional OSM data for $REGION..."
    if [ ! -f $DATA_DIR/osm/${REGION}-latest.osm.pbf ] || [ "$UPDATE" = true ]; then
      echo "Downloading region data from Geofabrik..."
      wget -O $DATA_DIR/osm/${REGION}-latest.osm.pbf https://download.geofabrik.de/north-america/us/${REGION}-latest.osm.pbf
    else
      echo "Regional data for $REGION already exists, skipping download"
      echo "Use --update to download fresh data"
    fi
    OSM_FILENAME="${REGION}-latest.osm.pbf"
  fi
else
  # Set filename based on mode, but don't download
  if [ "$USE_PLANET" = true ]; then
    OSM_FILENAME="planet-latest.osm.pbf"
    if [ ! -f $DATA_DIR/osm/$OSM_FILENAME ]; then
      echo "Error: Planet data file not found: $DATA_DIR/osm/$OSM_FILENAME"
      echo "Run without --skip-download to download the data."
      exit 1
    fi
  else
    OSM_FILENAME="${REGION}-latest.osm.pbf"
    if [ ! -f $DATA_DIR/osm/$OSM_FILENAME ]; then
      echo "Error: Region data file not found: $DATA_DIR/osm/$OSM_FILENAME"
      echo "Run without --skip-download to download the data."
      exit 1
    fi
  fi
fi

# Generate Pelias configuration
echo "Generating Pelias configuration..."
cat > $CONFIG_DIR/pelias/pelias.json <<EOL
{
  "logger": {
    "level": "info",
    "timestamp": true
  },
  "esclient": {
    "hosts": [
      { "host": "opensearch", "port": 9200 }
    ]
  },
  "elasticsearch": {
    "settings": {
      "index": {
        "refresh_interval": "10s",
        "number_of_replicas": "0",
        "number_of_shards": "1"
      }
    }
  },
  "api": {
    "services": {
      "pip": { "url": "http://pip:4200" },
      "libpostal": { "url": "http://libpostal:4400" },
      "placeholder": { "url": "http://placeholder:4100" },
      "interpolation": { "url": "http://interpolation:4300" }
    }
  },
  "imports": {
    "adminLookup": {
      "enabled": true
    },
    "geonames": {
      "datapath": "/data/geonames",
      "countryCode": "ALL"
    },
    "openstreetmap": {
      "datapath": "/data/osm",
      "import": [
        { "filename": "${OSM_FILENAME}" }
      ]
    },
    "openaddresses": {
      "datapath": "/data/openaddresses",
      "files": []
    },
    "polyline": {
      "datapath": "/data/polylines",
      "files": [ "extract.0sv" ]
    }
  }
}
EOL

# Generate GraphHopper configuration
echo "Generating GraphHopper configuration..."
cat > $CONFIG_DIR/graphhopper/config.yml <<EOL
datareader.file: /data/osm/${OSM_FILENAME}
graph.location: /data/graphhopper/graph-cache

# Vehicles: car,foot,bike,motorcycle,bike2,mtb,racingbike,foot,hike,wheelchair
graph.flag_encoders: car,foot

# Enable turn restrictions for car routing
graph.flag_encoders.car.turn_costs: true 

# Enable contraction hierarchy for faster routing
prepare.ch.weightings: fastest
prepare.min_network_size: 200
prepare.min_one_way_network_size: 200
EOL

# Start necessary services for import
echo "Starting import dependencies..."
docker-compose up -d opensearch libpostal

# Wait for OpenSearch to be ready
echo "Waiting for OpenSearch to start..."
until curl -s http://localhost:9200 > /dev/null; do
  echo "Waiting for OpenSearch..."
  sleep 5
done

# Start Pelias services (don't auto-import)
echo "Starting Pelias services for data import..."
docker-compose up -d pelias-api placeholder interpolation polylines openstreetmap geonames

# Prepare Placeholder data
echo "Building Placeholder data..."
docker-compose exec -T placeholder bash -c "cd /app && npm run build"

# Generate polylines from OSM data
echo "Generating polylines from OSM data..."
docker-compose exec -T polylines bash -c "source ./example/polylines/extract.sh /data/osm/${OSM_FILENAME}"

# Import OSM data to Pelias
echo "Importing OSM data to Pelias..."
docker-compose exec -T openstreetmap npm start

# Import Geonames data
echo "Importing Geonames data..."
docker-compose exec -T geonames npm start

# Start GraphHopper (it will automatically build the graph from OSM data)
echo "Starting GraphHopper to process OSM data..."
docker-compose up -d graphhopper

echo "Import completed successfully!"
echo "You can now run ./start.sh to start all services" 