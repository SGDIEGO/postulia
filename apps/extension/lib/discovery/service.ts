import {
  nowIso,
  addDays,
  type Source,
  type SearchFilters,
  type DiscoveredJob,
  type SearchHistory,
  type SearchAlert,
  type DiscoveryAction,
  type DiscoverySearchResult,
} from "@postulia/shared";
import { db } from "~/lib/db";
import { discoveryQueue, cleanupDiscoveredJobs } from "./queue.js";
import { scrapeLinkedIn } from "./linkedin.js";
import { scrapeSource } from "./scrapers.js";
import type { ScrapedJob, ScraperResult } from "./scrapers.js";
import { newId } from "@postulia/shared";

const MAX_PAGES_PER_SEARCH = 3;
const DEFAULT_EXPIRY_DAYS = 30;

const SOURCE_LABELS: Record<Source, string> = {
  linkedin: "LinkedIn",
  indeed: "Indeed",
  computrabajo: "Computrabajo",
  bumeran: "Bumeran",
  getonbrd: "Get on Board",
  torre: "Torre",
  other: "Otro portal",
};

export interface DiscoverySearchParams {
  query: string;
  filters: SearchFilters;
  source?: Source;
  page?: number;
  pageSize?: number;
}

export interface DiscoveryActionParams {
  jobId: string;
  action: DiscoveryAction;
  reminderDays?: number;
}

/** Servicio principal de descubrimiento de ofertas. */
export class DiscoveryService {
  private static instance: DiscoveryService;
  private runningSearches = new Map<string, AbortController>();

  static getInstance(): DiscoveryService {
    if (!DiscoveryService.instance) {
      DiscoveryService.instance = new DiscoveryService();
    }
    return DiscoveryService.instance;
  }

  /** Ejecuta búsqueda en uno o todos los portales. */
  async search(params: DiscoverySearchParams): Promise<DiscoverySearchResult> {
    const { query, filters, source, page = 1, pageSize = 50 } = params;
    const sources = source ? [source] : this.getEnabledSources(filters);

    if (sources.length === 0) {
      return { jobs: [], total: 0, page, pageSize, hasMore: false };
    }

    const searchId = `${query}-${Date.now()}`;
    const controller = new AbortController();
    this.runningSearches.set(searchId, controller);

    try {
      // Guardar en historial
      await this.saveSearchHistory({
        query,
        source,
        filters,
        executedAt: nowIso(),
        resultCount: 0,
      });

      // Buscar en paralelo: cada portal tiene su propio rate limit y un fallo
      // en uno no debe impedir que los demás devuelvan resultados.
      const settled = await Promise.allSettled(
        sources.map((src) => this.scrapeWithQueue(query, filters, src)),
      );

      const warnings = new Set<string>();
      const allJobs: DiscoveredJob[] = [];
      const seenIds = new Set<string>();

      for (let index = 0; index < settled.length; index++) {
        if (controller.signal.aborted) break;

        const outcome = settled[index];
        const src = sources[index];
        if (!outcome || !src) continue;

        if (outcome.status === "rejected") {
          const message =
            outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
          warnings.add(`${SOURCE_LABELS[src]}: ${message}`);
          console.error("[DiscoveryService] Error scraping", src, outcome.reason);
          continue;
        }

        const { jobs, warnings: sourceWarnings } = outcome.value;
        for (const warning of sourceWarnings) {
          warnings.add(`${SOURCE_LABELS[src]}: ${warning}`);
        }

        for (const job of jobs) {
          const saved = await this.putDiscoveredJob(job, query);
          if (seenIds.has(saved.id)) continue;
          seenIds.add(saved.id);
          allJobs.push(saved);
        }
      }

      await this.updateSearchHistoryResultCount(query, allJobs.length);

      const start = (page - 1) * pageSize;
      const paginated = allJobs.slice(start, start + pageSize);

      return {
        jobs: paginated,
        total: allJobs.length,
        page,
        pageSize,
        hasMore: start + pageSize < allJobs.length,
        ...(warnings.size > 0 ? { warnings: [...warnings] } : {}),
      };
    } finally {
      this.runningSearches.delete(searchId);
    }
  }

  /** Obtiene ofertas ya descubiertas (para listar en UI). */
  async list(params: {
    query?: string;
    source?: Source;
    filters?: SearchFilters;
    page: number;
    pageSize: number;
  }): Promise<DiscoverySearchResult> {
    let collection = db.jobDiscoveries.orderBy("scrapedAt").reverse();

    if (params.query) {
      collection = collection.filter((job) => job.searchQuery.includes(params.query!));
    }
    if (params.source) {
      collection = collection.filter((job) => job.source === params.source);
    }
    if (params.filters?.location) {
      const loc = params.filters.location!.toLowerCase();
      collection = collection.filter((job) => job.location?.toLowerCase().includes(loc) ?? false);
    }
    if (params.filters?.workMode) {
      collection = collection.filter((job) => job.workMode === params.filters!.workMode);
    }
    if (params.filters?.postedWithinDays) {
      const cutoff = new Date(
        Date.now() - params.filters!.postedWithinDays! * 86_400_000,
      ).toISOString();
      collection = collection.filter((job) => (job.postedAt ?? job.scrapedAt) >= cutoff);
    }

    const total = await collection.count();
    const jobs = await collection
      .offset((params.page - 1) * params.pageSize)
      .limit(params.pageSize)
      .toArray();

    return {
      jobs,
      total,
      page: params.page,
      pageSize: params.pageSize,
      hasMore: params.page * params.pageSize < total,
    };
  }

  /** Acción del usuario sobre una oferta descubierta. */
  async performAction(params: DiscoveryActionParams): Promise<void> {
    const job = await db.jobDiscoveries.get(params.jobId);
    if (!job) throw new Error("Oferta no encontrada");

    switch (params.action) {
      case "save": {
        await this.saveJobAsApplication(job);
        await db.jobDiscoveries.update(job.id, { userAction: "saved" });
        break;
      }
      case "dismiss": {
        await db.jobDiscoveries.update(job.id, { userAction: "dismissed" });
        break;
      }
      case "remind_later": {
        const days = params.reminderDays ?? 3;
        const dueAt = addDays(nowIso(), days).toISOString();
        // Los recordatorios se guardan contra una postulación, no contra la
        // oferta descubierta. Creamos (o reutilizamos) la postulación primero.
        const application = await this.saveJobAsApplication(job);
        const { addReminder } = await import("~/lib/repository.js");
        await addReminder(application.id, {
          dueAt,
          message: `Recordar postular a: ${job.jobTitle} en ${job.company}`,
        });
        await db.jobDiscoveries.update(job.id, { userAction: "remind_later", reminderAt: dueAt });
        break;
      }
    }
  }

  /** Obtiene historial de búsquedas. */
  async getHistory(): Promise<SearchHistory[]> {
    return db.searchHistory.orderBy("executedAt").reverse().limit(50).toArray();
  }

  /** Crea alerta de búsqueda. */
  async createAlert(
    alert: Omit<SearchAlert, "id" | "createdAt" | "lastRunAt">,
  ): Promise<SearchAlert> {
    const newAlert: SearchAlert = {
      ...alert,
      id: newId(),
      createdAt: nowIso(),
    };
    await db.searchAlerts.put(newAlert);
    return newAlert;
  }

  /** Lista alertas. */
  async listAlerts(): Promise<SearchAlert[]> {
    return db.searchAlerts.orderBy("createdAt").reverse().toArray();
  }

  /** Activa/desactiva alerta. */
  async toggleAlert(id: string, enabled: boolean): Promise<void> {
    await db.searchAlerts.update(id, { enabled });
  }

  /** Elimina alerta. */
  async deleteAlert(id: string): Promise<void> {
    await db.searchAlerts.delete(id);
  }

  /** Ejecuta todas las alertas habilitadas (se llama desde alarma diaria). */
  async runAlerts(): Promise<{ alertsRun: number; newJobs: number }> {
    const alerts = await db.searchAlerts.filter((alert) => alert.enabled).toArray();
    let newJobsTotal = 0;

    for (const alert of alerts) {
      try {
        const result = await this.search({
          query: alert.query,
          filters: alert.filters,
          source: alert.source,
        });
        newJobsTotal += result.jobs.filter((j) => !j.userAction).length;

        await db.searchAlerts.update(alert.id, { lastRunAt: nowIso() });

        const newJobs = result.jobs.filter((j) => !j.userAction);
        if (newJobs.length > 0) {
          await notifyNewDiscoveredJobsStandalone(alert.query, newJobs.length);
        }
      } catch (error) {
        console.error("[DiscoveryService] Error running alert:", alert.id, error);
      }
    }

    return { alertsRun: alerts.length, newJobs: newJobsTotal };
  }

  /** Limpieza periódica (TTL + dismisseds antiguas). */
  async cleanup(): Promise<{ deleted: number }> {
    return cleanupDiscoveredJobs();
  }

  // --- Métodos privados ---

  private getEnabledSources(_filters: SearchFilters): Source[] {
    const all: Source[] = ["linkedin", "indeed", "computrabajo", "bumeran", "getonbrd", "torre"];
    return all;
  }

  /**
   * Scrapea un portal (hasta MAX_PAGES_PER_SEARCH) respetando la cola.
   * Devuelve ofertas crudas y avisos; la persistencia se hace en `search()`.
   */
  private async scrapeWithQueue(
    query: string,
    filters: SearchFilters,
    source: Source,
  ): Promise<{ jobs: ScrapedJob[]; warnings: string[] }> {
    const allJobs: ScrapedJob[] = [];
    const warnings: string[] = [];
    const seenUrls = new Set<string>();
    const maxPages =
      source === "linkedin" || source === "indeed" || source === "computrabajo"
        ? MAX_PAGES_PER_SEARCH
        : 1;

    for (let page = 0; page < maxPages; page++) {
      let result: ScraperResult;
      try {
        result = await discoveryQueue.enqueue<ScraperResult>(
          source,
          () =>
            source === "linkedin"
              ? scrapeLinkedIn(query, filters, page)
              : scrapeSource(source, query, filters, page),
          // Un timeout de LinkedIn no se arregla reintentando.
          { retries: source === "linkedin" ? 0 : 2 },
        );
      } catch (error) {
        // Si ya tenemos ofertas de páginas anteriores, conservarlas y avisar.
        if (allJobs.length === 0) throw error;
        warnings.push(
          `No se pudo cargar la página ${page + 1}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        break;
      }

      if (!result) break;

      for (const warning of result.warnings ?? []) {
        warnings.push(warning);
      }

      if (!Array.isArray(result.jobs) || result.jobs.length === 0) break;

      for (const job of result.jobs) {
        if (seenUrls.has(job.url)) continue;
        seenUrls.add(job.url);
        allJobs.push(job);
      }

      if (!result.hasMore) break;
    }

    return { jobs: allJobs, warnings };
  }

  /** Crea la postulación asociada a una oferta descubierta (idempotente por URL). */
  private async saveJobAsApplication(job: DiscoveredJob) {
    const { createApplication, findDuplicateByUrl } = await import("~/lib/repository.js");

    const existing = await findDuplicateByUrl(job.url);
    if (existing) return existing;

    return createApplication({
      jobTitle: job.jobTitle,
      company: job.company,
      url: job.url,
      source: job.source,
      location: job.location,
      workMode: job.workMode,
      salary: job.salary,
      currency: job.currency,
      status: "saved",
      appliedAt: null,
      notes: `Descubierta via búsqueda: ${job.searchQuery}`,
      recruiterName: null,
      recruiterContact: null,
      cvVersion: null,
      tags: [],
    });
  }

  private async putDiscoveredJob(job: ScrapedJob, searchQuery: string): Promise<DiscoveredJob> {
    const now = nowIso();
    const expiresAt = addDays(now, DEFAULT_EXPIRY_DAYS).toISOString();
    const { hashJobUrl } = await import("./queue.js");

    const fullJob: Omit<DiscoveredJob, "id"> = {
      ...job,
      searchQuery,
      urlHash: await hashJobUrl(job.url),
      scrapedAt: now,
      expiresAt,
    };

    const { putDiscoveredJob: putJob } = (await import("./queue.js")) as {
      putDiscoveredJob: (job: Omit<DiscoveredJob, "id">) => Promise<DiscoveredJob>;
    };
    return putJob(fullJob);
  }

  private async saveSearchHistory(entry: Omit<SearchHistory, "id">): Promise<void> {
    await db.searchHistory.put({ ...entry, id: newId() });
  }

  private async updateSearchHistoryResultCount(query: string, count: number): Promise<void> {
    const history = await db.searchHistory.where("query").equals(query).reverse().limit(1).first();
    if (history) {
      await db.searchHistory.update(history.id, { resultCount: count });
    }
  }
}

/** Notifica nuevas ofertas descubiertas (función standalone para evitar problemas TS). */
async function notifyNewDiscoveredJobsStandalone(query: string, count: number): Promise<void> {
  const mod = await import("~/lib/notifications.js");
  await mod.notifyNewDiscoveredJobs(query, count);
}

/** Singleton exportado. */
export const discoveryService = DiscoveryService.getInstance();
