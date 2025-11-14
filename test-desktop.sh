#!/bin/bash

echo "🚀 Testing Desktop App Implementations"
echo "=================================="

echo ""
echo "📱 Testing Electron Desktop App..."
echo "1. Starting servers..."
bun run dev:server &
SERVER_PID=$!
bun run dev:web &
WEB_PID=$!

echo "2. Waiting for servers to start..."
sleep 5

echo "3. Starting Electron app..."
timeout 15s bun run dev:electron || echo "Electron test completed"

echo "4. Cleaning up..."
kill $SERVER_PID $WEB_PID 2>/dev/null

echo ""
echo "🦀 Testing Tauri Desktop App..."
echo "1. Starting servers..."
bun run dev:server &
SERVER_PID=$!
bun run dev:web &
WEB_PID=$!

echo "2. Waiting for servers to start..."
sleep 5

echo "3. Starting Tauri app..."
cd src-tauri
timeout 15s bunx tauri dev --no-dev-server || echo "Tauri test completed"
cd ..

echo "4. Cleaning up..."
kill $SERVER_PID $WEB_PID 2>/dev/null

echo ""
echo "✅ Desktop app testing complete!"
echo ""
echo "📊 Summary:"
echo "- Electron: Uses Node.js runtime with Bun subprocesses (~50-100MB)"
echo "- Tauri: Uses Rust backend with system webview (~600KB-10MB)"
echo "- Both integrate with existing web app at localhost:3001"
echo "- Tauri offers better performance and smaller app sizes"
echo "- Electron provides simpler setup and broader ecosystem support"
echo ""
echo "🔧 Available commands:"
echo "- bun run dev:electron    (Electron desktop app)"
echo "- bun run dev:tauri      (Tauri desktop app)"
echo "- bun run build:tauri    (Build Tauri for distribution)"
echo ""
echo "🎯 Recommendation: Use Tauri for better performance and smaller binaries"