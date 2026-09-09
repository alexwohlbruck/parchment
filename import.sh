#!/bin/bash
set -e

# Default to charlotte if no region specified
REGION=${1:-charlotte}
DATA_DIR=${2:-../data}

echo "Setting up Pelias for region: $REGION"
echo "Using data directory: $DATA_DIR"

cd pelias
mkdir -p "$DATA_DIR"

# Copy the appropriate configuration files based on region
if [ "$REGION" = "planet" ]; then
  echo "Using planet-wide Pelias configuration..."
  # Copy all files from examples/planet to pelias dir, overwriting existing files
  cp -rf examples/planet/* ./
else
  echo "Using Charlotte/North Carolina Pelias configuration..."
  # Copy all files from examples/charlotte to pelias dir, overwriting existing files
  cp -rf examples/charlotte/* ./
fi

# Ensure the Pelias CLI is available
if ! command -v pelias &> /dev/null; then
  echo "Pelias CLI not found. Please install it first:"
  echo "git clone https://github.com/pelias/docker.git && cd docker"
  echo "sudo ln -s \$(pwd)/pelias /usr/local/bin/pelias"
  exit 1
fi

# Start Elasticsearch
echo "Starting Elasticsearch..."
pelias elastic start
pelias elastic wait

# Create Elasticsearch index
echo "Creating Elasticsearch index..."
pelias elastic create

# Download all data
echo "Downloading data..."
if [ "$REGION" = "planet" ]; then
  echo "Warning: Planet file is very large (>50GB). This will take a while..."
fi
pelias download all

# Prepare all services
echo "Preparing services..."
pelias prepare all

# Import all data
echo "Importing data..."
pelias import all

# Start all services
echo "Starting all services..."
pelias compose up

cd ..

echo "Setup complete! Pelias should be ready at http://localhost:4000"
echo "Try a test query: http://localhost:4000/v1/search?text=raleigh" 