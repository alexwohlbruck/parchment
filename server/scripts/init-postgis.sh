#!/bin/bash
set -e

# This script runs automatically when the PostgreSQL container starts for the first time
# It ensures PostGIS is available for the application

echo "Initializing PostGIS..."

# Connect to the database and enable PostGIS
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    -- Enable PostGIS extension
    CREATE EXTENSION IF NOT EXISTS postgis;
    
    -- Verify PostGIS is working
    SELECT PostGIS_Version();
    
    -- Grant necessary permissions to the user
    GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO $POSTGRES_USER;
    GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO $POSTGRES_USER;
    GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO $POSTGRES_USER;
EOSQL

echo "PostGIS initialization complete!" 