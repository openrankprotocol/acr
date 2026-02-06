import { Router, Request, Response } from 'express';
import { prisma } from '../db/client.js';
import { logger } from '../logger.js';
import { 
  trustQueryPayment, 
  trustEntityPayment, 
  trustTopPayment 
} from '../payments/x402.js';
import {
  trustQuerySchema,
  trustEntityParamsSchema,
  trustEntityQuerySchema,
  trustTopQuerySchema,
  HealthResponse,
  RegistryListResponse,
} from './schemas.js';
import { queryTrust, queryEntityTrust, queryTopEntities } from './trust.js';

const router = Router();

// GET /v1/health - Public health check
router.get('/health', async (_req: Request, res: Response) => {
  let dbStatus: 'connected' | 'disconnected' = 'disconnected';
  
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbStatus = 'connected';
  } catch (err) {
    logger.error({ err }, 'Database health check failed');
  }

  const response: HealthResponse = {
    status: dbStatus === 'connected' ? 'ok' : 'degraded',
    version: '1.0.0',
    database: dbStatus,
    timestamp: new Date().toISOString(),
  };

  res.json(response);
});

// GET /v1/registries - Public registry list
router.get('/registries', async (_req: Request, res: Response) => {
  try {
    const registries = await prisma.registry.findMany({
      include: {
        _count: {
          select: { entries: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    const response: RegistryListResponse = {
      registries: registries.map((r) => ({
        slug: r.slug,
        name: r.name,
        description: r.description,
        context: r.context,
        last_ingested_at: r.lastIngestedAt.toISOString(),
        entry_count: r._count.entries,
      })),
    };

    res.json(response);
  } catch (err) {
    logger.error({ err }, 'Failed to list registries');
    res.status(500).json({ error: 'internal_error', message: 'Failed to list registries' });
  }
});

// POST /v1/trust/query - Paid trust query
router.post('/trust/query', trustQueryPayment(), async (req: Request, res: Response) => {
  try {
    const parsed = trustQuerySchema.safeParse(req.body);
    
    if (!parsed.success) {
      res.status(400).json({ 
        error: 'invalid_request', 
        message: 'Invalid request body',
        details: parsed.error.issues,
      });
      return;
    }

    const { entity, context } = parsed.data;
    
    const result = await queryTrust({
      entityType: entity.type,
      identifier: entity.identifier,
      context,
    });

    if (!result) {
      res.status(404).json({ 
        error: 'not_found', 
        message: 'Entity not found in any registry' 
      });
      return;
    }

    res.json(result);
  } catch (err) {
    logger.error({ err }, 'Trust query failed');
    res.status(500).json({ error: 'internal_error', message: 'Trust query failed' });
  }
});

// GET /v1/trust/entity/:address - Paid entity lookup
router.get('/trust/entity/:address', trustEntityPayment(), async (req: Request, res: Response) => {
  try {
    const paramsResult = trustEntityParamsSchema.safeParse(req.params);
    const queryResult = trustEntityQuerySchema.safeParse(req.query);
    
    if (!paramsResult.success || !queryResult.success) {
      res.status(400).json({ 
        error: 'invalid_request', 
        message: 'Invalid parameters' 
      });
      return;
    }

    const { address } = paramsResult.data;
    const { context } = queryResult.data;

    const results = await queryEntityTrust({ address, context });

    if (results.length === 0) {
      res.status(404).json({ 
        error: 'not_found', 
        message: 'Entity not found in any registry' 
      });
      return;
    }

    res.json({ results });
  } catch (err) {
    logger.error({ err }, 'Entity trust query failed');
    res.status(500).json({ error: 'internal_error', message: 'Entity trust query failed' });
  }
});

// GET /v1/trust/top - Paid top entities query
router.get('/trust/top', trustTopPayment(), async (req: Request, res: Response) => {
  try {
    const parsed = trustTopQuerySchema.safeParse(req.query);
    
    if (!parsed.success) {
      res.status(400).json({ 
        error: 'invalid_request', 
        message: 'Invalid query parameters',
        details: parsed.error.issues,
      });
      return;
    }

    const { context, limit, registry_slugs } = parsed.data;
    const slugs = registry_slugs?.split(',').filter(Boolean);

    const results = await queryTopEntities({
      context,
      limit,
      registrySlugs: slugs,
    });

    res.json({ 
      context,
      limit,
      count: results.length,
      entities: results,
    });
  } catch (err) {
    logger.error({ err }, 'Top entities query failed');
    res.status(500).json({ error: 'internal_error', message: 'Top entities query failed' });
  }
});

export default router;
