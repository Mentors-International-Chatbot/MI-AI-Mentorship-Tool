import { prisma } from '@/lib/db';

export type LogLevel = 'info' | 'warn' | 'error';
export type LogCategory = 'ai' | 'webhook' | 'auth' | 'cron' | 'system';

export async function logEvent(
  level: LogLevel,
  category: LogCategory,
  message: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  const logFn =
    level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  logFn(`[${category.toUpperCase()}] ${message}`, metadata ?? '');

  try {
    await prisma.systemLog.create({
      data: {
        level,
        category,
        message,
        metadata: metadata ? JSON.stringify(metadata) : null,
      },
    });
  } catch {
    // Don't let logging failures break callers
  }
}
