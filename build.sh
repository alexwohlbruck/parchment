#!/bin/bash

# Exit immediately if a command exits with a non-zero status
set -e

# Define directories
FRONTEND_DIR="./client"
BACKEND_DIR="./server"
DOCKER_DIR="./docker"  # This assumes your Dockerfile(s) are in a 'docker' directory

# Step 1: Build Frontend (Vue)
echo "Building frontend..."
cd $FRONTEND_DIR
bun build  # Or `npm run build` or whatever your frontend uses

# Step 2: Move the built frontend files to Docker directory
echo "Copying frontend build to Docker directory..."
cp -R ./dist $DOCKER_DIR/frontend  # Copy frontend build output (adjust if necessary)

# Step 3: Build Backend (Elysia)
echo "Building backend..."
cd $BACKEND_DIR
bun build  # This assumes you have a build step; if not, skip this.

# Step 4: Move backend build artifacts to Docker directory (if needed)
echo "Copying backend build to Docker directory..."
cp -R ./dist $DOCKER_DIR/backend  # Assuming backend build outputs to a 'dist' folder

# Step 5: Build Docker Images
echo "Building Docker images..."
cd $DOCKER_DIR
docker-compose build  # This will use the Docker Compose file to build all services

# Step 6: Optional: Clean up (if necessary)
echo "Cleaning up temporary files..."
# Add cleanup commands here if needed (e.g., removing temporary build artifacts)

echo "Build completed successfully!"
