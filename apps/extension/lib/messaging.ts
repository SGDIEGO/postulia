import type { ApplicationRecord, ApplicationStatus } from "@postulia/shared";
import { browser } from "wxt/browser";
import type { ExtractedJobResult } from "./extractors/types";
import type { SearchFilters, Source, DiscoveryAction, DiscoverySearchResult } from "@postulia/shared";

export interface CapturePayload extends ExtractedJobResult {
  status: ApplicationStatus;
  notes?: string | null;
  force?: boolean;
}

export type BackgroundRequest =
  | { type: "postulia:sync-now" }
  | { type: "postulia:status" }
  | { type: "postulia:capture"; payload: CapturePayload }
  | { type: "postulia:update-status"; id: string; status: ApplicationStatus; force?: boolean }
  | { type: "postulia:duplicate-check"; url: string }
  | { type: "postulia:open-dashboard" }
  | { type: "postulia:open-sidepanel"; tabId?: number }
  | { type: "postulia:check-reminders" }
  // Discovery
  | { type: "discovery:search"; query: string; filters: SearchFilters; source?: Source }
  | { type: "discovery:list"; query?: string; source?: Source; filters?: SearchFilters; page: number; pageSize: number }
  | { type: "discovery:action"; jobId: string; action: DiscoveryAction; reminderDays?: number }
  | { type: "discovery:history" }
  | { type: "discovery:alert:create"; alert: Omit<import("@postulia/shared").SearchAlert, "id" | "createdAt"> }
  | { type: "discovery:alert:list" }
  | { type: "discovery:alert:toggle"; id: string; enabled: boolean }
  | { type: "discovery:alert:delete"; id: string };

export interface ExtensionStatus {
  apiUrl: string;
  loggedIn: boolean;
  email: string | null;
  pending: number;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  totalApplications: number;
  reminders: { overdue: number; upcoming: number };
  discovery?: { pendingSearches: number };
}

export type CaptureResponse =
  | { ok: true; application: ApplicationRecord }
  | { ok: false; duplicate: true; application: ApplicationRecord }
  | { ok: false; error: string };

export type DuplicateResponse =
  | { duplicate: false }
  | { duplicate: true; application: ApplicationRecord; origin: "local" | "remoto" };

export type DiscoverySearchResponse = DiscoverySearchResult;
export type DiscoveryActionResponse = { ok: boolean; error?: string };
export type DiscoveryHistoryResponse = import("@postulia/shared").SearchHistory[];
export type DiscoveryAlertResponse = import("@postulia/shared").SearchAlert[];
export type DiscoveryAlertActionResponse = { ok: boolean };

/** Envía una petición al service worker desde cualquier contexto. */
export async function sendMessage<T>(request: BackgroundRequest): Promise<T> {
  return (await browser.runtime.sendMessage(request)) as T;
}
