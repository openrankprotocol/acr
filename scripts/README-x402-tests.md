# x402 Payment Integration Tests

This script tests the paid ACR endpoints using real x402 payments on Solana devnet.

## Prerequisites

### 1. Test Wallet

A wallet has been created at `~/.config/solana/test-wallet.json`:
- **Address**: `H5pmwPdcEbUh7d8qvtMsb3A68fJeJe6oihnn9xx6E6pe`
- **USDC Balance**: 20 USDC (funded)
- **SOL Balance**: Needs funding for tx fees

### 2. Fund SOL for Transaction Fees

The wallet needs ~0.01 SOL for transaction fees. Options:

**Option A: Solana Faucet (Web)**
1. Visit https://faucet.solana.com
2. Select "Devnet"
3. Enter address: `H5pmwPdcEbUh7d8qvtMsb3A68fJeJe6oihnn9xx6E6pe`
4. Request airdrop

**Option B: Solana CLI**
```bash
solana airdrop 1 H5pmwPdcEbUh7d8qvtMsb3A68fJeJe6oihnn9xx6E6pe --url devnet
```

**Option C: Transfer from another devnet wallet**
If you have another funded devnet wallet, transfer SOL to this address.

### 3. ACR Server

Start the ACR server in **live payment mode**:
```bash
cd ~/projects/acr
PAYMENTS_MODE=live npm run dev
```

## Running Tests

### Check Wallet Setup
```bash
npm run test:x402:check
```

### Run Full Test Suite
```bash
npm run test:x402
```

### Custom Options
```bash
# Test against different server
tsx scripts/test-x402-payments.ts --server http://localhost:3000

# Use different wallet
tsx scripts/test-x402-payments.ts --wallet ./my-wallet.json

# Show help
tsx scripts/test-x402-payments.ts --help
```

## Test Coverage

| Test | Endpoint | Cost |
|------|----------|------|
| Health check | GET /v1/health | Free |
| List registries | GET /v1/registries | Free |
| 402 response format | POST /v1/trust/query | Free (preflight) |
| Reject invalid payment | POST /v1/trust/query | Free |
| Trust query | POST /v1/trust/query | $0.02 |
| Entity lookup | GET /v1/trust/entity/:addr | $0.01 |
| Top entities | GET /v1/trust/top | $0.05 |

**Total cost per run**: ~$0.08 USDC

## Payment Flow

1. Client makes request without payment header
2. Server returns 402 with payment requirements (amount, recipient, network)
3. Client creates signed Solana USDC transfer transaction
4. Client encodes payment payload as base64 in `X-PAYMENT` header
5. Server verifies payment via PayAI facilitator
6. Server settles payment (executes transaction)
7. Server returns requested data with `X-PAYMENT-RESPONSE` header

## Troubleshooting

### "Insufficient SOL"
Fund the wallet with SOL using one of the methods above.

### "402 Payment Required" after payment
- Check that ACR is running with `PAYMENTS_MODE=live`
- Verify PayAI facilitator is reachable
- Check that USDC amount matches requirements

### Transaction fails
- Ensure wallet has enough USDC
- Check Solana devnet status: https://status.solana.com

## Configuration

Environment variables in `.env`:
```env
PAYMENTS_MODE=live
PAYAI_FACILITATOR_URL=https://facilitator.payai.network
PAYAI_MERCHANT_ADDRESS=4zDGMwXJtXz5NHEfrAzCvUDGUGg1v5YG4LXVSrAb9JgC
PAYAI_NETWORK=solana-devnet
```
