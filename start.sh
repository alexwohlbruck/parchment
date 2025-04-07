#!/bin/bash

# TODO: Add --headless option which only starts up the server/db without web client
# TODO: Update port flag to set external port for client/server, not internal
# TODO: Auto run seed script with onboarding flow

IS_PROD=false
IS_MIGRATE=false
IS_SEED=false
VITE_PORT=5173

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
    --port=*)
      VITE_PORT="${arg#*=}"
      ;;
    *)
      echo "Unknown argument: $arg"
      echo "Usage: $0 [--prod] [--migrate] [--seed] [--port=XXXX]"
      exit 1
      ;;
  esac
done

if $IS_PROD; then
  export DOCKERFILE=Dockerfile.prod
  export NODE_ENV=production
  echo "Running in production mode."
else
  export DOCKERFILE=Dockerfile.dev
  export NODE_ENV=development
  echo "Running in development mode."
fi

export VITE_PORT
export BUN_DEBUG_PORT=6499

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

echo "App started, running on http://localhost:$VITE_PORT"