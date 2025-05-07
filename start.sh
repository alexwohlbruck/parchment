#!/bin/bash

# Default options
IS_PROD=false
IS_MIGRATE=false
IS_SEED=false
USE_GEOCODER=false
USE_ROUTER=false
VITE_PORT=5173

# Parse arguments
for arg in "$@"; do
  case $arg in
    --prod)
      IS_PROD=true
      ;;
    --seed)
      IS_SEED=true
      ;;
    --geocoder)
      USE_GEOCODER=true
      ;;
    --router)
      USE_ROUTER=true
      ;;
    --port=*)
      VITE_PORT="${arg#*=}"
      ;;
    *)
      echo "Unknown argument: $arg"
      echo "Usage: $0 [--prod] [--migrate] [--seed] [--geocoder] [--router] [--port=XXXX]"
      exit 1
      ;;
  esac
done

# Set Dockerfile and environment mode
if $IS_PROD; then
  export DOCKERFILE=Dockerfile.prod
  export NODE_ENV=production
  echo "Running in production mode."
else
  export DOCKERFILE=Dockerfile.dev
  export NODE_ENV=development
  echo "Running in development mode."
fi

# Set other environment variables
export VITE_PORT
export BUN_DEBUG_PORT=6499

# Build Docker Compose command
COMPOSE_FILES="-f docker-compose.yml"
$USE_GEOCODER && COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.geocoder.yml"
$USE_ROUTER && COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.router.yml"

# Start Docker services
echo "Starting containers..."
docker-compose $COMPOSE_FILES up --build -d

# Wait for server DB to be ready
echo "Waiting for server-db to start..."
while ! docker exec server-db pg_isready -q; do
  sleep 1
done

# Run migrations and seed if requested
if $IS_SEED; then
  echo "Running migrations and seeding..."

  # Run migrations
  docker exec parchment-server bun run migrate
  
  # Seed the database if requested
  if $IS_SEED; then
    echo "Seeding the database..."
    read -p "Enter first name: " firstName
    read -p "Enter last name: " lastName
    read -p "Enter email: " email
    read -p "Enter picture URL: " picture
    docker exec parchment-server bun src/seed/seed.ts "$firstName" "$lastName" "$email" "$picture"
  fi
fi

echo "✅ App started! Frontend: http://localhost:$VITE_PORT"
