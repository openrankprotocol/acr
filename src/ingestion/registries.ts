// Registry configuration - maps source files to registry metadata
// Each CSV represents a single registry with a single context

export interface RegistryConfig {
  slug: string;
  name: string;
  description: string;
  context: string;
  sourceFile: string;
  entityType: string;
  // CSV column mappings (handle variations)
  identifierColumn: string; // 'identifier' or 'address'
  scoreColumn: string;      // 'score' or 'scores'
}

export const registryConfigs: RegistryConfig[] = [
  {
    slug: 'top_dex_traders',
    name: 'Top Solana DEX Traders',
    description: 'Top traders by DEX trading volume and profitability on Solana',
    context: 'copy_trading',
    sourceFile: 'Top_Solana_Dex_Trader_Wallets.csv',
    entityType: 'wallet',
    identifierColumn: 'identifier',
    scoreColumn: 'scores',
  },
  {
    slug: 'top_pumpfun_traders',
    name: 'Top Pump.fun Traders',
    description: 'Top traders on Pump.fun memecoin platform',
    context: 'copy_trading',
    sourceFile: 'Top_Pump_Fun_Wallet.csv',
    entityType: 'wallet',
    identifierColumn: 'identifier',
    scoreColumn: 'scores',
  },
  {
    slug: 'top_whales',
    name: 'Solana Whales',
    description: 'Large holders and significant wallet addresses on Solana',
    context: 'copy_trading',
    sourceFile: 'Top_Solana_Whales_Wallets.csv',
    entityType: 'wallet',
    identifierColumn: 'identifier',
    scoreColumn: 'scores',
  },
  {
    slug: 'bot_traders',
    name: 'Solana Bot Traders',
    description: 'Known bot trading wallets - useful for filtering or analyzing bot activity',
    context: 'bot_detection',
    sourceFile: 'Top_Solana_Bot_Traders_Wallets.csv',
    entityType: 'wallet',
    identifierColumn: 'identifier',
    scoreColumn: 'scores',
  },
  {
    slug: 'dev_ruggers',
    name: 'Top Dev Ruggers',
    description: 'Developer wallets associated with rug pulls and suspicious token launches',
    context: 'rugger_check',
    sourceFile: 'Top_Dev_Wallets.csv',
    entityType: 'wallet',
    identifierColumn: 'address',
    scoreColumn: 'score',
  },
  {
    slug: 'farcaster_users',
    name: 'Solana x Farcaster Users',
    description: 'Solana wallets linked to Farcaster social identities',
    context: 'social_verification',
    sourceFile: 'Top_Solana_Farcasters_Wallets.csv',
    entityType: 'wallet',
    identifierColumn: 'identifier',
    scoreColumn: 'scores',
  },
  {
    slug: 'top_kols',
    name: 'Solana KOLs',
    description: 'Key Opinion Leaders in the Solana ecosystem with verified wallets',
    context: 'social_verification',
    sourceFile: 'Top_Solana_KOL_Wallets.csv',
    entityType: 'wallet',
    identifierColumn: 'identifier',
    scoreColumn: 'score',
  },
  {
    slug: 'top_tokens',
    name: 'Top Solana Tokens (Bankr)',
    description: 'Top tokens by market cap tracked by Bankr',
    context: 'token_analysis',
    sourceFile: 'Top_Bankr_Solana_Tokens.csv',
    entityType: 'token',
    identifierColumn: 'identifier',
    scoreColumn: 'score',
  },
  {
    slug: 'trending_tokens',
    name: 'Top Traded Tokens (24h)',
    description: 'Most traded tokens in the last 24 hours',
    context: 'token_analysis',
    sourceFile: 'Top_Traded_24hrs_Tokens.csv',
    entityType: 'token',
    identifierColumn: 'identifier',
    scoreColumn: 'score',
  },
];

// Get available contexts
export function getContexts(): string[] {
  const contexts = new Set(registryConfigs.map((r) => r.context));
  return Array.from(contexts);
}

// Get registries by context
export function getRegistriesByContext(context: string): RegistryConfig[] {
  return registryConfigs.filter((r) => r.context === context);
}
