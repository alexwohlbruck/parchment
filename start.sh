#!/bin/bash

# Initialize boolean variables
IS_PROD=false
IS_MIGRATE=false
IS_SEED=false

# Check for arguments and assign boolean flags
for arg in "$@"; do
  case $arg in
    --prod)
      IS_PROD=true
      ;;
    --migrate)
      IS_MIGRATE=true
      ;;
    --seed)
      IS_SEED=true
      ;;
    *)
      echo "Unknown argument: $arg"
      echo "Usage: $0 [--prod] [--migrate] [--seed]"
      exit 1
      ;;
  esac
done

# Set environment variables based on flags
if $IS_PROD; then
  export DOCKERFILE=Dockerfile.prod
  export NODE_ENV=production
  echo "Running in production mode."
else
  export DOCKERFILE=Dockerfile.dev
  export NODE_ENV=development
  echo "Running in development mode."
fi

# Start the containers (development or production)
docker-compose up --build web -d

echo "Waiting for postgres to start..."
while ! docker exec server-db pg_isready -q; do
  sleep 1
done

# Run migrations, seed DB
if $IS_MIGRATE || $IS_SEED; then
  echo "Running migrations..."
  docker exec parchment-server bun run migrate
fi

if $IS_SEED; then
  echo "Seeding the database..."
  read -p "Enter first name: " firstName
  read -p "Enter last name: " lastName
  read -p "Enter email: " email
  read -p "Enter picture URL: " picture
  docker exec parchment-server bun src/seed/seed.ts "$firstName" "$lastName" "$email" "$picture"
fi

echo "App started, running on http://localhost:5173"
