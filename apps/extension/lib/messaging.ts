import type { ApplicationRecord, ApplicationStatus } from "@postulia/shared";
import { browser } from "wxt/browser";
import type { ExtractedJobResult } from "./extractors/types";

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
  | { type: "postulia:check-reminders" };

export interface ExtensionStatus {
  apiUrl: string;
  loggedIn: boolean;
  email: string | null;
  pending: number;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  totalApplications: number;
  reminders: { overdue: number; upcoming: number };
}

export type CaptureResponse =
  | { ok: true; application: ApplicationRecord }
  | { ok: false; duplicate: true; application: ApplicationRecord }
  | { ok: false; error: string };

export type DuplicateResponse =
  | { duplicate: false }
  | { duplicate: true; application: ApplicationRecord; origin: "local" | "remoto" };

/** Envía una petición al service worker desde cualquier contexto. */
export async function sendMessage<T>(request: BackgroundRequest): Promise<T> {
  return (await browser.runtime.sendMessage(request)) as T;
}
