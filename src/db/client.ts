import { PrismaClient } from '@prisma/client';
import { logger } from '../logger.js';

export const prisma = new PrismaClient({
  log: [
    { emit: 'event', level: 'query' },
    { emit: 'event', level: 'error' },
    { emit: 'event', level: 'warn' },
  ],
});

prisma.$on('error', (e) => {
  logger.error({ err: e }, 'Prisma error');
});

prisma.$on('warn', (e) => {
  logger.warn({ warn: e }, 'Prisma warning');
});

export async function connectDb(): Promise<void> {
  await prisma.$connect();
  logger.info('Database connected');
}

export async function disconnectDb(): Promise<void> {
  await prisma.$disconnect();
  logger.info('Database disconnected');
}
