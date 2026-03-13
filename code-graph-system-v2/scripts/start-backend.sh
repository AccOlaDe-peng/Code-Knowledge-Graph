#!/bin/bash

# Code Graph System v2 - Backend Startup Script

echo "🚀 Starting Code Graph System v2 Backend..."
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "⚠️  Warning: .env file not found"
    echo "📝 Creating .env from .env.example..."
    cp .env.example .env
    echo "✅ Created .env file. Please edit it and add your API keys."
    echo ""
fi

# Check if node_modules exists
if [ ! -d node_modules ]; then
    echo "📦 Installing dependencies..."
    npm install
    echo ""
fi

# Start the server
echo "🎯 Starting API server..."
npm run dev
