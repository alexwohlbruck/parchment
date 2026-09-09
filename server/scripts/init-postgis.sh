#!/bin/bash
# Run in Postgres container: ensures PostGIS extension exists
# Used by docker-compose.prod.yml and docker-compose.test.yml
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE EXTENSION IF NOT EXISTS postgis;
  CREATE EXTENSION IF NOT EXISTS postgis_topology;
EOSQL
