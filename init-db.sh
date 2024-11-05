#!/bin/bash
set -e

# Wait for the database to be ready
until bun run db:ready
do
    echo "Waiting for database to be ready..."
    sleep 2
done

# Run migrations
bun run migrate

# Seed the database
bun run seed

echo "Database initialization completed."