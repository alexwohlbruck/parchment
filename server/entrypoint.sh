#!/bin/bash

# Check if we're in production mode
if [ "$NODE_ENV" = "production" ]; then
    echo "Production mode detected - using compiled JavaScript"
    
    # Run pre-generated migrations only
    echo "Running migrations..."
    bun run migrate:prod
    
    # Run seeding
    echo "Running seed..."
    bun run seed:prod
else
    echo "Development mode detected - using TypeScript"
    
    # Run migrations (check if it is necessary to run them, to avoid rerunning)
    echo "Running migrations..."
    bun run migrate:dev
    
    # Run seeding
    echo "Running seed..."
    bun run seed:dev
fi

# Start the application
echo "Starting the application..."
exec "$@"
