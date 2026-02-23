#!/bin/bash
# Test agent-browser functionality
set -e

echo "=== Testing agent-browser ==="

# Test 1: Open page
echo "1. Opening example.com..."
agent-browser open https://example.com

# Test 2: Take snapshot
echo "2. Taking snapshot..."
agent-browser snapshot | head -20

# Test 3: Screenshot
echo "3. Taking screenshot..."
agent-browser screenshot /tmp/test-screenshot.png
ls -la /tmp/test-screenshot.png

# Test 4: Close
echo "4. Closing browser..."
agent-browser close

echo "=== All tests passed ==="
