import "server-only";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";
import { RATE_LIMIT_PER_HOUR as DEFAULT_RATE_LIMIT } from "@/lib/limits";

/** New (uncached) scorings allowed per IP per hour. RATE_LIMIT_PER_HOUR env overrides the default; 0 disables the limit. */
export const RATE_LIMIT_PER_HOUR = (() => {
  const raw = process.env.RATE_LIMIT_PER_HOUR?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_RATE_LIMIT;
})();

/**
 * Upstash Redis when configured (works across Vercel instances); otherwise an in-memory
 * fallback that only holds within one warm instance (fine for local dev, documented limitation).
 */
const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN ? Redis.fromEnv() : null;

const ratelimit = redis && RATE_LIMIT_PER_HOUR > 0
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(RATE_LIMIT_PER_HOUR, "1 h"), prefix: "em:rl" })
  : null;

const memHits = new Map<string, number[]>();
const memCache = new Map<string, unknown>();

export async function allowScoring(ip: string): Promise<boolean> {
  if (RATE_LIMIT_PER_HOUR === 0) return true;
  if (ratelimit) return (await ratelimit.limit(ip)).success;
  const now = Date.now();
  const hits = (memHits.get(ip) ?? []).filter((t) => now - t < 3600_000);
  if (hits.length >= RATE_LIMIT_PER_HOUR) return false;
  hits.push(now);
  memHits.set(ip, hits);
  return true;
}

/** Cache of extracted fields keyed by a hash of the resume text. The text itself is never stored. */
export async function cacheGet<T>(key: string): Promise<T | null> {
  if (redis) return (await redis.get<T>(`em:x:${key}`)) ?? null;
  return (memCache.get(key) as T) ?? null;
}

export async function cacheSet(key: string, value: unknown): Promise<void> {
  if (redis) await redis.set(`em:x:${key}`, value, { ex: 60 * 60 * 24 * 30 });
  else memCache.set(key, value);
}
