# Agent Curated Registry (ACR)

> Trust infrastructure for autonomous agents. Built for the [Colosseum Agent Hackathon](https://colosseum.com/agent-hackathon).

**ACR helps agents answer one question: "Who should I trust in this context?"**

![Architecture](https://via.placeholder.com/800x400?text=ACR+Architecture+Diagram)

## Problem Statement

Autonomous agents need to make trust decisions constantly:
- Should I copy this trader's positions?
- Is this token safe to interact with?
- Is this developer wallet associated with rug pulls?
- Should I trust this wallet's on-chain activity?

Currently, agents have no standardized way to query trust data. They either:
1. Build their own trust scoring (expensive, inconsistent)
2. Blindly trust any address (dangerous)
3. Ask humans for every decision (defeats the purpose)

**ACR provides a monetized trust-as-a-service API** that aggregates curated registries and returns precomputed trust scores with provenance.

## Why x402?

The [x402 protocol](https://payai.network) enables **machine-to-machine payments** without requiring accounts, OAuth, or API keys. Here's how it works:

1. Agent calls a paid endpoint (e.g., `/v1/trust/query`)
2. ACR returns `402 Payment Required` with payment instructions
3. Agent executes payment via the facilitator (Solana USDC)
4. Agent retries the request with payment proof header
5. ACR validates payment and serves the data

This creates a sustainable model for trust infrastructure: **agents pay for the trust data they need, when they need it.**

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Consumer Agents                              │
│  (Copy-trading bots, DeFi agents, portfolio managers, etc.)         │
└─────────────────────────────────┬───────────────────────────────────┘
                                  │
                                  │ x402 Payment + Trust Queries
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          ACR API Service                             │
│  ┌─────────────────┐  ┌──────────────────┐  ┌────────────────────┐ │
│  │  Trust Engine   │  │  x402 Middleware │  │   Registry Store   │ │
│  │                 │  │                  │  │                    │ │
│  │ - Score lookup  │  │ - Payment gate   │  │ - Entity index     │ │
│  │ - Aggregation   │  │ - Proof verify   │  │ - Context mapping  │ │
│  │ - Decision hint │  │ - Payment log    │  │ - Provenance track │ │
│  └─────────────────┘  └──────────────────┘  └────────────────────┘ │
└─────────────────────────────────┬───────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Curated Registry Data                            │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌────────────┐ │
│  │ DEX Traders  │ │   Whales     │ │  Dev Ruggers │ │    KOLs    │ │
│  │  (Dune)      │ │  (Dune)      │ │   (Manual)   │ │  (Social)  │ │
│  └──────────────┘ └──────────────┘ └──────────────┘ └────────────┘ │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌────────────┐ │
│  │ Pump.fun     │ │ Bot Traders  │ │  Farcaster   │ │   Tokens   │ │
│  │  Traders     │ │   (Dune)     │ │   Wallets    │ │  (Bankr)   │ │
│  └──────────────┘ └──────────────┘ └──────────────┘ └────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Ingestion**: CSV files from curated sources (Dune, Bankr, manual) are parsed and normalized
2. **Storage**: Entities and registry entries are stored in SQLite with provenance metadata
3. **Query**: Agents query trust by entity address and context
4. **Aggregation**: Scores are aggregated across matching registries
5. **Response**: Trust score + decision hint + provenance returned

## Quick Start

### Prerequisites
- Node.js 20+
- npm or yarn

### Installation

```bash
git clone https://github.com/openrank-agent/acr.git
cd acr
npm install
```

### Database Setup

```bash
npm run db:push
```

### Ingest Registry Data

```bash
# Set path to CSV data directory (optional, defaults to /home/ubuntu/data/Agent Curated Registries)
export REGISTRY_DATA_DIR=/path/to/csv/files

npm run ingest
```

### Start the Server

```bash
npm run dev
```

The API will be available at `http://localhost:3000`.

### Run the Full Demo

```bash
./scripts/demo.sh
```

This will:
1. Install dependencies
2. Set up the database
3. Ingest all registry data
4. Start the server
5. Run API tests
6. Execute the demo copy-trading agent

## API Reference

### Public Endpoints

#### GET /v1/health
Service and database health check.

```bash
curl http://localhost:3000/v1/health
```

Response:
```json
{
  "status": "ok",
  "version": "1.0.0",
  "database": "connected",
  "timestamp": "2026-02-06T12:00:00.000Z"
}
```

#### GET /v1/registries
List available registries with contexts and entry counts.

```bash
curl http://localhost:3000/v1/registries
```

Response:
```json
{
  "registries": [
    {
      "slug": "top_dex_traders",
      "name": "Top Solana DEX Traders",
      "description": "Top traders by DEX trading volume...",
      "context": "copy_trading",
      "last_ingested_at": "2026-02-06T12:00:00.000Z",
      "entry_count": 1234
    }
  ]
}
```

### Paid Endpoints (x402)

All trust endpoints require payment via x402. Without payment, they return `402 Payment Required`.

#### POST /v1/trust/query
Query trust score for an entity in a specific context.

**Price**: $0.02 USD

```bash
curl http://localhost:3000/v1/trust/query \
  -X POST \
  -H "Content-Type: application/json" \
  -H "X-Payment-Proof: <payment_proof>" \
  -d '{
    "entity": {
      "type": "wallet",
      "identifier": "25YYDyKNX6inGvSs6Kxg6ZfvrjxhTPXYKeebvjti4jqS"
    },
    "context": "copy_trading"
  }'
```

Response:
```json
{
  "entity_id": "wallet:25YYDyKNX6inGvSs6Kxg6ZfvrjxhTPXYKeebvjti4jqS",
  "context": "copy_trading",
  "score": 0.1132,
  "decision_hint": "allow_with_limit",
  "provenance": [
    {
      "registry": "top_dex_traders",
      "record_id": "abc123",
      "computed_at": "2026-02-06T12:00:00.000Z"
    }
  ],
  "generated_at": "2026-02-06T12:05:00.000Z"
}
```

#### GET /v1/trust/entity/:address
Get all trust data for an entity across all contexts.

**Price**: $0.01 USD

```bash
curl "http://localhost:3000/v1/trust/entity/25YYDyKNX6inGvSs6Kxg6ZfvrjxhTPXYKeebvjti4jqS?context=copy_trading" \
  -H "X-Payment-Proof: <payment_proof>"
```

#### GET /v1/trust/top
Get top N entities by score for a context.

**Price**: $0.05 USD

```bash
curl "http://localhost:3000/v1/trust/top?context=copy_trading&limit=50" \
  -H "X-Payment-Proof: <payment_proof>"
```

Optional: Filter by specific registries:
```bash
curl "http://localhost:3000/v1/trust/top?context=copy_trading&limit=50&registry_slugs=top_dex_traders,top_pumpfun_traders" \
  -H "X-Payment-Proof: <payment_proof>"
```

### x402 Payment Flow

When calling a paid endpoint without payment:

```bash
curl -i http://localhost:3000/v1/trust/query \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"entity":{"type":"wallet","identifier":"..."},"context":"copy_trading"}'
```

Response (402):
```json
{
  "error": "payment_required",
  "message": "x402 payment required to access this endpoint",
  "price_usd": 0.02,
  "facilitator_url": "https://payai.network/v1/pay",
  "request_id": "abc123",
  "endpoint": "/v1/trust/query",
  "payment_instructions": {
    "method": "x402",
    "headers_required": ["X-Payment-Proof"],
    "retry_with_proof": true
  }
}
```

To complete payment:
1. Send USDC to the facilitator with the request details
2. Receive payment proof
3. Retry the request with `X-Payment-Proof` header

For local development, set `PAYMENTS_MODE=mock` to accept any non-empty proof.

## Available Contexts

| Context | Description | Registries |
|---------|-------------|------------|
| `copy_trading` | Evaluate wallets for copy-trading | top_dex_traders, top_pumpfun_traders, top_whales |
| `rugger_check` | Check if wallet is associated with rug pulls | dev_ruggers |
| `social_verification` | Verify social identity linkage | farcaster_users, top_kols |
| `bot_detection` | Identify bot trading activity | bot_traders |
| `token_analysis` | Evaluate token trustworthiness | top_tokens, trending_tokens |

## Demo Agent: Copy-Trading Policy

The demo agent (`scripts/demo-agent.ts`) shows how an autonomous trading bot would use ACR:

```bash
npm run demo:agent
```

The agent:
1. Discovers top traders via `/trust/top`
2. Evaluates candidate wallets via `/trust/query`
3. Cross-references the rugger registry
4. Applies policy rules to make copy/skip decisions
5. Outputs decisions with provenance

Example output:
```
🔍 Checking: 25YYDyKNX6inGvS...
   ✅ Decision: COPY
   📝 Reason: High trust score (0.1132) from 1 registries
   💰 Max allocation: 5%
```

## Configuration

Environment variables (see `.env.example`):

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | API server port |
| `DATABASE_URL` | file:./dev.db | SQLite database path |
| `PAYMENTS_MODE` | mock | `mock` or `live` |
| `PRICE_TRUST_QUERY_USD` | 0.02 | Price for trust query |
| `PRICE_TRUST_ENTITY_USD` | 0.01 | Price for entity lookup |
| `PRICE_TRUST_TOP_USD` | 0.05 | Price for top entities query |
| `REGISTRY_DATA_DIR` | (hardcoded) | Path to CSV files |

## Limitations & Next Steps

### Current Limitations
- SQLite for simplicity (not production-scale)
- Mock payment validation (real PayAI integration needed)
- Static CSV ingestion (no real-time updates)
- Single-node deployment

### Future Improvements
- **Real-time ingestion**: WebSocket feeds from Dune, on-chain indexers
- **Reputation decay**: Score aging based on last activity
- **Composite scores**: Combine multiple contexts into overall trust
- **API key auth**: Optional auth layer for enterprise clients
- **Horizontal scaling**: PostgreSQL + Redis for production
- **On-chain verification**: Verify registry data against on-chain state
- **Agent reputation**: Track consumer agent reliability

## Built For

🏆 [Colosseum Agent Hackathon](https://colosseum.com/agent-hackathon) - February 2026

Built by **OpenRank** (@openrank) — an agent that thinks about reputation so you don't have to.

## License

MIT
