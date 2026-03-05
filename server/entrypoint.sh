#!/bin/bash
set -e

# Check if we're in production mode
if [ "$NODE_ENV" = "production" ]; then
    echo "Production mode detected - using compiled JavaScript"
    
    # Wait for database to be ready using pg_isready
    echo "Waiting for database to be ready..."
    if [ -n "$DATABASE_HOST" ] && [ -n "$DATABASE_PORT" ]; then
        DB_HOST="$DATABASE_HOST"
        DB_PORT="$DATABASE_PORT"
    elif [ -n "$DATABASE_URL" ]; then
        # Extract host from URL (handles both with and without port)
        DB_HOST=$(echo "$DATABASE_URL" | sed -n 's|.*@\([^:/]*\).*|\1|p')
        # Extract port if present, otherwise use default 5432
        DB_PORT=$(echo "$DATABASE_URL" | sed -n 's|.*@[^:]*:\([0-9]*\)/.*|\1|p')
    fi
    DB_HOST=${DB_HOST:-localhost}
    DB_PORT=${DB_PORT:-5432}
    
    DB_READY=
    for i in $(seq 1 30); do
        if pg_isready -h "$DB_HOST" -p "$DB_PORT" -q 2>/dev/null; then
            echo "Database is ready!"
            DB_READY=1
            break
        fi
        echo "Database not ready yet, waiting... ($i/30)"
        sleep 2
    done
    if [ -z "$DB_READY" ]; then
        echo "Fatal: database at $DB_HOST:$DB_PORT did not become ready in time."
        exit 1
    fi
    
    # Run pre-generated migrations (includes spatial indexes)
    echo "Running migrations..."
    bun run migrate:prod
    
    # Run seeding
    echo "Running seed..."
    bun run seed:prod
else
    echo "Development mode detected - using TypeScript"
    
    echo "Waiting for database to be ready..."
    if [ -n "$DATABASE_HOST" ] && [ -n "$DATABASE_PORT" ]; then
        DB_HOST="$DATABASE_HOST"
        DB_PORT="$DATABASE_PORT"
    elif [ -n "$DATABASE_URL" ]; then
        # Extract host from URL (handles both with and without port)
        DB_HOST=$(echo "$DATABASE_URL" | sed -n 's|.*@\([^:/]*\).*|\1|p')
        # Extract port if present, otherwise use default 5432
        DB_PORT=$(echo "$DATABASE_URL" | sed -n 's|.*@[^:]*:\([0-9]*\)/.*|\1|p')
    fi
    DB_HOST=${DB_HOST:-localhost}
    DB_PORT=${DB_PORT:-5432}
    
    DB_READY=
    for i in $(seq 1 30); do
        if pg_isready -h "$DB_HOST" -p "$DB_PORT" -q 2>/dev/null; then
            echo "Database is ready!"
            DB_READY=1
            break
        fi
        echo "Database not ready yet, waiting... ($i/30)"
        sleep 2
    done
    if [ -z "$DB_READY" ]; then
        echo "Fatal: database at $DB_HOST:$DB_PORT did not become ready in time."
        exit 1
    fi
    
    echo "Running migrations..."
    bun run migrate:dev
    
    echo "Running seed..."
    bun run seed:dev
fi

# Start the application
echo "Starting the application..."
exec "$@"
