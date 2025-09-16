#!/bin/bash

# Function to get current version from package.json
get_current_version() {
    local file=$1
    local stored_version=$(grep '"version":' "$file" | sed 's/.*"version": "\(.*\)".*/\1/')
    
    # If no version found, default to 1.0.0
    if [ -z "$stored_version" ]; then
        echo "1.0.0"
    else
        echo "$stored_version"
    fi
}

# Function to compare versions
compare_versions() {
    local version1=$1
    local version2=$2
    
    # Split versions into components
    IFS='.' read -r -a v1_parts <<< "$version1"
    IFS='.' read -r -a v2_parts <<< "$version2"
    
    # Compare major version
    if [ "${v1_parts[0]}" -gt "${v2_parts[0]}" ]; then
        echo "greater"
        return
    elif [ "${v1_parts[0]}" -lt "${v2_parts[0]}" ]; then
        echo "less"
        return
    fi
    
    # Compare minor version
    if [ "${v1_parts[1]}" -gt "${v2_parts[1]}" ]; then
        echo "greater"
        return
    elif [ "${v1_parts[1]}" -lt "${v2_parts[1]}" ]; then
        echo "less"
        return
    fi
    
    # Compare patch version
    if [ "${v1_parts[2]}" -gt "${v2_parts[2]}" ]; then
        echo "greater"
        return
    elif [ "${v1_parts[2]}" -lt "${v2_parts[2]}" ]; then
        echo "less"
        return
    fi
    
    echo "equal"
}

# Function to increment version
increment_version() {
    local version=$1
    local increment_type=$2
    local override_major=$3
    local override_minor=$4
    local override_patch=$5
    
    # Split version into components
    IFS='.' read -r -a version_parts <<< "$version"
    local major=${version_parts[0]}
    local minor=${version_parts[1]}
    local patch=${version_parts[2]}
    
    # Handle increment types
    case $increment_type in
        "major")
            if [ -n "$override_major" ]; then
                major=$override_major
            else
                major=$((major + 1))
            fi
            minor=0
            patch=0
            ;;
        "minor")
            if [ -n "$override_minor" ]; then
                minor=$override_minor
            else
                minor=$((minor + 1))
            fi
            patch=0
            ;;
        "patch")
            if [ -n "$override_patch" ]; then
                patch=$override_patch
            else
                patch=$((patch + 1))
            fi
            ;;
        *)
            echo "Invalid increment type. Use: major, minor, or patch"
            exit 1
            ;;
    esac
    
    # Apply individual overrides if provided
    if [ -n "$override_major" ] && [ "$increment_type" != "major" ]; then
        major=$override_major
    fi
    
    if [ -n "$override_minor" ] && [ "$increment_type" != "minor" ]; then
        minor=$override_minor
    fi
    
    if [ -n "$override_patch" ] && [ "$increment_type" != "patch" ]; then
        patch=$override_patch
    fi
    
    echo "$major.$minor.$patch"
}

# Function to update version in package.json
update_package_json() {
    local version=$1
    local file=$2
    # Use sed to update version in package.json
    sed -i '' "s/\"version\": \".*\"/\"version\": \"$version\"/" "$file"
}

# Function to update version in tauri.conf.json
update_tauri_conf() {
    local version=$1
    local file="web/src-tauri/tauri.conf.json"
    # Use sed to update version in tauri.conf.json
    sed -i '' "s/\"version\": \".*\"/\"version\": \"$version\"/" "$file"
}

# Function to update version in Cargo.toml
update_cargo_toml() {
    local version=$1
    local file="web/src-tauri/Cargo.toml"
    # Use sed to update only the package version in the [package] section
    # This targets the version field that comes after [package] and before the next section
    sed -i '' '/^\[package\]/,/^\[/ s/^version = ".*"/version = "'$version'"/' "$file"
}

# Function to build and push Docker images
build_and_push_docker() {
    local version=$1
    echo "Building Docker images..."
    
    # Build multi-platform images (ARM64 + AMD64)
    echo "Building web image $version..."
    docker buildx build --platform linux/amd64,linux/arm64 -f web/Dockerfile.prod -t alexwohlbruck/parchment-web:$version --push .

    echo "Building server image $version..."
    docker buildx build --platform linux/amd64,linux/arm64 -f server/Dockerfile.prod -t alexwohlbruck/parchment-server:$version --push .
    
    echo "Building web image latest..."
    docker buildx build --platform linux/amd64,linux/arm64 -f web/Dockerfile.prod -t alexwohlbruck/parchment-web:latest --push .

    echo "Building server image latest..."
    docker buildx build --platform linux/amd64,linux/arm64 -f server/Dockerfile.prod -t alexwohlbruck/parchment-server:latest --push .
}

# Function to build Tauri app
build_tauri() {
    echo "Building Tauri app..."
    cd web
    
    # # Build iOS app
    # echo "Building iOS app..."
    # bun run build:ios
    
    # Build Android app (AAB)
    echo "Building Android app (AAB)..."
    bun run build:android
    
    cd ..
}

# Function to show usage
show_usage() {
    echo "Usage: $0 <increment_type> [options]"
    echo "Example: $0 patch"
    echo "Example: $0 minor"
    echo "Example: $0 major"
    echo "Example: $0 patch --major 2 --minor 1 --patch 5"
    echo ""
    echo "Increment types: major, minor, patch"
    echo "Version format: MAJOR.MINOR.PATCH (standard semver)"
    echo ""
    echo "Options:"
    echo "  --major N      Override the major version component"
    echo "  --minor N      Override the minor version component"
    echo "  --patch N      Override the patch version component"
    echo "  --force        Skip version downgrade warning"
    exit 1
}

# Parse command line arguments
INCREMENT_TYPE=""
OVERRIDE_MAJOR=""
OVERRIDE_MINOR=""
OVERRIDE_PATCH=""
FORCE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --major)
            OVERRIDE_MAJOR="$2"
            shift 2
            ;;
        --minor)
            OVERRIDE_MINOR="$2"
            shift 2
            ;;
        --patch)
            OVERRIDE_PATCH="$2"
            shift 2
            ;;
        --force)
            FORCE=true
            shift
            ;;
        major|minor|patch)
            INCREMENT_TYPE="$1"
            shift
            ;;
        *)
            show_usage
            ;;
    esac
done

# Show usage if no increment type provided
if [ -z "$INCREMENT_TYPE" ]; then
    echo "No increment type provided, using default: patch"
    INCREMENT_TYPE="patch"
fi

# Get current version from web/package.json
CURRENT_VERSION=$(get_current_version "web/package.json")
echo "Current version: $CURRENT_VERSION"

# Calculate new version
NEW_VERSION=$(increment_version "$CURRENT_VERSION" "$INCREMENT_TYPE" "$OVERRIDE_MAJOR" "$OVERRIDE_MINOR" "$OVERRIDE_PATCH")
echo "New version: $NEW_VERSION"

# Compare versions
VERSION_COMPARISON=$(compare_versions "$NEW_VERSION" "$CURRENT_VERSION")
if [ "$VERSION_COMPARISON" = "less" ] && [ "$FORCE" = false ]; then
    echo "WARNING: New version ($NEW_VERSION) is lower than current version ($CURRENT_VERSION)"
    echo "This might cause issues with versioning and updates."
    echo "Use --force to proceed anyway."
    exit 1
fi

# Update all version numbers
update_package_json "$NEW_VERSION" "web/package.json"
update_package_json "$NEW_VERSION" "server/package.json"
update_tauri_conf "$NEW_VERSION"
update_cargo_toml "$NEW_VERSION"

# Build Tauri app
# build_tauri

# Build and push Docker images
# TODO: Check logged in to docker first
build_and_push_docker "$NEW_VERSION"

echo "Version update and deployment complete!" 