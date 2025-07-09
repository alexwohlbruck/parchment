#!/bin/bash

# Check if we're in production mode
if [ "$NODE_ENV" = "production" ]; then
    echo "Production mode detected - using compiled JavaScript"
    
    # Wait for database to be ready using pg_isready
    echo "Waiting for database to be ready..."
    DB_HOST=${DATABASE_HOST:-localhost}
    DB_PORT=${DATABASE_PORT:-5432}
    
    # Wait for database to be ready with timeout
    for i in {1..30}; do
        if pg_isready -h $DB_HOST -p $DB_PORT >/dev/null 2>&1; then
            echo "Database is ready!"
            break
        else
            echo "Database not ready yet, waiting... ($i/30)"
            sleep 2
        fi
    done
    
    # Run pre-generated migrations (includes spatial indexes)
    echo "Running migrations..."
    bun run migrate:prod
    
    # Run seeding
    echo "Running seed..."
    bun run seed:prod
else
    echo "Development mode detected - using TypeScript"
    
    # Wait for database to be ready using pg_isready
    echo "Waiting for database to be ready..."
    DB_HOST=${DATABASE_HOST:-localhost}
    DB_PORT=${DATABASE_PORT:-5432}
    
    # Wait for database to be ready with timeout
    for i in {1..30}; do
        if pg_isready -h $DB_HOST -p $DB_PORT >/dev/null 2>&1; then
            echo "Database is ready!"
            break
        else
            echo "Database not ready yet, waiting... ($i/30)"
            sleep 2
        fi
    done
    
    # Run migrations (includes spatial indexes)
    echo "Running migrations..."
    bun run migrate:dev
    
    # Run seeding
    echo "Running seed..."
    bun run seed:dev
fi

# Start the application
echo "Starting the application..."
exec "$@"
