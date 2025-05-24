#!/bin/bash

# Run migrations (check if it is necessary to run them, to avoid rerunning)
echo "Running migrations..."
bun run migrate

# Start the application
echo "Starting the application..."
exec "$@"
