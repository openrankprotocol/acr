import { prisma } from '../db/client.js';
import { TrustQueryResponse } from './schemas.js';

// Determine decision hint based on score and context
function getDecisionHint(score: number, context: string): 'allow' | 'allow_with_limit' | 'review' | 'deny' {
  // Context-specific thresholds
  const thresholds: Record<string, { allow: number; limit: number; review: number }> = {
    copy_trading: { allow: 0.7, limit: 0.4, review: 0.2 },
    token_analysis: { allow: 0.6, limit: 0.3, review: 0.1 },
    kyc: { allow: 0.8, limit: 0.5, review: 0.3 },
    rugger_check: { allow: 0.0, limit: 0.0, review: 0.3 }, // inverted - high score = bad
    default: { allow: 0.6, limit: 0.3, review: 0.1 },
  };

  const t = thresholds[context] || thresholds.default;

  // Special handling for rugger_check - high scores mean more rug activity
  if (context === 'rugger_check') {
    if (score >= t.review) return 'deny';
    if (score > 0) return 'review';
    return 'allow';
  }

  if (score >= t.allow) return 'allow';
  if (score >= t.limit) return 'allow_with_limit';
  if (score >= t.review) return 'review';
  return 'deny';
}

export interface TrustQueryParams {
  entityType: string;
  identifier: string;
  context: string;
}

export async function queryTrust(params: TrustQueryParams): Promise<TrustQueryResponse | null> {
  const { entityType, identifier, context } = params;

  // Find entity
  const entity = await prisma.entity.findFirst({
    where: {
      entityType,
      address: identifier,
      chain: 'solana',
    },
    include: {
      registryEntries: {
        include: {
          registry: true,
        },
        where: {
          registry: {
            context,
          },
        },
      },
    },
  });

  if (!entity || entity.registryEntries.length === 0) {
    // Entity not found or no entries for this context
    // Return a "no data" response with neutral score
    return {
      entity_id: `${entityType}:${identifier}`,
      context,
      score: 0,
      decision_hint: 'review',
      provenance: [],
      generated_at: new Date().toISOString(),
    };
  }

  // Aggregate scores from all matching registries
  // Use weighted average based on recency
  let totalScore = 0;
  let totalWeight = 0;
  const provenance: TrustQueryResponse['provenance'] = [];

  for (const entry of entity.registryEntries) {
    const weight = 1; // Could weight by recency or registry importance
    totalScore += entry.score * weight;
    totalWeight += weight;

    provenance.push({
      registry: entry.registry.slug,
      record_id: entry.id,
      computed_at: entry.computedAt.toISOString(),
    });
  }

  const aggregatedScore = totalWeight > 0 ? totalScore / totalWeight : 0;

  return {
    entity_id: `${entityType}:${identifier}`,
    context,
    score: Math.round(aggregatedScore * 10000) / 10000, // 4 decimal places
    decision_hint: getDecisionHint(aggregatedScore, context),
    provenance,
    generated_at: new Date().toISOString(),
  };
}

export interface TrustEntityParams {
  address: string;
  context?: string;
}

export async function queryEntityTrust(params: TrustEntityParams): Promise<TrustQueryResponse[]> {
  const { address, context } = params;

  // Find entity by address (any type)
  const entities = await prisma.entity.findMany({
    where: {
      address,
      chain: 'solana',
    },
    include: {
      registryEntries: {
        include: {
          registry: true,
        },
        where: context ? {
          registry: {
            context,
          },
        } : undefined,
      },
    },
  });

  const results: TrustQueryResponse[] = [];

  for (const entity of entities) {
    // Group entries by context
    const byContext = new Map<string, typeof entity.registryEntries>();
    
    for (const entry of entity.registryEntries) {
      const ctx = entry.registry.context;
      if (!byContext.has(ctx)) {
        byContext.set(ctx, []);
      }
      byContext.get(ctx)!.push(entry);
    }

    for (const [ctx, entries] of byContext) {
      let totalScore = 0;
      const provenance: TrustQueryResponse['provenance'] = [];

      for (const entry of entries) {
        totalScore += entry.score;
        provenance.push({
          registry: entry.registry.slug,
          record_id: entry.id,
          computed_at: entry.computedAt.toISOString(),
        });
      }

      const avgScore = entries.length > 0 ? totalScore / entries.length : 0;

      results.push({
        entity_id: `${entity.entityType}:${entity.address}`,
        context: ctx,
        score: Math.round(avgScore * 10000) / 10000,
        decision_hint: getDecisionHint(avgScore, ctx),
        provenance,
        generated_at: new Date().toISOString(),
      });
    }
  }

  return results;
}

export interface TrustTopParams {
  context: string;
  limit: number;
  registrySlugs?: string[];
}

export async function queryTopEntities(params: TrustTopParams) {
  const { context, limit, registrySlugs } = params;

  const entries = await prisma.registryEntry.findMany({
    where: {
      registry: {
        context,
        ...(registrySlugs && registrySlugs.length > 0 ? { slug: { in: registrySlugs } } : {}),
      },
    },
    include: {
      entity: true,
      registry: true,
    },
    orderBy: {
      score: 'desc',
    },
    take: limit,
  });

  return entries.map((entry) => ({
    entity_id: `${entry.entity.entityType}:${entry.entity.address}`,
    display_name: entry.entity.displayName,
    context,
    score: Math.round(entry.score * 10000) / 10000,
    decision_hint: getDecisionHint(entry.score, context),
    registry: entry.registry.slug,
    computed_at: entry.computedAt.toISOString(),
  }));
}
