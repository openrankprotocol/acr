import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const configSchema = z.object({
  port: z.coerce.number().default(3000),
  host: z.string().default('0.0.0.0'),
  
  // Payment config
  paymentsMode: z.enum(['mock', 'live']).default('mock'),
  priceTrustQueryUsd: z.coerce.number().default(0.02),
  priceTrustEntityUsd: z.coerce.number().default(0.01),
  priceTrustTopUsd: z.coerce.number().default(0.05),
  
  // PayAI
  payaiFacilitatorUrl: z.string().default('https://facilitator.payai.network'),
  payaiMerchantAddress: z.string().default(''), // Solana address to receive payments
  payaiNetwork: z.string().default('solana-devnet'), // solana | solana-devnet
  
  // Logging
  logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
});

export const config = configSchema.parse({
  port: process.env.PORT,
  host: process.env.HOST,
  paymentsMode: process.env.PAYMENTS_MODE,
  priceTrustQueryUsd: process.env.PRICE_TRUST_QUERY_USD,
  priceTrustEntityUsd: process.env.PRICE_TRUST_ENTITY_USD,
  priceTrustTopUsd: process.env.PRICE_TRUST_TOP_USD,
  payaiFacilitatorUrl: process.env.PAYAI_FACILITATOR_URL,
  payaiMerchantAddress: process.env.PAYAI_MERCHANT_ADDRESS,
  payaiNetwork: process.env.PAYAI_NETWORK,
  logLevel: process.env.LOG_LEVEL,
});

export type Config = typeof config;
