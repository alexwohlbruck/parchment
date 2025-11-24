#!/bin/bash

# Build script for Parchment Tauri application
# Usage: ./build.sh [platform]
# Platforms: desktop, macos, macos-arm, windows, linux, ios, android, android-apk, all

set -e

PLATFORM=${1:-desktop}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🔨 Building Parchment for: $PLATFORM"

# Build frontend first
echo "📦 Building frontend..."
npm run build

# Build based on platform
case $PLATFORM in
  desktop)
    echo "🖥️  Building desktop app (current platform)..."
    bun tauri build
    ;;
  macos)
    echo "🍎 Building macOS app (x86_64)..."
    bun tauri build --target x86_64-apple-darwin
    ;;
  macos-arm)
    echo "🍎 Building macOS app (ARM64)..."
    bun tauri build --target aarch64-apple-darwin
    ;;
  windows)
    echo "🪟 Building Windows app..."
    bun tauri build --target x86_64-pc-windows-msvc
    ;;
  linux)
    echo "🐧 Building Linux app..."
    bun tauri build --target x86_64-unknown-linux-gnu
    ;;
  ios)
    echo "📱 Building iOS app..."
    bun tauri ios build
    ;;
  android)
    echo "🤖 Building Android app (AAB)..."
    bun tauri android build --aab
    ;;
  android-apk)
    echo "🤖 Building Android app (APK)..."
    bun tauri android build --apk --verbose
    ;;
  all)
    echo "🌍 Building for all platforms..."
    echo "Building macOS (x86_64)..."
    bun tauri build --target x86_64-apple-darwin || echo "⚠️  macOS x86_64 build failed"
    echo "Building macOS (ARM64)..."
    bun tauri build --target aarch64-apple-darwin || echo "⚠️  macOS ARM64 build failed"
    echo "Building Windows..."
    bun tauri build --target x86_64-pc-windows-msvc || echo "⚠️  Windows build failed"
    echo "Building Linux..."
    bun tauri build --target x86_64-unknown-linux-gnu || echo "⚠️  Linux build failed"
    ;;
  *)
    echo "❌ Unknown platform: $PLATFORM"
    echo "Available platforms: desktop, macos, macos-arm, windows, linux, ios, android, android-apk, all"
    exit 1
    ;;
esac

echo "✅ Build complete!"

