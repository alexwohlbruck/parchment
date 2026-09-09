#!/bin/bash

# Simple script to run Parchment in development or production mode

show_usage() {
    echo "Usage: $0 [dev|prod] [options]"
    echo ""
    echo "Modes:"
    echo "  dev   - Development mode with hot-reload and debugging"
    echo "  prod  - Production mode using published Docker images"
    echo ""
    echo "Options:"
    echo "  --build  - Force rebuild of images (dev mode only)"
    echo "  --down   - Stop and remove containers"
    echo ""
    echo "Examples:"
    echo "  $0 dev           # Start development environment"
    echo "  $0 dev --build   # Start development with rebuild"
    echo "  $0 prod          # Start production environment"
    echo "  $0 dev --down    # Stop development environment"
    exit 1
}

# Check if Docker network exists, create if not
if ! docker network ls | grep -q parchment-network; then
    echo "Creating parchment-network..."
    docker network create parchment-network
fi

MODE=""
BUILD_FLAG=""
DOWN_FLAG=""

# Parse arguments
for arg in "$@"; do
    case $arg in
        dev|prod)
            MODE=$arg
            ;;
        --build)
            BUILD_FLAG="--build"
            ;;
        --down)
            DOWN_FLAG="--down"
            ;;
        *)
            echo "Unknown argument: $arg"
            show_usage
            ;;
    esac
done

# Show usage if no mode provided
if [ -z "$MODE" ]; then
    show_usage
fi

# Set compose file based on mode
if [ "$MODE" = "dev" ]; then
    COMPOSE_FILE="docker-compose.dev.yml"
    echo "🚀 Starting Parchment in development mode..."
elif [ "$MODE" = "prod" ]; then
    COMPOSE_FILE="docker-compose.prod.yml"
    echo "🚀 Starting Parchment in production mode..."
    if [ -n "$BUILD_FLAG" ]; then
        echo "⚠️  Build flag ignored in production mode (uses published images)"
        BUILD_FLAG=""
    fi
fi

# Handle down flag
if [ -n "$DOWN_FLAG" ]; then
    echo "🛑 Stopping Parchment services..."
    docker-compose -f "$COMPOSE_FILE" down
    exit 0
fi

# Start services
echo "📦 Using compose file: $COMPOSE_FILE"
docker-compose -f "$COMPOSE_FILE" up $BUILD_FLAG -d

echo ""
echo "✅ Parchment started successfully!"
echo "🌐 Frontend: http://localhost:5173"
echo "🔧 Backend API: http://localhost:5000"
echo ""
echo "To stop the services, run: $0 $MODE --down" 