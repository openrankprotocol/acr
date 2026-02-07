#!/usr/bin/env tsx
/**
 * Integration Test: x402 Payments on Solana Devnet
 * 
 * Tests paid ACR endpoints using real USDC payments via PayAI facilitator.
 * 
 * Prerequisites:
 * - Funded Solana wallet at ~/.config/solana/test-wallet.json
 * - Wallet needs SOL for tx fees and USDC for payments
 * - ACR server running with PAYMENTS_MODE=live
 * 
 * Usage:
 *   # Run all tests (requires funded wallet)
 *   tsx scripts/test-x402-payments.ts
 * 
 *   # Check wallet setup only
 *   tsx scripts/test-x402-payments.ts --check
 * 
 *   # Test against specific server
 *   tsx scripts/test-x402-payments.ts --server http://localhost:3000
 * 
 *   # Use custom wallet
 *   tsx scripts/test-x402-payments.ts --wallet ./my-wallet.json
 * 
 * To fund your test wallet on devnet:
 *   1. Get SOL: Visit https://faucet.solana.com and enter your wallet address
 *   2. Get USDC: Use Solana devnet faucet or swap
 */

import { 
  Keypair, 
  Connection, 
  PublicKey, 
  Transaction, 
  TransactionInstruction,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import { 
  getAssociatedTokenAddress, 
  createTransferCheckedInstruction,
  getAccount,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  serverUrl: process.env.ACR_SERVER_URL || 'http://localhost:3000',
  walletPath: process.env.WALLET_PATH || path.join(process.env.HOME!, '.config/solana/test-wallet.json'),
  rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
  usdcMint: new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'),
  facilitatorUrl: 'https://facilitator.payai.network',
  network: 'solana-devnet',
  
  // PayAI facilitator's fee payer (they pay gas, we just sign for transfer)
  facilitatorFeePayer: new PublicKey('2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4'),
  
  // Test entities from ACR database
  testEntities: [
    'CaY31pZ26fQYPBrWYB1FxXdiwPvqcXtK8NMu4VkY6TgF',
    '7kMpRKrJ6xQpZKqGEfDJ4K6j9xzQQrjwqJqKLqP4pZKK',
  ],
};

// ============================================================================
// Utility Functions
// ============================================================================

function loadWallet(walletPath: string): Keypair {
  const secretKey = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
  return Keypair.fromSecretKey(new Uint8Array(secretKey));
}

function formatUSDC(atomicUnits: bigint | number): string {
  const n = typeof atomicUnits === 'bigint' ? atomicUnits : BigInt(atomicUnits);
  return `$${(Number(n) / 1_000_000).toFixed(6)} USDC`;
}

function formatSOL(lamports: number): string {
  return `${(lamports / 1e9).toFixed(4)} SOL`;
}

function usdToAtomic(usd: number): bigint {
  return BigInt(Math.round(usd * 1_000_000));
}

// ============================================================================
// PayAI Client
// ============================================================================

interface PaymentRequirements {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  asset: string;
  payTo: string;
  resource: string;
  description: string;
  mimeType: string;
  maxTimeoutSeconds: number;
}

interface X402Response {
  x402Version: number;
  error: string;
  accepts: PaymentRequirements[];
}

interface PaymentPayload {
  x402Version: number;
  scheme: string;
  network: string;
  payload: {
    transaction: string;  // Base64-encoded partially-signed transaction
  };
}

class PayAIClient {
  private connection: Connection;
  private wallet: Keypair;
  
  constructor(wallet: Keypair, rpcUrl: string) {
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.wallet = wallet;
  }
  
  get publicKey(): PublicKey {
    return this.wallet.publicKey;
  }
  
  async getSOLBalance(): Promise<number> {
    return this.connection.getBalance(this.wallet.publicKey);
  }
  
  async getUSDCBalance(): Promise<bigint> {
    const ata = await getAssociatedTokenAddress(CONFIG.usdcMint, this.wallet.publicKey);
    try {
      const account = await getAccount(this.connection, ata);
      return account.amount;
    } catch {
      return BigInt(0);
    }
  }
  
  async createPaymentTransaction(requirements: PaymentRequirements): Promise<Transaction> {
    const amount = BigInt(requirements.maxAmountRequired);
    const recipient = new PublicKey(requirements.payTo);
    
    // Get ATAs
    const senderAta = getAssociatedTokenAddressSync(CONFIG.usdcMint, this.wallet.publicKey);
    const recipientAta = getAssociatedTokenAddressSync(CONFIG.usdcMint, recipient);
    
    // For x402 on Solana, the transaction must have exactly 3 instructions:
    // 1. setComputeUnitLimit
    // 2. setComputeUnitPrice
    // 3. createTransferCheckedInstruction
    // And the fee payer must be the facilitator's managed address
    
    const instructions: TransactionInstruction[] = [
      // Set compute unit limit (keep low per facilitator requirements)
      ComputeBudgetProgram.setComputeUnitLimit({ units: 50_000 }),
      // Set compute unit price (priority fee)
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100 }),
      // Transfer USDC (using transferChecked for proper decimal handling)
      createTransferCheckedInstruction(
        senderAta,           // from
        CONFIG.usdcMint,     // mint
        recipientAta,        // to
        this.wallet.publicKey, // owner/authority
        amount,              // amount
        6,                   // decimals (USDC has 6)
        [],                  // multisig signers
        TOKEN_PROGRAM_ID
      ),
    ];
    
    // Build transaction with FACILITATOR as fee payer (they pay gas)
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();
    const transaction = new Transaction({
      feePayer: CONFIG.facilitatorFeePayer,  // Facilitator pays gas
      blockhash,
      lastValidBlockHeight,
    });
    
    instructions.forEach(ix => transaction.add(ix));
    
    // Partially sign - we sign for transfer authority only
    // Facilitator will add their fee payer signature
    transaction.partialSign(this.wallet);
    
    return transaction;
  }
  
  async createPaymentPayload(requirements: PaymentRequirements): Promise<PaymentPayload> {
    const transaction = await this.createPaymentTransaction(requirements);
    
    // For Solana x402, serialize with requireAllSignatures=false since
    // the facilitator hasn't signed yet (they're the fee payer)
    const serializedTx = transaction.serialize({ 
      requireAllSignatures: false,
      verifySignatures: false,
    }).toString('base64');
    
    // Solana x402 payload only contains the transaction (not a separate signature)
    return {
      x402Version: 1,
      scheme: requirements.scheme,
      network: requirements.network,
      payload: {
        transaction: serializedTx,
      },
    };
  }
  
  encodePaymentHeader(payload: PaymentPayload): string {
    return Buffer.from(JSON.stringify(payload)).toString('base64');
  }
}

// ============================================================================
// Test Runner
// ============================================================================

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  details?: string;
  error?: string;
  costUsd?: number;
}

class TestRunner {
  private results: TestResult[] = [];
  private client: PayAIClient;
  private totalCost = 0;
  
  constructor(wallet: Keypair) {
    this.client = new PayAIClient(wallet, CONFIG.rpcUrl);
  }
  
  private async runTest(name: string, fn: () => Promise<{ costUsd?: number }>): Promise<void> {
    const start = Date.now();
    try {
      const result = await fn();
      this.results.push({
        name,
        passed: true,
        duration: Date.now() - start,
        costUsd: result.costUsd,
      });
      if (result.costUsd) this.totalCost += result.costUsd;
      const costStr = result.costUsd ? ` (cost: $${result.costUsd.toFixed(4)})` : '';
      console.log(`  ✅ ${name} (${Date.now() - start}ms)${costStr}`);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.results.push({
        name,
        passed: false,
        duration: Date.now() - start,
        error,
      });
      console.log(`  ❌ ${name}: ${error}`);
    }
  }
  
  async checkSetup(): Promise<boolean> {
    console.log('\n🔍 Checking Wallet Setup');
    console.log('═'.repeat(50));
    console.log(`Wallet:  ${this.client.publicKey.toBase58()}`);
    
    const solBalance = await this.client.getSOLBalance();
    const usdcBalance = await this.client.getUSDCBalance();
    
    console.log(`SOL:     ${formatSOL(solBalance)}`);
    console.log(`USDC:    ${formatUSDC(usdcBalance)}`);
    console.log('═'.repeat(50));
    
    let ready = true;
    
    if (solBalance < 0.01 * 1e9) {
      console.log('\n⚠️  Insufficient SOL for transaction fees');
      console.log('   Get devnet SOL: https://faucet.solana.com');
      console.log(`   Address: ${this.client.publicKey.toBase58()}`);
      ready = false;
    }
    
    if (usdcBalance < usdToAtomic(0.10)) {
      console.log('\n⚠️  Insufficient USDC for tests (need at least $0.10)');
      console.log('   Current balance:', formatUSDC(usdcBalance));
      ready = false;
    }
    
    if (ready) {
      console.log('\n✅ Wallet is ready for testing!');
    }
    
    return ready;
  }
  
  async run(): Promise<void> {
    console.log('\n🧪 ACR x402 Payment Integration Tests');
    console.log('═'.repeat(50));
    console.log(`Server:  ${CONFIG.serverUrl}`);
    console.log(`Network: ${CONFIG.network}`);
    console.log(`Wallet:  ${this.client.publicKey.toBase58()}`);
    
    const solBalance = await this.client.getSOLBalance();
    const usdcBalance = await this.client.getUSDCBalance();
    console.log(`SOL:     ${formatSOL(solBalance)}`);
    console.log(`USDC:    ${formatUSDC(usdcBalance)}`);
    console.log('═'.repeat(50));
    
    // Preflight checks
    if (solBalance < 0.005 * 1e9) {
      console.error('\n❌ Insufficient SOL for transaction fees.');
      console.error('   Get devnet SOL: https://faucet.solana.com');
      process.exit(1);
    }
    
    if (usdcBalance < usdToAtomic(0.10)) {
      console.error('\n❌ Insufficient USDC balance. Need at least $0.10 USDC.');
      process.exit(1);
    }
    
    // Run tests
    console.log('\n📋 Running Tests...\n');
    
    // Free endpoints
    console.log('Free Endpoints:');
    await this.testHealthEndpoint();
    await this.testRegistriesEndpoint();
    
    // 402 format
    console.log('\nx402 Protocol:');
    await this.test402ResponseFormat();
    await this.testInvalidPayment();
    
    // Paid endpoints
    console.log('\nPaid Endpoints:');
    await this.testPaidTrustQuery();
    await this.testPaidEntityLookup();
    await this.testPaidTopEntities();
    
    // Summary
    this.printSummary();
  }
  
  private async testHealthEndpoint(): Promise<void> {
    await this.runTest('GET /v1/health', async () => {
      const res = await fetch(`${CONFIG.serverUrl}/v1/health`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.status !== 'ok' && data.status !== 'degraded') {
        throw new Error(`Unhealthy: ${JSON.stringify(data)}`);
      }
      return {};
    });
  }
  
  private async testRegistriesEndpoint(): Promise<void> {
    await this.runTest('GET /v1/registries', async () => {
      const res = await fetch(`${CONFIG.serverUrl}/v1/registries`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data.registries)) throw new Error('Invalid response');
      return {};
    });
  }
  
  private async test402ResponseFormat(): Promise<void> {
    await this.runTest('402 Response Format', async () => {
      const res = await fetch(`${CONFIG.serverUrl}/v1/trust/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entity: { type: 'wallet', identifier: CONFIG.testEntities[0] },
          context: 'copy_trading',
        }),
      });
      
      if (res.status !== 402) throw new Error(`Expected 402, got ${res.status}`);
      
      const data: X402Response = await res.json();
      if (data.x402Version !== 1) throw new Error('Invalid x402Version');
      if (!data.accepts?.[0]) throw new Error('No payment options');
      
      const accept = data.accepts[0];
      if (accept.network !== CONFIG.network) throw new Error(`Wrong network: ${accept.network}`);
      if (!accept.payTo) throw new Error('Missing payTo');
      if (!accept.maxAmountRequired) throw new Error('Missing amount');
      
      return {};
    });
  }
  
  private async testInvalidPayment(): Promise<void> {
    await this.runTest('Reject Invalid Payment', async () => {
      const fakePayment = {
        x402Version: 1,
        scheme: 'exact',
        network: CONFIG.network,
        payload: { transaction: 'invalid_transaction_data' },
      };
      
      const res = await fetch(`${CONFIG.serverUrl}/v1/trust/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-PAYMENT': Buffer.from(JSON.stringify(fakePayment)).toString('base64'),
        },
        body: JSON.stringify({
          entity: { type: 'wallet', identifier: CONFIG.testEntities[0] },
          context: 'copy_trading',
        }),
      });
      
      if (res.status !== 402) {
        throw new Error(`Expected 402, got ${res.status}`);
      }
      return {};
    });
  }
  
  private async testPaidTrustQuery(): Promise<void> {
    await this.runTest('POST /v1/trust/query (paid)', async () => {
      // Get 402 requirements
      const preRes = await fetch(`${CONFIG.serverUrl}/v1/trust/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entity: { type: 'wallet', identifier: CONFIG.testEntities[0] },
          context: 'copy_trading',
        }),
      });
      
      if (preRes.status !== 402) throw new Error(`Preflight: ${preRes.status}`);
      const requirements: X402Response = await preRes.json();
      const paymentReq = requirements.accepts[0];
      const costUsd = Number(paymentReq.maxAmountRequired) / 1e6;
      
      // Create payment
      const payload = await this.client.createPaymentPayload(paymentReq);
      const header = this.client.encodePaymentHeader(payload);
      
      // Make paid request
      const res = await fetch(`${CONFIG.serverUrl}/v1/trust/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-PAYMENT': header,
        },
        body: JSON.stringify({
          entity: { type: 'wallet', identifier: CONFIG.testEntities[0] },
          context: 'copy_trading',
        }),
      });
      
      if (res.status !== 200 && res.status !== 404) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 100)}`);
      }
      
      return { costUsd };
    });
  }
  
  private async testPaidEntityLookup(): Promise<void> {
    await this.runTest('GET /v1/trust/entity/:addr (paid)', async () => {
      const addr = CONFIG.testEntities[0];
      
      const preRes = await fetch(`${CONFIG.serverUrl}/v1/trust/entity/${addr}`);
      if (preRes.status !== 402) throw new Error(`Preflight: ${preRes.status}`);
      
      const requirements: X402Response = await preRes.json();
      const paymentReq = requirements.accepts[0];
      const costUsd = Number(paymentReq.maxAmountRequired) / 1e6;
      
      const payload = await this.client.createPaymentPayload(paymentReq);
      const header = this.client.encodePaymentHeader(payload);
      
      const res = await fetch(`${CONFIG.serverUrl}/v1/trust/entity/${addr}`, {
        headers: { 'X-PAYMENT': header },
      });
      
      if (res.status !== 200 && res.status !== 404) {
        throw new Error(`HTTP ${res.status}`);
      }
      
      return { costUsd };
    });
  }
  
  private async testPaidTopEntities(): Promise<void> {
    await this.runTest('GET /v1/trust/top (paid)', async () => {
      const url = `${CONFIG.serverUrl}/v1/trust/top?context=copy_trading&limit=5`;
      
      const preRes = await fetch(url);
      if (preRes.status !== 402) throw new Error(`Preflight: ${preRes.status}`);
      
      const requirements: X402Response = await preRes.json();
      const paymentReq = requirements.accepts[0];
      const costUsd = Number(paymentReq.maxAmountRequired) / 1e6;
      
      const payload = await this.client.createPaymentPayload(paymentReq);
      const header = this.client.encodePaymentHeader(payload);
      
      const res = await fetch(url, { headers: { 'X-PAYMENT': header } });
      
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
      
      const data = await res.json();
      if (!Array.isArray(data.entities)) throw new Error('Invalid response');
      
      return { costUsd };
    });
  }
  
  private printSummary(): void {
    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => !r.passed).length;
    const totalTime = this.results.reduce((sum, r) => sum + r.duration, 0);
    
    console.log('\n' + '═'.repeat(50));
    console.log('📊 Test Summary');
    console.log('═'.repeat(50));
    console.log(`Tests:     ${this.results.length} (${passed} passed, ${failed} failed)`);
    console.log(`Duration:  ${totalTime}ms`);
    console.log(`Cost:      $${this.totalCost.toFixed(4)} USDC`);
    
    if (failed > 0) {
      console.log('\n❌ Failed Tests:');
      this.results.filter(r => !r.passed).forEach(r => {
        console.log(`  • ${r.name}: ${r.error}`);
      });
    }
    
    console.log('\n' + (failed === 0 ? '🎉 All tests passed!' : '⚠️  Some tests failed'));
    process.exit(failed > 0 ? 1 : 0);
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  let checkOnly = false;
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--server' && args[i + 1]) {
      CONFIG.serverUrl = args[++i];
    } else if (args[i] === '--wallet' && args[i + 1]) {
      CONFIG.walletPath = args[++i];
    } else if (args[i] === '--check') {
      checkOnly = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
x402 Payment Integration Tests

Usage:
  tsx scripts/test-x402-payments.ts [options]

Options:
  --server URL    ACR server URL (default: http://localhost:3000)
  --wallet PATH   Wallet JSON file (default: ~/.config/solana/test-wallet.json)
  --check         Only check wallet setup, don't run tests
  --help          Show this help

Environment Variables:
  ACR_SERVER_URL   Alternative to --server
  WALLET_PATH      Alternative to --wallet
  SOLANA_RPC_URL   Custom Solana RPC endpoint
      `);
      process.exit(0);
    }
  }
  
  if (!fs.existsSync(CONFIG.walletPath)) {
    console.error(`❌ Wallet not found: ${CONFIG.walletPath}`);
    console.error('\nCreate a wallet with:');
    console.error('  solana-keygen new -o ~/.config/solana/test-wallet.json');
    process.exit(1);
  }
  
  const wallet = loadWallet(CONFIG.walletPath);
  console.log(`\n🔑 Wallet: ${wallet.publicKey.toBase58()}`);
  
  const runner = new TestRunner(wallet);
  
  if (checkOnly) {
    const ready = await runner.checkSetup();
    process.exit(ready ? 0 : 1);
  }
  
  await runner.run();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
