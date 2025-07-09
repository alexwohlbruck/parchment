#!/bin/bash
set -e

# This script runs automatically when the PostgreSQL container starts for the first time
# It ensures PostGIS and text search extensions are available for the application

echo "Initializing PostGIS and text search extensions..."

# Connect to the database and enable extensions
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    -- Enable PostGIS extension
    CREATE EXTENSION IF NOT EXISTS postgis;
    
    -- Enable pg_trgm for fuzzy text search
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
    
    -- Verify PostGIS is working
    SELECT PostGIS_Version();
    
    -- Verify pg_trgm is working
    SELECT 'hello' % 'helo' as similarity_test;
    
    -- Grant necessary permissions to the user
    GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO $POSTGRES_USER;
    GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO $POSTGRES_USER;
    GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO $POSTGRES_USER;
EOSQL

echo "PostGIS and text search initialization complete!" 