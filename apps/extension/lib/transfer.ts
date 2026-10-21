import Papa from "papaparse";
import {
  APPLICATION_STATUSES,
  CONTRACT_TYPES,
  SOURCES,
  SOURCE_LABELS,
  STATUS_LABELS,
  WORK_MODES,
  WORK_MODE_LABELS,
  newId,
  nowIso,
  type ApplicationStatus,
  type Source,
} from "@postulia/shared";
import {
  db,
  type LocalApplication,
  type LocalEvent,
  type LocalReminder,
  type LocalTag,
} from "./db";
import { createApplication, ensureTags } from "./repository";

const EXPORT_VERSION = 1;

type StripDirty<T> = Omit<T, "dirty">;

function stripDirty<T extends { dirty?: 1 }>(record: T): StripDirty<T> {
  const { dirty: _dirty, ...rest } = record;
  return rest;
}

export async function exportJson(): Promise<string> {
  const [applications, events, reminders, tags] = await Promise.all([
    db.applications.toArray(),
    db.events.toArray(),
    db.reminders.toArray(),
    db.tags.toArray(),
  ]);

  return JSON.stringify(
    {
      version: EXPORT_VERSION,
      application: "Postulia",
      exportedAt: nowIso(),
      applications: applications.map(stripDirty),
      events: events.map(stripDirty),
      reminders: reminders.map(stripDirty),
      tags: tags.map(stripDirty),
    },
    null,
    2,
  );
}

export const CSV_COLUMNS = [
  "puesto",
  "empresa",
  "enlace",
  "portal",
  "estado",
  "ubicacion",
  "modalidad",
  "salario",
  "moneda",
  "contrato",
  "fecha_postulacion",
  "etiquetas",
  "reclutador",
  "contacto_reclutador",
  "notas",
] as const;

export async function exportCsv(): Promise<string> {
  const applications = await db.applications.filter((item) => !item.deletedAt).toArray();

  const rows = applications.map((application) => ({
    puesto: application.jobTitle,
    empresa: application.company,
    enlace: application.url ?? "",
    portal: SOURCE_LABELS[application.source],
    estado: STATUS_LABELS[application.status],
    ubicacion: application.location ?? "",
    modalidad: application.workMode ? WORK_MODE_LABELS[application.workMode] : "",
    salario: application.salary ?? "",
    moneda: application.currency ?? "",
    contrato: application.contractType ?? "",
    fecha_postulacion: application.appliedAt ?? "",
    etiquetas: application.tags.join(" | "),
    reclutador: application.recruiterName ?? "",
    contacto_reclutador: application.recruiterContact ?? "",
    notas: application.notes ?? "",
  }));

  return Papa.unparse(rows, { columns: [...CSV_COLUMNS] });
}

function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s-]+/g, "_");
}

const HEADER_ALIASES: Record<string, string> = {
  puesto: "puesto",
  cargo: "puesto",
  title: "puesto",
  job_title: "puesto",
  position: "puesto",
  empresa: "empresa",
  company: "empresa",
  organizacion: "empresa",
  enlace: "enlace",
  url: "enlace",
  link: "enlace",
  portal: "portal",
  fuente: "portal",
  source: "portal",
  estado: "estado",
  status: "estado",
  ubicacion: "ubicacion",
  location: "ubicacion",
  ciudad: "ubicacion",
  modalidad: "modalidad",
  work_mode: "modalidad",
  salario: "salario",
  salary: "salario",
  moneda: "moneda",
  currency: "moneda",
  contrato: "contrato",
  contract: "contrato",
  contract_type: "contrato",
  fecha_postulacion: "fecha_postulacion",
  applied_at: "fecha_postulacion",
  fecha: "fecha_postulacion",
  etiquetas: "etiquetas",
  tags: "etiquetas",
  reclutador: "reclutador",
  recruiter: "reclutador",
  contacto_reclutador: "contacto_reclutador",
  recruiter_contact: "contacto_reclutador",
  notas: "notas",
  notes: "notas",
  observaciones: "notas",
};

function statusFromText(value: string | undefined): ApplicationStatus {
  const raw = (value ?? "").trim().toLowerCase();
  const direct = APPLICATION_STATUSES.find((status) => status === raw);
  if (direct) return direct;
  const byLabel = APPLICATION_STATUSES.find(
    (status) => STATUS_LABELS[status].toLowerCase() === raw,
  );
  return byLabel ?? "saved";
}

function sourceFromText(value: string | undefined, url: string | null): Source {
  const raw = (value ?? "").trim().toLowerCase();
  const direct = SOURCES.find((source) => source === raw);
  if (direct) return direct;
  const byLabel = SOURCES.find((source) => SOURCE_LABELS[source].toLowerCase() === raw);
  if (byLabel) return byLabel;
  if (url) {
    const host = url.toLowerCase();
    if (host.includes("linkedin")) return "linkedin";
    if (host.includes("computrabajo")) return "computrabajo";
    if (host.includes("indeed")) return "indeed";
    if (host.includes("bumeran")) return "bumeran";
    if (host.includes("getonbrd")) return "getonbrd";
    if (host.includes("torre.ai")) return "torre";
  }
  return "other";
}

function workModeFromText(value: string | undefined): LocalApplication["workMode"] {
  const raw = (value ?? "").trim().toLowerCase();
  const direct = WORK_MODES.find((mode) => mode === raw);
  if (direct) return direct;
  const byLabel = WORK_MODES.find((mode) => WORK_MODE_LABELS[mode].toLowerCase() === raw);
  if (byLabel) return byLabel;
  if (raw.includes("remot")) return "remote";
  if (raw.includes("hibrid")) return "hybrid";
  if (raw.includes("presencial") || raw.includes("onsite")) return "onsite";
  return null;
}

function contractFromText(value: string | undefined): string | null {
  const raw = (value ?? "").trim().toLowerCase();
  if (!raw) return null;
  const direct = CONTRACT_TYPES.find((type) => type === raw);
  if (direct) return direct;
  if (raw.includes("completo") || raw.includes("full")) return "full_time";
  if (raw.includes("medio") || raw.includes("part")) return "part_time";
  if (raw.includes("freelance")) return "freelance";
  if (raw.includes("pasant") || raw.includes("intern")) return "internship";
  if (raw.includes("temporal")) return "temporary";
  return raw;
}

export async function importCsv(
  text: string,
): Promise<{ imported: number; skipped: number; errors: string[] }> {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => HEADER_ALIASES[normalizeHeader(header)] ?? normalizeHeader(header),
  });

  const errors = parsed.errors.map((error) => `Fila ${error.row ?? "?"}: ${error.message}`);
  let imported = 0;
  let skipped = 0;

  for (const row of parsed.data) {
    const jobTitle = (row["puesto"] ?? "").trim();
    const company = (row["empresa"] ?? "").trim();
    if (!jobTitle || !company) {
      skipped += 1;
      continue;
    }

    const url = (row["enlace"] ?? "").trim() || null;
    const status = statusFromText(row["estado"]);
    const tagsRaw = (row["etiquetas"] ?? "").trim();

    await createApplication({
      jobTitle,
      company,
      url,
      source: sourceFromText(row["portal"], url),
      location: (row["ubicacion"] ?? "").trim() || null,
      workMode: workModeFromText(row["modalidad"]),
      salary: (row["salario"] ?? "").trim() || null,
      currency: (row["moneda"] ?? "").trim() || null,
      contractType: contractFromText(row["contrato"]),
      status,
      appliedAt: (row["fecha_postulacion"] ?? "").trim() || null,
      notes: (row["notas"] ?? "").trim() || null,
      recruiterName: (row["reclutador"] ?? "").trim() || null,
      recruiterContact: (row["contacto_reclutador"] ?? "").trim() || null,
      cvVersion: null,
      tags: tagsRaw
        ? tagsRaw
            .split(/[|,;]/)
            .map((tag) => tag.trim())
            .filter(Boolean)
        : [],
    });

    imported += 1;
  }

  return { imported, skipped, errors: errors.slice(0, 10) };
}

interface BackupFile {
  version?: number;
  applications?: unknown[];
  events?: unknown[];
  reminders?: unknown[];
  tags?: unknown[];
}

export async function importJson(
  text: string,
): Promise<{ applications: number; events: number; reminders: number; tags: number }> {
  const parsed = JSON.parse(text) as BackupFile;

  const applications = (parsed.applications ?? []) as LocalApplication[];
  const events = (parsed.events ?? []) as LocalEvent[];
  const reminders = (parsed.reminders ?? []) as LocalReminder[];
  const tags = (parsed.tags ?? []) as LocalTag[];

  const tagNames = applications.flatMap((application) =>
    Array.isArray(application.tags) ? application.tags : [],
  );
  await ensureTags(tagNames);

  await db.transaction("rw", db.applications, db.events, db.reminders, db.tags, async () => {
    for (const application of applications) {
      await db.applications.put({
        ...application,
        id: application.id || newId(),
        updatedAt: application.updatedAt ?? nowIso(),
        createdAt: application.createdAt ?? nowIso(),
        deletedAt: application.deletedAt ?? null,
        dirty: 1,
      });
    }
    for (const event of events) {
      await db.events.put({ ...event, dirty: 1 });
    }
    for (const reminder of reminders) {
      await db.reminders.put({ ...reminder, dirty: 1 });
    }
    for (const tag of tags) {
      await db.tags.put({ ...tag, dirty: 1 });
    }
  });

  return {
    applications: applications.length,
    events: events.length,
    reminders: reminders.length,
    tags: tags.length,
  };
}

export function downloadFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
