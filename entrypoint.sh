#!/bin/bash

# Start PostgreSQL and PostGIS
echo "Starting PostgreSQL..."
service postgresql start
sleep 5  # Wait for PostgreSQL to be ready

# Start OpenSearch (Pelias dependency)
echo "Starting OpenSearch..."
su - opensearch -c "/usr/share/opensearch/bin/opensearch &"
sleep 10  # Wait for OpenSearch to be ready

# Start Pelias API
echo "Starting Pelias API..."
cd /etc/pelias && pelias api &

# Start GraphHopper (Routing Engine)
echo "Starting GraphHopper..."
cd /data && ./graphhopper.sh web /data/planet.osm.pbf &

# Start Martin (Tile Server)
echo "Starting Martin Tile Server..."
martin &

# Start Backend (Elysia)
echo "Starting Elysia Backend..."
cd /app/server && bun run start &

# Start Frontend (Vue)
echo "Starting Vue Frontend..."
cd /var/www/frontend && serve -s . -l 5173 &

# Keep container running
echo "All services started. Container is running..."
tail -f /dev/null
