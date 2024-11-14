#!/bin/bash

# # Check if PostgreSQL is ready
# echo "Waiting for PostgreSQL to be ready..."
# until pg_isready -h localhost -p 5432 -q; do
#   sleep 1
#   echo "PostgreSQL is not ready yet, waiting..."
# done
# echo "PostgreSQL is ready."

# Run database migrations
echo "Running database migrations..."
cd /app && bun run migrate

# Run seed script
echo "Running seed script..."
bun run seed

# Keep container running
echo "Database migrations and seeding completed. Container is running..."
tail -f /dev/null
