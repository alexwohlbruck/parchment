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

# Function to validate version format (MAJOR.MINOR.PATCH)
validate_version_format() {
    local v=$1
    if [[ "$v" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        return 0
    fi
    return 1
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

    IFS='.' read -r -a version_parts <<< "$version"
    local major=${version_parts[0]}
    local minor=${version_parts[1]}
    local patch=${version_parts[2]}

    case $increment_type in
        major)
            major=$((major + 1))
            minor=0
            patch=0
            ;;
        minor)
            minor=$((minor + 1))
            patch=0
            ;;
        patch)
            patch=$((patch + 1))
            ;;
        *)
            echo "Invalid increment type. Use: major, minor, or patch"
            exit 1
            ;;
    esac

    echo "$major.$minor.$patch"
}

# Function to update version in package.json
update_package_json() {
    local version=$1
    local file=$2
    sed -i '' "s/\"version\": \".*\"/\"version\": \"$version\"/" "$file"
}

# Function to update version in tauri.conf.json
update_tauri_conf() {
    local version=$1
    local file="web/src-tauri/tauri.conf.json"
    sed -i '' "s/\"version\": \".*\"/\"version\": \"$version\"/" "$file"
}

# Function to update version in Cargo.toml
update_cargo_toml() {
    local version=$1
    local file="web/src-tauri/Cargo.toml"
    sed -i '' '/^\[package\]/,/^\[/ s/^version = ".*"/version = "'$version'"/' "$file"
}

# Compute Android versionCode from MAJOR.MINOR.PATCH (must increase every Play Store upload)
version_to_android_version_code() {
    local version=$1
    IFS='.' read -r -a parts <<< "$version"
    local major=${parts[0]:-0}
    local minor=${parts[1]:-0}
    local patch=${parts[2]:-0}
    echo $(( major * 10000 + minor * 100 + patch ))
}

# Update Android versionCode in tauri.conf.json (Play Store requires it to always increase)
update_tauri_android_version_code() {
    local version=$1
    local file="web/src-tauri/tauri.conf.json"
    local computed
    computed=$(version_to_android_version_code "$version")
    local current=0
    if grep -q '"versionCode"' "$file" 2>/dev/null; then
        current=$(grep '"versionCode"' "$file" | sed 's/.*"versionCode": *\([0-9]*\).*/\1/')
    fi
    local code
    if [ "$computed" -gt "$(( current + 1 ))" ] 2>/dev/null; then
        code=$computed
    else
        code=$(( current + 1 ))
    fi
    sed -i '' 's/"versionCode": [0-9]*/"versionCode": '"$code"'/' "$file"
    echo "Android versionCode set to $code (from version $version)"
}

# Function to show usage
show_usage() {
    echo "Usage: $0 [increment_type] [options]"
    echo "       $0 --version X.Y.Z [options]"
    echo ""
    echo "Examples:"
    echo "  $0 patch              # Bump patch (e.g. 0.0.15 -> 0.0.16)"
    echo "  $0 minor              # Bump minor (e.g. 0.0.15 -> 0.1.0)"
    echo "  $0 major              # Bump major (e.g. 0.0.15 -> 1.0.0)"
    echo "  $0 --version 0.1.5    # Set exact version to 0.1.5"
    echo ""
    echo "Options:"
    echo "  --version X.Y.Z      Set exact version (MAJOR.MINOR.PATCH)"
    echo "  --force              Allow version downgrade (skip warning)"
    exit 1
}

# Parse command line arguments
INCREMENT_TYPE=""
EXPLICIT_VERSION=""
FORCE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --version)
            EXPLICIT_VERSION="$2"
            shift 2
            ;;
        --force)
            FORCE=true
            shift
            ;;
        major|minor|patch)
            if [ -n "$INCREMENT_TYPE" ]; then
                echo "Error: Only one of major, minor, patch, or --version may be specified."
                show_usage
            fi
            INCREMENT_TYPE="$1"
            shift
            ;;
        *)
            echo "Error: Unknown option or argument: $1"
            show_usage
            ;;
    esac
done

# Ensure we are on the dev branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "dev" ]; then
    echo "Error: Releases must be created from the 'dev' branch."
    echo "You are currently on '$CURRENT_BRANCH'."
    echo "Switch to dev first:"
    echo "  git checkout dev"
    exit 1
fi

# Ensure we have the latest code from origin
echo "Pulling latest changes from origin/dev..."
git fetch origin dev
LOCAL_HEAD=$(git rev-parse HEAD)
REMOTE_HEAD=$(git rev-parse origin/dev)
if [ "$LOCAL_HEAD" != "$REMOTE_HEAD" ]; then
    echo "Error: Your local dev branch is not up to date with origin/dev."
    echo "Please pull the latest changes before releasing:"
    echo "  git pull origin dev"
    exit 1
fi

# Check for gh CLI (needed to create PR)
if ! command -v gh &> /dev/null; then
    echo "Error: GitHub CLI (gh) is required to create pull requests."
    echo "Install it: https://cli.github.com/"
    exit 1
fi

# Resolve new version
if [ -n "$EXPLICIT_VERSION" ]; then
    if ! validate_version_format "$EXPLICIT_VERSION"; then
        echo "Error: --version must be MAJOR.MINOR.PATCH (e.g. 0.1.5)"
        exit 1
    fi
    NEW_VERSION="$EXPLICIT_VERSION"
elif [ -n "$INCREMENT_TYPE" ]; then
    CURRENT_VERSION=$(get_current_version "web/package.json")
    NEW_VERSION=$(increment_version "$CURRENT_VERSION" "$INCREMENT_TYPE")
else
    echo "No version specified. Using default: patch"
    CURRENT_VERSION=$(get_current_version "web/package.json")
    NEW_VERSION=$(increment_version "$CURRENT_VERSION" "patch")
fi

CURRENT_VERSION=$(get_current_version "web/package.json")
echo "Current version: $CURRENT_VERSION"
echo "New version:     $NEW_VERSION"

# Compare versions (downgrade check)
VERSION_COMPARISON=$(compare_versions "$NEW_VERSION" "$CURRENT_VERSION")
if [ "$VERSION_COMPARISON" = "less" ] && [ "$FORCE" = false ]; then
    echo ""
    echo "WARNING: New version ($NEW_VERSION) is lower than current version ($CURRENT_VERSION)."
    echo "This might cause issues with versioning and updates."
    echo "Use --force to proceed anyway."
    exit 1
fi

# Confirm version before continuing
echo ""
read -r -p "Proceed with version $NEW_VERSION? [y/N] " reply
if [[ ! "$reply" =~ ^[yY]$ ]]; then
    echo "Aborted."
    exit 0
fi

# Show changelog and confirm
echo ""
if [ -f CHANGELOG.md ]; then
    echo "--- CHANGELOG.md ---"
    cat CHANGELOG.md
    echo "---"
    echo ""
    echo "This will be used as the PR description and release notes."
fi
read -r -p "Confirm changelog is updated for this release. Continue? [y/N] " reply
if [[ ! "$reply" =~ ^[yY]$ ]]; then
    echo "Aborted. Update CHANGELOG.md and re-run."
    exit 0
fi

# Prompt for release title (used as PR title and GitHub Release name)
DEFAULT_RELEASE_TITLE="Release v$NEW_VERSION"
echo ""
read -r -p "Release title (press Enter for '$DEFAULT_RELEASE_TITLE'): " RELEASE_TITLE_INPUT
RELEASE_TITLE="${RELEASE_TITLE_INPUT:-$DEFAULT_RELEASE_TITLE}"
echo "Release title set to: $RELEASE_TITLE"

# Update all version numbers in repo (including Android versionCode for Play Store)
update_package_json "$NEW_VERSION" "web/package.json"
update_package_json "$NEW_VERSION" "server/package.json"
update_tauri_conf "$NEW_VERSION"
update_cargo_toml "$NEW_VERSION"
update_tauri_android_version_code "$NEW_VERSION"

echo ""
echo "Version files updated."

# Stage version files and commit
VERSION_FILES="web/package.json server/package.json web/src-tauri/tauri.conf.json web/src-tauri/Cargo.toml CHANGELOG.md"
git add $VERSION_FILES 2>/dev/null || true

if ! git status --short $VERSION_FILES 2>/dev/null | grep -q .; then
    echo "No version file changes to commit."
    exit 1
fi

echo "Staged changes:"
git status --short $VERSION_FILES
echo ""
read -r -p "Commit, push to dev, and create PR to main? [y/N] " reply
if [[ ! "$reply" =~ ^[yY]$ ]]; then
    echo "Aborted. Changes are staged but not committed."
    echo "When ready, commit and run this script again."
    exit 0
fi

# Commit and push to dev
git commit -m "Release $NEW_VERSION" $VERSION_FILES
echo "Committed release changes."

git push origin dev
echo "Pushed to origin/dev."

# Create PR from dev -> main
echo ""
echo "Creating pull request..."
CHANGELOG_BODY=$(cat CHANGELOG.md)
PR_URL=$(gh pr create \
    --base main \
    --head dev \
    --title "$RELEASE_TITLE" \
    --body "$CHANGELOG_BODY" \
    2>&1)

if [ $? -eq 0 ]; then
    echo ""
    echo "Pull request created: $PR_URL"
    echo ""
    echo "Next steps:"
    echo "  1. Wait for CI checks to pass"
    echo "  2. Merge the PR on GitHub"
    echo "  3. The release workflow will automatically tag and build"
else
    echo ""
    echo "Failed to create PR: $PR_URL"
    echo ""
    echo "You can create it manually:"
    echo "  gh pr create --base main --head dev --title \"$RELEASE_TITLE\""
fi
