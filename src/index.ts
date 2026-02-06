import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { config } from './config.js';
import { logger } from './logger.js';
import { connectDb, disconnectDb } from './db/client.js';
import routes from './api/routes.js';

const app = express();

// Middleware
app.use(helmet());
app.use(express.json());
app.use(pinoHttp({ 
  logger,
  autoLogging: true,
}));

// API Routes
app.use('/v1', routes);

// Root endpoint
app.get('/', (_req, res) => {
  res.json({
    name: 'Agent Curated Registry (ACR)',
    version: '1.0.0',
    description: 'Trust infrastructure for autonomous agents',
    docs: '/v1/health',
    endpoints: {
      health: 'GET /v1/health',
      registries: 'GET /v1/registries',
      trust_query: 'POST /v1/trust/query (paid)',
      trust_entity: 'GET /v1/trust/entity/:address (paid)',
      trust_top: 'GET /v1/trust/top (paid)',
    },
  });
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'not_found', message: 'Endpoint not found' });
});

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, 'Unhandled error');
  res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
});

// Startup
async function start() {
  try {
    await connectDb();
    
    app.listen(config.port, config.host, () => {
      logger.info({ port: config.port, host: config.host }, 'ACR server started');
      console.log(`\n🔗 ACR running at http://${config.host}:${config.port}`);
      console.log(`   Health: http://localhost:${config.port}/v1/health`);
      console.log(`   Registries: http://localhost:${config.port}/v1/registries\n`);
    });
  } catch (err) {
    logger.fatal({ err }, 'Failed to start server');
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Shutting down...');
  await disconnectDb();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Shutting down...');
  await disconnectDb();
  process.exit(0);
});

start();
