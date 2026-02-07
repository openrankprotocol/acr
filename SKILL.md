# ACR - Agent Curated Registry

**Trust infrastructure for autonomous agents on Solana.**

ACR helps you answer: *"Who should I trust in this context?"*

## Quick Start

```bash
# Check if an entity is trustworthy for copy trading
curl -X POST https://simpson-cigarette-logistics-futures.trycloudflare.com/v1/trust/query \
  -H "Content-Type: application/json" \
  -d '{
    "entity": {
      "type": "wallet",
      "identifier": "7kMpRKrJ6xQpZKqGEfDJ4K6j9xzQQrjwqJqKLqP4pZKK"
    },
    "context": "copy_trading"
  }'
```

## API Endpoints

### Free Endpoints

#### Health Check
```
GET /v1/health
```
Returns API status and database connection state.

#### List Registries
```
GET /v1/registries
```
Returns all available trust registries with their contexts and entity counts.

### Paid Endpoints (x402)

These endpoints require payment via the x402 protocol. On first request without payment, you'll receive a `402 Payment Required` response with payment instructions.

#### Trust Query - $0.02
```
POST /v1/trust/query
Content-Type: application/json

{
  "entity": {
    "type": "wallet" | "token",
    "identifier": "<solana_address>"
  },
  "context": "copy_trading" | "rugger_check" | "social_verification" | "token_analysis" | "bot_detection"
}
```

**Response:**
```json
{
  "entity_id": "wallet:7kMpRKrJ6xQpZKqGEfDJ4K6j9xzQQrjwqJqKLqP4pZKK",
  "context": "copy_trading",
  "score": 0.8234,
  "decision_hint": "allow",
  "provenance": [
    {
      "registry": "top_dex_traders",
      "weight": 0.85,
      "computed_at": "2026-02-06T12:05:14.118Z"
    }
  ]
}
```

#### Entity Lookup - $0.01
```
GET /v1/trust/entity/<type>:<identifier>?context=<context>
```

#### Top Entities - $0.05
```
GET /v1/trust/top?context=<context>&limit=10
```

## Trust Contexts

| Context | Description | Use Case |
|---------|-------------|----------|
| `copy_trading` | Top traders, whales, pump.fun traders | Should I copy this wallet's trades? |
| `rugger_check` | Known dev ruggers | Is this token creator trustworthy? |
| `social_verification` | KOLs, Farcaster users | Is this a real person with reputation? |
| `token_analysis` | Top tokens by market cap | Is this token legitimate? |
| `bot_detection` | Known bot wallets | Is this a bot or human? |

## Decision Hints

The `decision_hint` field provides actionable guidance:

- **`allow`** (score ≥ 0.7): Entity has positive reputation, safe to proceed
- **`review`** (0.3 ≤ score < 0.7): Mixed signals, manual review recommended  
- **`deny`** (score < 0.3): Entity has negative reputation or is unknown

## x402 Payment Flow

1. **Request** protected endpoint without payment
2. **Receive** `402 Payment Required` with payment requirements:
   ```json
   {
     "x402Version": 1,
     "accepts": [{
       "scheme": "exact",
       "network": "solana-devnet",
       "maxAmountRequired": "20000",
       "asset": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
       "payTo": "4zDGMwXJtXz5NHEfrAzCvUDGUGg1v5YG4LXVSrAb9JgC"
     }]
   }
   ```
3. **Create** Solana transaction with USDC transfer (facilitator pays gas)
4. **Submit** request with `X-PAYMENT` header containing base64-encoded payment
5. **Receive** response with trust data

**Facilitator:** `https://facilitator.payai.network` (gasless payments)

## Example: Copy Trading Policy

```javascript
async function shouldCopyTrade(walletAddress) {
  const response = await queryTrust({
    entity: { type: 'wallet', identifier: walletAddress },
    context: 'copy_trading'
  });
  
  if (response.decision_hint === 'allow') {
    return { copy: true, confidence: response.score };
  } else if (response.decision_hint === 'review') {
    return { copy: false, reason: 'Needs manual review', score: response.score };
  } else {
    return { copy: false, reason: 'Untrusted wallet' };
  }
}
```

## Example: Rug Check Before Swap

```javascript
async function checkBeforeSwap(tokenMint, creatorWallet) {
  // Check token reputation
  const tokenTrust = await queryTrust({
    entity: { type: 'token', identifier: tokenMint },
    context: 'token_analysis'
  });
  
  // Check creator reputation
  const creatorTrust = await queryTrust({
    entity: { type: 'wallet', identifier: creatorWallet },
    context: 'rugger_check'
  });
  
  if (creatorTrust.decision_hint === 'deny') {
    return { safe: false, reason: 'Creator is known rugger' };
  }
  
  if (tokenTrust.score < 0.5) {
    return { safe: false, reason: 'Token has low trust score' };
  }
  
  return { safe: true };
}
```

## Data Sources

ACR aggregates trust signals from:
- **Top DEX Traders** - Profitable Solana DEX traders
- **Pump.fun Traders** - Top memecoin traders
- **Solana Whales** - Large holders
- **Farcaster Users** - Socially verified wallets
- **KOLs** - Key Opinion Leaders
- **Dev Ruggers** - Known bad actors
- **Bot Traders** - Automated trading wallets
- **Top Tokens** - Market cap leaders

## Pricing

| Endpoint | Cost (USDC) |
|----------|-------------|
| Trust Query | $0.02 |
| Entity Lookup | $0.01 |
| Top Entities | $0.05 |

## Links

- **Demo:** https://acr-karma3labs.vercel.app
- **API:** https://simpson-cigarette-logistics-futures.trycloudflare.com
- **GitHub:** https://github.com/openrankprotocol/acr
- **x402 Spec:** https://docs.payai.network/x402/introduction

---

*Built for agents, by an agent. Because reputation is the universal currency.* 🔗
