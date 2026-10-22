import { z } from "zod";

/** Fecha ISO 8601 (acepta zona horaria). */
export const isoDateTime = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), "Fecha inválida: se espera ISO 8601");

/* -------------------------------------------------------------------------- */
/*  Portales / fuentes                                                        */
/* -------------------------------------------------------------------------- */

export const SOURCES = [
  "linkedin",
  "computrabajo",
  "indeed",
  "bumeran",
  "getonbrd",
  "torre",
  "other",
] as const;

export type Source = (typeof SOURCES)[number];

export const SOURCE_LABELS: Record<Source, string> = {
  linkedin: "LinkedIn",
  computrabajo: "Computrabajo",
  indeed: "Indeed",
  bumeran: "Bumeran",
  getonbrd: "Get on Board",
  torre: "Torre",
  other: "Otro",
};

/** Dominios soportados por los extractores de la extensión. */
export const SOURCE_HOSTS: { source: Source; hosts: string[] }[] = [
  { source: "linkedin", hosts: ["linkedin.com", "www.linkedin.com", "es.linkedin.com"] },
  {
    source: "computrabajo",
    hosts: [
      "computrabajo.com",
      "ar.computrabajo.com",
      "co.computrabajo.com",
      "www.computrabajo.com",
    ],
  },
  { source: "indeed", hosts: ["indeed.com", "www.indeed.com", "mx.indeed.com", "ar.indeed.com"] },
  { source: "bumeran", hosts: ["bumeran.com", "www.bumeran.com"] },
  { source: "getonbrd", hosts: ["getonbrd.com", "www.getonbrd.com"] },
  { source: "torre", hosts: ["torre.ai", "www.torre.ai"] },
];

/* -------------------------------------------------------------------------- */
/*  Pipeline de estados                                                       */
/* -------------------------------------------------------------------------- */

export const APPLICATION_STATUSES = [
  "saved",
  "applied",
  "screening",
  "interview",
  "offer",
  "rejected",
  "withdrawn",
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  saved: "Guardada",
  applied: "Postulada",
  screening: "En revisión",
  interview: "Entrevista",
  offer: "Oferta",
  rejected: "Rechazada",
  withdrawn: "Retirada",
};

/** Orden de las columnas del Kanban. */
export const KANBAN_STATUSES: ApplicationStatus[] = [
  "saved",
  "applied",
  "screening",
  "interview",
  "offer",
];

/** Estados que cuentan como "en curso". */
export const ACTIVE_STATUSES: ApplicationStatus[] = [
  "saved",
  "applied",
  "screening",
  "interview",
  "offer",
];

export const STATUS_COLORS: Record<ApplicationStatus, string> = {
  saved: "#94a3b8",
  applied: "#3b82f6",
  screening: "#8b5cf6",
  interview: "#f59e0b",
  offer: "#10b981",
  rejected: "#ef4444",
  withdrawn: "#6b7280",
};

/* -------------------------------------------------------------------------- */
/*  Modalidad / contratación                                                  */
/* -------------------------------------------------------------------------- */

export const WORK_MODES = ["remote", "hybrid", "onsite"] as const;
export type WorkMode = (typeof WORK_MODES)[number];

export const WORK_MODE_LABELS: Record<WorkMode, string> = {
  remote: "Remoto",
  hybrid: "Híbrido",
  onsite: "Presencial",
};

export type WorkModeSource = "portal" | "jsonld" | "text" | "unknown";
export type WorkModeConfidence = "high" | "medium" | "low";

export interface WorkModeDetection {
  workMode: WorkMode;
  source: WorkModeSource;
  confidence: WorkModeConfidence;
}

function normalizeModeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Interpreta un valor estructurado del portal, por ejemplo el
 * `workplaceType` de LinkedIn. No deduce a partir de una descripción.
 */
export function parseWorkModeLabel(label?: string | null): WorkModeDetection | undefined {
  const normalized = normalizeModeText(label ?? "").trim();
  if (!normalized) return undefined;

  if (/\b(hibrid[oa]|hybrid)\b/.test(normalized)) {
    return { workMode: "hybrid", source: "portal", confidence: "high" };
  }
  if (/\b(presencial|on[- ]?site)\b/.test(normalized)) {
    return { workMode: "onsite", source: "portal", confidence: "high" };
  }
  if (/\b(remot[oa]|remote)\b/.test(normalized)) {
    return { workMode: "remote", source: "portal", confidence: "high" };
  }
  return undefined;
}

/**
 * Deduce la modalidad a partir de un texto.
 *
 * No basta con que aparezca «remote»: en descripciones largas se exige una
 * frase explícita (`requireExplicit`), para no confundir «remote team» con una
 * oferta remota. La etiqueta estructurada del portal tiene prioridad y se
 * procesa con `parseWorkModeLabel`.
 */
export function detectWorkModeFromText(
  text?: string | null,
  options: { source?: WorkModeSource; requireExplicit?: boolean } = {},
): WorkModeDetection | undefined {
  const normalized = normalizeModeText(text ?? "");
  if (!normalized.trim()) return undefined;

  const strongRemote =
    /\b(100\s*%|100\s*por\s*ciento|totalmente|completamente|fully)\s*(remot[oa]|remote)\b/.test(
      normalized,
    ) ||
    /\b(remot[oa]|remote)\s*(100\s*%|100\s*por\s*ciento|totalmente|completamente|fully)\b/.test(
      normalized,
    ) ||
    /\b(remote|remoto)[- ]first\b/.test(normalized);

  const explicitRemote =
    strongRemote ||
    /\bremot[oa]\b/.test(normalized) ||
    /\b(teletrabajo|home[ -]?office)\b/.test(normalized) ||
    /\b(remote|remot[oa])\s+(work|job|position|role|opportunity|puesto|vacante|empleo|cargo|modalidad)\b/.test(
      normalized,
    ) ||
    /\b(trabajo|puesto|vacante|empleo|cargo|modalidad)\s+(remote|remot[oa])\b/.test(normalized);

  const hybrid =
    /\b(hibrid[oa]|hybrid)\b/.test(normalized) || /\bmodalidad\s+(mixta|mixto)\b/.test(normalized);
  const onsite = /\b(presencial|on[- ]?site|en\s+(la\s+)?oficina)\b/.test(normalized);
  const remote = /\b(remot[oa]|remote|teletrabajo|home[ -]?office)\b/.test(normalized);

  const source = options.source ?? "text";
  if (strongRemote) {
    return { workMode: "remote", source, confidence: "high" };
  }

  const matches = [hybrid, onsite, remote].filter(Boolean).length;
  const confidence: WorkModeConfidence = matches > 1 ? "low" : "medium";

  if (hybrid) return { workMode: "hybrid", source, confidence };
  if (onsite) return { workMode: "onsite", source, confidence };
  if (remote && (!options.requireExplicit || explicitRemote)) {
    return { workMode: "remote", source, confidence };
  }
  return undefined;
}

export const CONTRACT_TYPES = [
  "full_time",
  "part_time",
  "contract",
  "freelance",
  "internship",
  "temporary",
] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];

export const CONTRACT_TYPE_LABELS: Record<ContractType, string> = {
  full_time: "Tiempo completo",
  part_time: "Medio tiempo",
  contract: "Por contrato",
  freelance: "Freelance",
  internship: "Pasantía",
  temporary: "Temporal",
};

/* -------------------------------------------------------------------------- */
/*  Postulación                                                               */
/* -------------------------------------------------------------------------- */

export const tagNameSchema = z.string().trim().min(1).max(40);

/** Campos editables de una postulación (creación y edición). */
export const applicationInputSchema = z.object({
  jobTitle: z.string().trim().min(1).max(200),
  company: z.string().trim().min(1).max(200),
  url: z.string().trim().max(2000).nullish(),
  source: z.enum(SOURCES).default("other"),
  location: z.string().trim().max(200).nullish(),
  workMode: z.enum(WORK_MODES).nullish(),
  salary: z.string().trim().max(120).nullish(),
  currency: z.string().trim().max(10).nullish(),
  contractType: z.string().trim().max(60).nullish(),
  status: z.enum(APPLICATION_STATUSES).default("saved"),
  appliedAt: isoDateTime.nullish(),
  notes: z.string().max(20_000).nullish(),
  recruiterName: z.string().trim().max(200).nullish(),
  recruiterContact: z.string().trim().max(300).nullish(),
  cvVersion: z.string().trim().max(120).nullish(),
  tags: z.array(tagNameSchema).max(20).default([]),
});

export type ApplicationInput = z.infer<typeof applicationInputSchema>;

/** Registro completo, tal como viaja en la sincronización. */
export const applicationSyncSchema = applicationInputSchema.extend({
  id: z.uuid(),
  urlHash: z.string().max(80).nullish(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  deletedAt: isoDateTime.nullish(),
});

export type ApplicationSync = z.infer<typeof applicationSyncSchema>;

/** Registro de postulación usado en la extensión (idéntico al de sync). */
export type ApplicationRecord = ApplicationSync;

export const applicationFiltersSchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.union([z.enum(APPLICATION_STATUSES), z.array(z.enum(APPLICATION_STATUSES))]).optional(),
  source: z.union([z.enum(SOURCES), z.array(z.enum(SOURCES))]).optional(),
  tag: z.string().trim().max(40).optional(),
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
  sort: z.enum(["updatedAt", "createdAt", "appliedAt", "company", "jobTitle"]).optional(),
  order: z.enum(["asc", "desc"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  includeDeleted: z.coerce.boolean().optional(),
});

export type ApplicationFilters = z.infer<typeof applicationFiltersSchema>;

/* -------------------------------------------------------------------------- */
/*  Timeline                                                                  */
/* -------------------------------------------------------------------------- */

export const EVENT_TYPES = [
  "created",
  "status_change",
  "note",
  "interview",
  "email",
  "offer",
  "rejection",
  "reminder",
  "follow_up",
  "other",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  created: "Creada",
  status_change: "Cambio de estado",
  note: "Nota",
  interview: "Entrevista",
  email: "Correo",
  offer: "Oferta",
  rejection: "Rechazo",
  reminder: "Recordatorio",
  follow_up: "Seguimiento",
  other: "Otro",
};

export const eventSyncSchema = z.object({
  id: z.uuid(),
  applicationId: z.uuid(),
  type: z.enum(EVENT_TYPES),
  message: z.string().max(5000).nullish(),
  fromStatus: z.enum(APPLICATION_STATUSES).nullish(),
  toStatus: z.enum(APPLICATION_STATUSES).nullish(),
  occurredAt: isoDateTime,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  deletedAt: isoDateTime.nullish(),
});

export type EventSync = z.infer<typeof eventSyncSchema>;
export type ApplicationEventRecord = EventSync;

/* -------------------------------------------------------------------------- */
/*  Recordatorios                                                             */
/* -------------------------------------------------------------------------- */

export const reminderSyncSchema = z.object({
  id: z.uuid(),
  applicationId: z.uuid(),
  dueAt: isoDateTime,
  message: z.string().max(500).nullish(),
  done: z.boolean().default(false),
  notifiedAt: isoDateTime.nullish(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  deletedAt: isoDateTime.nullish(),
});

export type ReminderSync = z.infer<typeof reminderSyncSchema>;
export type ReminderRecord = ReminderSync;

/* -------------------------------------------------------------------------- */
/*  Etiquetas                                                                 */
/* -------------------------------------------------------------------------- */

export const TAG_COLORS = [
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#f59e0b",
  "#10b981",
  "#06b6d4",
  "#ef4444",
  "#84cc16",
  "#6366f1",
  "#64748b",
] as const;

export const tagSyncSchema = z.object({
  id: z.uuid(),
  name: tagNameSchema,
  color: z.string().trim().max(20).nullish(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  deletedAt: isoDateTime.nullish(),
});

export type TagSync = z.infer<typeof tagSyncSchema>;
export type TagRecord = TagSync;

/* -------------------------------------------------------------------------- */
/*  Estadísticas                                                              */
/* -------------------------------------------------------------------------- */

export interface StatsSummary {
  total: number;
  active: number;
  byStatus: Record<ApplicationStatus, number>;
  bySource: { source: Source; count: number }[];
  /** Postulaciones por semana (lunes como inicio). */
  weekly: { weekStart: string; count: number }[];
  /** Entrevistas u ofertas sobre el total de postuladas. */
  responseRate: number;
  /** Días promedio desde postulación hasta la primera entrevista. */
  avgDaysToInterview: number | null;
  pendingReminders: number;
}
