/**
 * ACR Demo Agent - Copy Trading Policy Agent
 * 
 * This script demonstrates how an autonomous agent would use the ACR API
 * to make trust-gated decisions about which wallets to copy-trade.
 */

const ACR_BASE_URL = process.env.ACR_BASE_URL || 'http://localhost:3000';
const PAYMENT_TOKEN = process.env.PAYMENT_TOKEN || 'demo-payment-proof';

interface TrustQueryResponse {
  entity_id: string;
  context: string;
  score: number;
  decision_hint: 'allow' | 'allow_with_limit' | 'review' | 'deny';
  provenance: Array<{
    registry: string;
    record_id: string;
    computed_at: string;
  }>;
  generated_at: string;
}

interface TopEntityResponse {
  entity_id: string;
  display_name: string | null;
  context: string;
  score: number;
  decision_hint: string;
  registry: string;
  computed_at: string;
}

// Sample candidate wallets to evaluate for copy-trading
const SAMPLE_WALLETS = [
  '25YYDyKNX6inGvSs6Kxg6ZfvrjxhTPXYKeebvjti4jqS', // Top DEX trader
  'AgLyDZd7JRRVj9cYJw5SQccs9JsQsFETkLkDUChy55va', // Another trader
  '6k6QfdL1fKuZGTpUTdHA9LTgAoe1UsfxxibVD9osR3Co', // Known rugger
  'RANDOM_WALLET_NOT_IN_REGISTRY_12345678901234567', // Unknown wallet
  '8deJ9xeUvXSJwicYptA9mHsU2rN2pDx37KWzkDkEXhU6', // KOL wallet
];

async function makeRequest(url: string, options: RequestInit = {}): Promise<Response> {
  const headers = {
    'Content-Type': 'application/json',
    'X-Payment-Proof': PAYMENT_TOKEN,
    ...options.headers,
  };
  
  const response = await fetch(url, { ...options, headers });
  
  // Handle 402 Payment Required
  if (response.status === 402) {
    const paymentInfo = await response.json();
    console.log('  💰 Payment required:', paymentInfo);
    console.log('  🔄 Retrying with payment proof...');
    
    // In a real agent, you would execute the payment here
    // For demo, we use the mock payment proof
    return fetch(url, { ...options, headers });
  }
  
  return response;
}

async function checkHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${ACR_BASE_URL}/v1/health`);
    const data = await response.json();
    return data.status === 'ok';
  } catch {
    return false;
  }
}

async function queryTrust(wallet: string, context: string): Promise<TrustQueryResponse | null> {
  const response = await makeRequest(`${ACR_BASE_URL}/v1/trust/query`, {
    method: 'POST',
    body: JSON.stringify({
      entity: { type: 'wallet', identifier: wallet },
      context,
    }),
  });
  
  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`Trust query failed: ${response.status}`);
  }
  
  return response.json();
}

async function getTopTraders(limit: number = 10): Promise<TopEntityResponse[]> {
  const response = await makeRequest(
    `${ACR_BASE_URL}/v1/trust/top?context=copy_trading&limit=${limit}`
  );
  
  if (!response.ok) {
    throw new Error(`Top traders query failed: ${response.status}`);
  }
  
  const data = await response.json();
  return data.entities;
}

// Copy-trading decision policy
interface CopyDecision {
  wallet: string;
  action: 'copy' | 'copy_with_limit' | 'skip' | 'manual_review';
  maxAllocation?: number; // percentage of portfolio
  reason: string;
  trustData?: TrustQueryResponse;
}

function makeCopyDecision(wallet: string, trustData: TrustQueryResponse | null): CopyDecision {
  if (!trustData || trustData.provenance.length === 0) {
    return {
      wallet,
      action: 'manual_review',
      reason: 'No trust data available - unknown wallet',
    };
  }

  // Apply policy based on decision hint
  switch (trustData.decision_hint) {
    case 'allow':
      return {
        wallet,
        action: 'copy',
        maxAllocation: 5, // Max 5% of portfolio
        reason: `High trust score (${trustData.score.toFixed(4)}) from ${trustData.provenance.length} registries`,
        trustData,
      };
    
    case 'allow_with_limit':
      return {
        wallet,
        action: 'copy_with_limit',
        maxAllocation: 2, // Max 2% of portfolio
        reason: `Moderate trust score (${trustData.score.toFixed(4)}) - limiting exposure`,
        trustData,
      };
    
    case 'review':
      return {
        wallet,
        action: 'manual_review',
        reason: `Low trust score (${trustData.score.toFixed(4)}) - requires human review`,
        trustData,
      };
    
    case 'deny':
      return {
        wallet,
        action: 'skip',
        reason: `Trust score too low (${trustData.score.toFixed(4)}) or flagged in rugger registry`,
        trustData,
      };
  }
}

async function runDemoAgent() {
  console.log('🤖 ACR Demo Agent - Copy Trading Policy');
  console.log('========================================\n');
  console.log(`🔗 ACR API: ${ACR_BASE_URL}\n`);

  // Step 1: Check API health
  console.log('1️⃣  Checking ACR API health...');
  const healthy = await checkHealth();
  if (!healthy) {
    console.log('   ❌ ACR API is not healthy. Make sure the server is running.');
    process.exit(1);
  }
  console.log('   ✅ ACR API is healthy\n');

  // Step 2: Discover top traders
  console.log('2️⃣  Discovering top traders for copy-trading...');
  try {
    const topTraders = await getTopTraders(5);
    console.log(`   Found ${topTraders.length} top traders:\n`);
    
    for (const trader of topTraders) {
      const name = trader.display_name || 'Anonymous';
      console.log(`   📊 ${trader.entity_id}`);
      console.log(`      Name: ${name}`);
      console.log(`      Score: ${trader.score.toFixed(4)}`);
      console.log(`      Registry: ${trader.registry}`);
      console.log('');
    }
  } catch (err) {
    console.log(`   ⚠️  Could not fetch top traders: ${err}`);
  }

  // Step 3: Evaluate sample wallets
  console.log('3️⃣  Evaluating candidate wallets for copy-trading...\n');
  
  const decisions: CopyDecision[] = [];
  
  for (const wallet of SAMPLE_WALLETS) {
    console.log(`   🔍 Checking: ${wallet.substring(0, 20)}...`);
    
    // Query trust data
    const trustData = await queryTrust(wallet, 'copy_trading');
    
    // Also check rugger registry
    const ruggerData = await queryTrust(wallet, 'rugger_check');
    
    // If wallet is flagged as a rugger, override to deny
    let finalTrustData = trustData;
    if (ruggerData && ruggerData.provenance.length > 0 && ruggerData.score > 0) {
      console.log(`      ⚠️  Found in rugger registry (score: ${ruggerData.score.toFixed(4)})`);
      finalTrustData = {
        ...trustData!,
        score: 0,
        decision_hint: 'deny',
        provenance: [...(trustData?.provenance || []), ...ruggerData.provenance],
      };
    }
    
    // Make decision
    const decision = makeCopyDecision(wallet, finalTrustData);
    decisions.push(decision);
    
    // Print decision
    const actionEmoji = {
      copy: '✅',
      copy_with_limit: '⚡',
      skip: '❌',
      manual_review: '👀',
    }[decision.action];
    
    console.log(`      ${actionEmoji} Decision: ${decision.action.toUpperCase()}`);
    console.log(`      📝 Reason: ${decision.reason}`);
    if (decision.maxAllocation) {
      console.log(`      💰 Max allocation: ${decision.maxAllocation}%`);
    }
    console.log('');
  }

  // Step 4: Summary
  console.log('4️⃣  Decision Summary');
  console.log('=====================\n');
  
  const summary = {
    copy: decisions.filter(d => d.action === 'copy').length,
    copy_with_limit: decisions.filter(d => d.action === 'copy_with_limit').length,
    skip: decisions.filter(d => d.action === 'skip').length,
    manual_review: decisions.filter(d => d.action === 'manual_review').length,
  };
  
  console.log(`   ✅ Copy: ${summary.copy}`);
  console.log(`   ⚡ Copy with limit: ${summary.copy_with_limit}`);
  console.log(`   ❌ Skip: ${summary.skip}`);
  console.log(`   👀 Manual review: ${summary.manual_review}`);
  
  console.log('\n🏁 Demo complete!');
  console.log('\nThis demonstrates how an autonomous agent can use ACR to:');
  console.log('  1. Discover trusted entities via /trust/top');
  console.log('  2. Query trust scores with context via /trust/query');
  console.log('  3. Cross-reference multiple registries (e.g., rugger check)');
  console.log('  4. Apply policy rules to make automated decisions');
  console.log('  5. Handle the x402 payment flow for API access');
}

runDemoAgent().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
