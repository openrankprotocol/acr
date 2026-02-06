import { z } from 'zod';

// Trust query request schema
export const trustQuerySchema = z.object({
  entity: z.object({
    type: z.enum(['wallet', 'token', 'dev', 'kol']),
    identifier: z.string().min(1),
  }),
  context: z.string().min(1),
});

export type TrustQueryRequest = z.infer<typeof trustQuerySchema>;

// Trust query response
export interface TrustQueryResponse {
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

// Trust entity query params
export const trustEntityParamsSchema = z.object({
  address: z.string().min(1),
});

export const trustEntityQuerySchema = z.object({
  context: z.string().optional(),
});

// Trust top query params
export const trustTopQuerySchema = z.object({
  context: z.string(),
  limit: z.coerce.number().min(1).max(100).default(50),
  registry_slugs: z.string().optional(), // comma-separated
});

// Registry list response
export interface RegistryListResponse {
  registries: Array<{
    slug: string;
    name: string;
    description: string | null;
    context: string;
    last_ingested_at: string;
    entry_count: number;
  }>;
}

// Health response
export interface HealthResponse {
  status: 'ok' | 'degraded' | 'down';
  version: string;
  database: 'connected' | 'disconnected';
  timestamp: string;
}
