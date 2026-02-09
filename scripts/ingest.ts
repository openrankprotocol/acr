/**
 * ACR Ingestion Script
 * Reads CSV files from data/registries/ and populates the database
 */

import { createReadStream, existsSync } from 'fs';
import { parse } from 'csv-parse';
import { PrismaClient } from '@prisma/client';
import { registryConfigs, RegistryConfig } from '../src/ingestion/registries.js';

const prisma = new PrismaClient();

// Path to registry data
const DATA_DIR = process.env.REGISTRY_DATA_DIR || '/home/ubuntu/data/Agent Curated Registries';

interface CsvRow {
  [key: string]: string;
}

async function parseCSV(filePath: string): Promise<CsvRow[]> {
  return new Promise((resolve, reject) => {
    const rows: CsvRow[] = [];
    
    createReadStream(filePath)
      .pipe(parse({ 
        columns: true, 
        skip_empty_lines: true,
        trim: true,
      }))
      .on('data', (row) => rows.push(row))
      .on('error', reject)
      .on('end', () => resolve(rows));
  });
}

async function ingestRegistry(config: RegistryConfig): Promise<{ inserted: number; updated: number }> {
  const filePath = `${DATA_DIR}/${config.sourceFile}`;
  
  if (!existsSync(filePath)) {
    console.log(`  ⚠️  File not found: ${config.sourceFile}`);
    return { inserted: 0, updated: 0 };
  }

  console.log(`  📄 Reading ${config.sourceFile}...`);
  const rows = await parseCSV(filePath);
  console.log(`     Found ${rows.length} rows`);

  // Upsert registry
  const registry = await prisma.registry.upsert({
    where: { slug: config.slug },
    create: {
      slug: config.slug,
      name: config.name,
      description: config.description,
      context: config.context,
      sourceFile: config.sourceFile,
      lastIngestedAt: new Date(),
    },
    update: {
      name: config.name,
      description: config.description,
      context: config.context,
      lastIngestedAt: new Date(),
    },
  });

  let inserted = 0;
  let updated = 0;

  // Process rows in batches
  const batchSize = 100;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    
    for (const row of batch) {
      // Get identifier (handle column name variations)
      const identifier = row[config.identifierColumn]?.trim();
      if (!identifier) continue;

      // Get score (handle column name variations, use defaultScore if not present)
      const scoreStr = row[config.scoreColumn]?.trim();
      const score = scoreStr ? (parseFloat(scoreStr) || config.defaultScore || 0) : (config.defaultScore || 0);

      // Get display name if available
      const displayName = row.display_name?.trim() || null;

      // Get computed_at if available
      const computedAtStr = row.computed_at?.trim();
      const computedAt = computedAtStr ? new Date(computedAtStr) : new Date();

      // Build attributes JSON for extra columns
      const knownColumns = ['entity_type', config.identifierColumn, config.scoreColumn, 'display_name', 'computed_at'];
      const attributes: Record<string, string> = {};
      for (const [key, value] of Object.entries(row)) {
        if (!knownColumns.includes(key) && value) {
          attributes[key] = value;
        }
      }

      try {
        // Upsert entity
        const entity = await prisma.entity.upsert({
          where: {
            chain_entityType_address: {
              chain: 'solana',
              entityType: config.entityType,
              address: identifier,
            },
          },
          create: {
            chain: 'solana',
            entityType: config.entityType,
            address: identifier,
            displayName,
          },
          update: {
            displayName: displayName || undefined,
          },
        });

        // Upsert registry entry
        const existing = await prisma.registryEntry.findUnique({
          where: {
            registryId_entityId: {
              registryId: registry.id,
              entityId: entity.id,
            },
          },
        });

        if (existing) {
          await prisma.registryEntry.update({
            where: { id: existing.id },
            data: {
              score,
              attributesJson: Object.keys(attributes).length > 0 ? JSON.stringify(attributes) : null,
              computedAt,
            },
          });
          updated++;
        } else {
          await prisma.registryEntry.create({
            data: {
              registryId: registry.id,
              entityId: entity.id,
              score,
              attributesJson: Object.keys(attributes).length > 0 ? JSON.stringify(attributes) : null,
              computedAt,
            },
          });
          inserted++;
        }
      } catch (err) {
        console.error(`     Error processing row: ${identifier}`, err);
      }
    }

    // Progress indicator
    if (i % 500 === 0 && i > 0) {
      console.log(`     Processed ${i}/${rows.length} rows...`);
    }
  }

  return { inserted, updated };
}

async function main() {
  console.log('🔗 ACR Ingestion Script');
  console.log('========================\n');
  console.log(`📁 Data directory: ${DATA_DIR}\n`);

  let totalInserted = 0;
  let totalUpdated = 0;

  for (const config of registryConfigs) {
    console.log(`\n📋 Processing: ${config.name}`);
    console.log(`   Context: ${config.context}`);
    
    const { inserted, updated } = await ingestRegistry(config);
    totalInserted += inserted;
    totalUpdated += updated;
    
    console.log(`   ✅ Inserted: ${inserted}, Updated: ${updated}`);
  }

  console.log('\n========================');
  console.log(`📊 Total: ${totalInserted} inserted, ${totalUpdated} updated`);

  // Print summary stats
  const registryCount = await prisma.registry.count();
  const entityCount = await prisma.entity.count();
  const entryCount = await prisma.registryEntry.count();

  console.log(`\n📈 Database Stats:`);
  console.log(`   Registries: ${registryCount}`);
  console.log(`   Entities: ${entityCount}`);
  console.log(`   Registry Entries: ${entryCount}`);

  await prisma.$disconnect();
  console.log('\n✅ Ingestion complete!');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
