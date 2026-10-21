/** Utilidades de fecha/hora compartidas entre API y extensión. */

export function newId(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Inicio de la semana (lunes por defecto) en UTC. */
export function startOfWeek(input: Date | string, weekStartsOn = 1): Date {
  const date = typeof input === "string" ? new Date(input) : new Date(input.getTime());
  const day = date.getUTCDay();
  const diff = (day - weekStartsOn + 7) % 7;
  date.setUTCDate(date.getUTCDate() - diff);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

export function addDays(input: Date | string, days: number): Date {
  const date = typeof input === "string" ? new Date(input) : new Date(input.getTime());
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

/** Diferencia en días completos (b - a). */
export function daysBetween(a: Date | string, b: Date | string): number {
  const start = typeof a === "string" ? new Date(a) : a;
  const end = typeof b === "string" ? new Date(b) : b;
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000);
}

export function isPast(value: string | Date): boolean {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.getTime() < Date.now();
}

export function formatDateEs(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es", { day: "2-digit", month: "short", year: "numeric" }).format(
    date,
  );
}

export function formatDateTimeEs(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** "hace 3 días", "en 2 horas", "ahora". */
export function relativeTimeEs(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const diffMs = date.getTime() - Date.now();
  const abs = Math.abs(diffMs);

  const formatter = new Intl.RelativeTimeFormat("es", { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000_000],
    ["month", 2_592_000_000],
    ["week", 604_800_000],
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000],
  ];

  for (const [unit, ms] of units) {
    if (abs >= ms || unit === "minute") {
      return formatter.format(Math.round(diffMs / ms), unit);
    }
  }
  return "ahora";
}

export function isoDay(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toISOString().slice(0, 10);
}
