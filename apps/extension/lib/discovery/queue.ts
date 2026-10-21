import { browser } from "wxt/browser";
import { newId, nowIso, type DiscoveredJob } from "@postulia/shared";
import { db } from "~/lib/db";

/** Dominios por portal para rate limiting. */
export const SOURCE_DOMAINS: Record<string, string> = {
  linkedin: "linkedin.com",
  indeed: "indeed.com",
  computrabajo: "computrabajo.com",
  bumeran: "bumeran.com",
  getonbrd: "getonbrd.com",
  torre: "torre.ai",
};

/** Configuración de rate limiting por defecto. */
export interface RateLimitConfig {
  /** Mínimo ms entre requests al mismo dominio. */
  minIntervalMs: number;
  /** Máximo requests concurrentes por dominio. */
  maxConcurrent: number;
  /** Ventana para rate limit global (ms). */
  globalWindowMs: number;
  /** Máximo requests en ventana global. */
  globalMaxRequests: number;
}

export const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  minIntervalMs: 4_000,        // 1 req / 4 seg por dominio
  maxConcurrent: 2,            // máx 2 concurrentes por dominio
  globalWindowMs: 60_000,      // 1 minuto
  globalMaxRequests: 30,       // máx 30 req/min global
};

/** Estado de rate limiting por dominio. */
interface DomainState {
  lastRequestAt: number;
  activeCount: number;
  queue: Array<() => void>;
}

/** Cola de scraping con rate limiting, backoff y dedup. */
export class DiscoveryQueue {
  private domainStates = new Map<string, DomainState>();
  private globalRequests: number[] = []; // timestamps
  private processing = false;
  private config: RateLimitConfig;

  constructor(config: Partial<RateLimitConfig> = {}) {
    this.config = { ...DEFAULT_RATE_LIMIT, ...config };
  }

  /** Añade un trabajo a la cola. */
  enqueue<T>(
    source: string,
    work: () => Promise<T>,
    options: { priority?: number; retries?: number } = {}
  ): Promise<T> {
    const { priority = 0, retries = 3 } = options;
    const domain = SOURCE_DOMAINS[source] ?? source;

    return new Promise((resolve, reject) => {
      const attempt = async (remainingRetries: number): Promise<void> => {
        try {
          const result = await this.executeWithRateLimit(domain, work);
          resolve(result);
        } catch (error) {
          if (remainingRetries > 0 && this.isRetriableError(error)) {
            const delay = this.calculateBackoff(3 - remainingRetries);
            await this.sleep(delay);
            return attempt(remainingRetries - 1);
          }
          reject(error);
        }
      };
      attempt(retries);
    });
  }

  /** Ejecuta trabajo respetando rate limits. */
  private async executeWithRateLimit<T>(domain: string, work: () => Promise<T>): Promise<T> {
    // Esperar slot de dominio
    await this.waitForDomainSlot(domain);

    // Esperar rate limit global
    await this.waitForGlobalSlot();

    // Registrar request
    this.registerRequest(domain);

    try {
      return await work();
    } finally {
      this.releaseDomainSlot(domain);
    }
  }

  private async waitForDomainSlot(domain: string): Promise<void> {
    let state = this.domainStates.get(domain);
    if (!state) {
      state = { lastRequestAt: 0, activeCount: 0, queue: [] };
      this.domainStates.set(domain, state);
    }

    if (state.activeCount < this.config.maxConcurrent) {
      state.activeCount++;
      return;
    }

    // Esperar en cola
    return new Promise<void>((resolve) => {
      state!.queue.push(resolve);
    });
  }

  private releaseDomainSlot(domain: string): void {
    const state = this.domainStates.get(domain);
    if (!state) return;

    state.activeCount--;
    state.lastRequestAt = Date.now();

    if (state.queue.length > 0 && state.activeCount < this.config.maxConcurrent) {
      const next = state.queue.shift()!;
      state.activeCount++;
      next();
    }
  }

  private async waitForGlobalSlot(): Promise<void> {
    const now = Date.now();
    const windowStart = now - this.config.globalWindowMs;

    // Limpiar requests antiguos
    this.globalRequests = this.globalRequests.filter((t) => t > windowStart);

    if (this.globalRequests.length < this.config.globalMaxRequests) {
      this.globalRequests.push(now);
      return;
    }

    // Esperar hasta que salga el request más antiguo de la ventana
    const oldest = this.globalRequests[0];
    if (oldest === undefined) return this.waitForGlobalSlot();
    const waitMs = oldest + this.config.globalWindowMs - now + 50; // pequeño buffer
    if (waitMs > 0) {
      await this.sleep(waitMs);
    }
    return this.waitForGlobalSlot();
  }

  private registerRequest(domain: string): void {
    this.globalRequests.push(Date.now());
  }

  /** Calcula backoff exponencial: 2s, 4s, 8s, 16s, 32s, 60s (max). */
  private calculateBackoff(attempt: number): number {
    const delays = [2_000, 4_000, 8_000, 16_000, 32_000, 60_000];
    return delays[Math.min(attempt, delays.length - 1)] ?? 60_000;
  }

  /** Determina si un error es reintentarable (429, 5xx, network, timeout). */
  private isRetriableError(error: unknown): boolean {
    if (error instanceof Response) {
      return error.status === 429 || error.status >= 500;
    }
    if (error instanceof Error) {
      // Errores de red, timeout, abort
      return (
        error.name === "AbortError" ||
        error.message.includes("network") ||
        error.message.includes("timeout") ||
        error.message.includes("fetch failed")
      );
    }
    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Stats para debugging/monitoring. */
  getStats(): Record<string, { active: number; queued: number; lastRequestAgo: number }> {
    const now = Date.now();
    const stats: Record<string, { active: number; queued: number; lastRequestAgo: number }> = {};
    for (const [domain, state] of this.domainStates) {
      stats[domain] = {
        active: state.activeCount,
        queued: state.queue.length,
        lastRequestAgo: state.lastRequestAt ? now - state.lastRequestAt : -1,
      };
    }
    return stats;
  }
}

/** Instancia singleton para la extensión. */
export const discoveryQueue = new DiscoveryQueue();

/** Genera hash de URL para dedup (reutiliza lógica compartida). */
export async function hashJobUrl(url: string): Promise<string> {
  const { hashUrl } = await import("@postulia/shared");
  return hashUrl(url);
}

/** Verifica si una oferta ya existe en la BD local. */
export async function existsDiscoveredJob(url: string): Promise<boolean> {
  const urlHash = await hashJobUrl(url);
  const existing = await db.jobDiscoveries.where("urlHash").equals(urlHash).first();
  return !!existing;
}

/** Inserta oferta descubierta con dedup automático. */
export async function putDiscoveredJob(job: Omit<DiscoveredJob, "id">): Promise<DiscoveredJob> {
  const existing = await db.jobDiscoveries.where("urlHash").equals(job.urlHash).first();
  if (existing) {
    // Actualizar solo si es más reciente o tiene mayor confianza
    const shouldUpdate =
      job.scrapedAt > existing.scrapedAt ||
      (job.scrapedAt === existing.scrapedAt &&
        confidenceRank(job.confidence) > confidenceRank(existing.confidence));
    if (shouldUpdate) {
      const updated = { ...existing, ...job, id: existing.id };
      await db.jobDiscoveries.put(updated);
      return updated;
    }
    return existing;
  }

  const newJob: DiscoveredJob = {
    ...job,
    id: newId(),
  };
  await db.jobDiscoveries.put(newJob);
  return newJob;
}

function confidenceRank(c: "high" | "medium" | "low"): number {
  return c === "high" ? 3 : c === "medium" ? 2 : 1;
}

/** Limpieza TTL: borra ofertas expiradas y dismisseds antiguas. */
export async function cleanupDiscoveredJobs(): Promise<{ deleted: number }> {
  const now = nowIso();
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();

  const expired = await db.jobDiscoveries.where("expiresAt").below(now).toArray();
  const oldDismissed = await db.jobDiscoveries
    .where("userAction")
    .equals("dismissed")
    .and((job) => job.scrapedAt < sevenDaysAgo)
    .toArray();

  const toDelete = [...new Set([...expired, ...oldDismissed].map((j) => j.id))];
  if (toDelete.length > 0) {
    await db.jobDiscoveries.bulkDelete(toDelete);
  }
  return { deleted: toDelete.length };
}