#!/usr/bin/env tsx
/**
 * System Health Monitor
 *
 * Queries system logs and displays key metrics:
 * - Average API response time
 * - Error rates by category
 * - Most common errors
 * - Active users (last 24h)
 * - AI generation performance
 *
 * Usage: npx tsx scripts/monitor.ts [--hours=24]
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface MetricSummary {
  totalMessages: number;
  totalErrors: number;
  errorRate: number;
  avgAIResponseTime: number;
  slowestAIResponse: number;
  activeUsers: number;
  errorsByCategory: Record<string, number>;
  topErrors: Array<{ message: string; count: number }>;
}

async function getSystemMetrics(hoursBack: number = 24): Promise<MetricSummary> {
  const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

  // Get all logs since the cutoff
  const logs = await prisma.systemLog.findMany({
    where: {
      createdAt: { gte: since },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Parse metrics from logs
  const aiLogs = logs.filter(l => l.category === 'ai' && l.message.includes('generated'));
  const errors = logs.filter(l => l.level === 'error');

  let totalAITime = 0;
  let maxAITime = 0;
  const aiTimings: number[] = [];

  for (const log of aiLogs) {
    try {
      const metadata = JSON.parse(log.metadata || '{}');
      if (metadata.totalMs) {
        aiTimings.push(metadata.totalMs);
        totalAITime += metadata.totalMs;
        maxAITime = Math.max(maxAITime, metadata.totalMs);
      }
    } catch {
      // Skip invalid JSON
    }
  }

  // Count errors by category
  const errorsByCategory: Record<string, number> = {};
  for (const error of errors) {
    errorsByCategory[error.category] = (errorsByCategory[error.category] || 0) + 1;
  }

  // Find top errors
  const errorCounts: Record<string, number> = {};
  for (const error of errors) {
    const msg = error.message.substring(0, 100); // First 100 chars
    errorCounts[msg] = (errorCounts[msg] || 0) + 1;
  }

  const topErrors = Object.entries(errorCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([message, count]) => ({ message, count }));

  // Count active users (socios with messages in the period)
  const activeSocios = await prisma.socio.count({
    where: {
      messages: {
        some: {
          createdAt: { gte: since },
        },
      },
    },
  });

  return {
    totalMessages: aiLogs.length,
    totalErrors: errors.length,
    errorRate: aiLogs.length > 0 ? (errors.length / aiLogs.length) * 100 : 0,
    avgAIResponseTime: aiTimings.length > 0 ? totalAITime / aiTimings.length : 0,
    slowestAIResponse: maxAITime,
    activeUsers: activeSocios,
    errorsByCategory,
    topErrors,
  };
}

async function displayMetrics(hours: number) {
  console.log(`\n📊 System Health Monitor (last ${hours} hours)\n`);
  console.log('━'.repeat(60));

  const metrics = await getSystemMetrics(hours);

  console.log('\n🎯 Overview:');
  console.log(`  Active Users: ${metrics.activeUsers}`);
  console.log(`  Total Messages: ${metrics.totalMessages}`);
  console.log(`  Total Errors: ${metrics.totalErrors}`);
  console.log(`  Error Rate: ${metrics.errorRate.toFixed(2)}%`);

  console.log('\n⚡ AI Performance:');
  console.log(`  Avg Response Time: ${Math.round(metrics.avgAIResponseTime)}ms`);
  console.log(`  Slowest Response: ${Math.round(metrics.slowestAIResponse)}ms`);

  if (metrics.avgAIResponseTime > 5000) {
    console.log('  ⚠️  Warning: Average response time > 5s');
  }

  console.log('\n🚨 Errors by Category:');
  for (const [category, count] of Object.entries(metrics.errorsByCategory)) {
    console.log(`  ${category}: ${count}`);
  }

  if (metrics.topErrors.length > 0) {
    console.log('\n🔝 Top 5 Errors:');
    for (const { message, count } of metrics.topErrors) {
      console.log(`  [${count}x] ${message}`);
    }
  }

  console.log('\n' + '━'.repeat(60) + '\n');
}

async function main() {
  const args = process.argv.slice(2);
  const hoursArg = args.find(arg => arg.startsWith('--hours='));
  const hours = hoursArg ? parseInt(hoursArg.split('=')[1]) : 24;

  try {
    await displayMetrics(hours);
  } catch (error) {
    console.error('Error fetching metrics:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
