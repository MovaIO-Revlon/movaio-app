#!/bin/bash

# Script to authenticate with GHCR and start OpenCon services
# This script reads credentials from .env and handles docker login

set -e

# Load .env file
if [ ! -f .env ]; then
    echo "❌ Error: .env file not found"
    echo "Please create .env from .env.prod.example"
    exit 1
fi

# Export variables from .env
export $(grep -v '^#' .env | xargs)

# Check required variables
if [ -z "$GITHUB_USERNAME" ] || [ -z "$GITHUB_PAT" ]; then
    echo "❌ Error: GITHUB_USERNAME and GITHUB_PAT must be set in .env"
    echo "Add these lines to your .env file:"
    echo "  GITHUB_USERNAME=your_github_username"
    echo "  GITHUB_PAT=your_personal_access_token"
    exit 1
fi

# Login to GitHub Container Registry
echo "🔐 Logging in to GitHub Container Registry..."
echo "$GITHUB_PAT" | docker login ghcr.io -u "$GITHUB_USERNAME" --password-stdin

if [ $? -ne 0 ]; then
    echo "❌ Failed to authenticate with GHCR"
    exit 1
fi

echo "✅ Successfully authenticated"
echo ""

# Pull images
echo "📦 Pulling Docker images..."
docker-compose -f docker-compose.yml pull

if [ $? -ne 0 ]; then
    echo "❌ Failed to pull images"
    exit 1
fi

echo ""
echo "🚀 Starting services..."
docker-compose -f docker-compose.yml up -d

echo ""
echo "✅ Services started successfully!"
echo ""
echo "🌐 Access points:"
echo "   Frontend:     http://localhost:3000"
echo "   Backend API:  http://localhost:8000"
echo "   Coding Agent: http://localhost:8001"
