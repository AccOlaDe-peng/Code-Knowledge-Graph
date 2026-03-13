#!/bin/bash

# Code Graph System v2 - Frontend Startup Script

echo "🎨 Starting Code Graph System v2 Frontend..."
echo ""

cd frontend

# Check if node_modules exists
if [ ! -d node_modules ]; then
    echo "📦 Installing dependencies..."
    npm install
    echo ""
fi

# Start the dev server
echo "🎯 Starting development server..."
npm run dev
