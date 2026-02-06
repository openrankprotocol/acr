#!/bin/bash
# ACR Demo Script - Full demonstration of the Agent Curated Registry

set -e

echo "🔗 ACR Demo - Agent Curated Registry"
echo "====================================="
echo ""

# Check if node is available
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is required but not installed."
    exit 1
fi

# Navigate to project root
cd "$(dirname "$0")/.."

# Step 1: Install dependencies
echo "1️⃣  Installing dependencies..."
npm install --silent
echo "   ✅ Dependencies installed"
echo ""

# Step 2: Generate Prisma client
echo "2️⃣  Generating Prisma client..."
npx prisma generate
echo "   ✅ Prisma client generated"
echo ""

# Step 3: Create/migrate database
echo "3️⃣  Setting up database..."
npx prisma db push --force-reset --accept-data-loss
echo "   ✅ Database ready"
echo ""

# Step 4: Ingest registry data
echo "4️⃣  Ingesting registry data..."
npm run ingest
echo ""

# Step 5: Start the server in background
echo "5️⃣  Starting ACR server..."
npm run dev &
SERVER_PID=$!
echo "   Server PID: $SERVER_PID"
sleep 3  # Wait for server to start
echo ""

# Step 6: Test health endpoint
echo "6️⃣  Testing health endpoint..."
curl -s http://localhost:3000/v1/health | jq .
echo ""

# Step 7: Test registries endpoint
echo "7️⃣  Listing available registries..."
curl -s http://localhost:3000/v1/registries | jq '.registries[] | {slug, name, context, entry_count}'
echo ""

# Step 8: Test unpaid trust query (should return 402)
echo "8️⃣  Testing trust query WITHOUT payment (expect 402)..."
curl -s -w "\n   HTTP Status: %{http_code}\n" http://localhost:3000/v1/trust/query \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"entity":{"type":"wallet","identifier":"25YYDyKNX6inGvSs6Kxg6ZfvrjxhTPXYKeebvjti4jqS"},"context":"copy_trading"}' | jq .
echo ""

# Step 9: Test paid trust query
echo "9️⃣  Testing trust query WITH payment proof..."
curl -s http://localhost:3000/v1/trust/query \
  -X POST \
  -H "Content-Type: application/json" \
  -H "X-Payment-Proof: demo-payment-proof" \
  -d '{"entity":{"type":"wallet","identifier":"25YYDyKNX6inGvSs6Kxg6ZfvrjxhTPXYKeebvjti4jqS"},"context":"copy_trading"}' | jq .
echo ""

# Step 10: Test top traders endpoint
echo "🔟 Getting top traders..."
curl -s "http://localhost:3000/v1/trust/top?context=copy_trading&limit=5" \
  -H "X-Payment-Proof: demo-payment-proof" | jq '.entities[:3]'
echo ""

# Step 11: Run demo agent
echo "1️⃣1️⃣ Running demo copy-trading agent..."
echo ""
npm run demo:agent

# Cleanup
echo ""
echo "🧹 Cleaning up..."
kill $SERVER_PID 2>/dev/null || true
echo "   ✅ Server stopped"
echo ""
echo "🎉 Demo complete!"
