import type { WorkMode } from "@postulia/shared";
import {
  cleanText,
  detectContractType,
  detectWorkMode,
  stripHtml,
  type ExtractedJob,
} from "./types";

interface JsonLdNode {
  "@type"?: string | string[];
  [key: string]: unknown;
}

function isJobPosting(node: JsonLdNode): boolean {
  const type = node["@type"];
  if (!type) return false;
  const types = Array.isArray(type) ? type : [type];
  return types.some((value) => value === "JobPosting");
}

function findJobPosting(nodes: JsonLdNode[]): JsonLdNode | null {
  for (const node of nodes) {
    if (isJobPosting(node)) return node;
    const graph = node["@graph"];
    if (Array.isArray(graph)) {
      const found = findJobPosting(graph as JsonLdNode[]);
      if (found) return found;
    }
  }
  return null;
}

function readString(value: unknown): string | null {
  if (typeof value === "string") return cleanText(value);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record["name"] === "string") return cleanText(record["name"]);
  }
  return null;
}

function readLocation(value: unknown): string | null {
  if (!value) return null;

  const readAddress = (address: unknown): string | null => {
    if (!address || typeof address !== "object") return null;
    const record = address as Record<string, unknown>;
    const parts = [
      readString(record["addressLocality"]),
      readString(record["addressRegion"]),
      readString(record["addressCountry"]),
    ].filter((part): part is string => Boolean(part));
    return parts.length > 0 ? parts.join(", ") : null;
  };

  if (Array.isArray(value)) {
    for (const item of value) {
      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        const located = readAddress(record["address"]) ?? readString(record["name"]);
        if (located) return located;
      }
    }
    return null;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return readAddress(record["address"]) ?? readString(record["name"]);
  }

  return readString(value);
}

function readSalary(value: unknown): { salary: string | null; currency: string | null } {
  if (!value || typeof value !== "object") return { salary: null, currency: null };
  const record = value as Record<string, unknown>;
  const currency = readString(record["currency"]);
  const amount = record["value"];

  if (typeof amount === "number") {
    return { salary: String(amount), currency };
  }

  if (amount && typeof amount === "object") {
    const valueRecord = amount as Record<string, unknown>;
    const single = valueRecord["value"];
    const min = valueRecord["minValue"];
    const max = valueRecord["maxValue"];
    const unit = readString(valueRecord["unitText"]);

    if (typeof single === "number" || typeof single === "string") {
      return {
        salary: [String(single), unit].filter(Boolean).join(" "),
        currency,
      };
    }
    if (min !== undefined || max !== undefined) {
      const range = [min, max].filter((item) => item !== undefined).join(" - ");
      return { salary: [range, unit].filter(Boolean).join(" "), currency };
    }
  }

  return { salary: null, currency };
}

/** Extrae los datos de la oferta desde JSON-LD (schema.org/JobPosting). */
export function extractFromJsonLd(doc: Document): Partial<ExtractedJob> | null {
  const scripts = [...doc.querySelectorAll('script[type="application/ld+json"]')];
  if (scripts.length === 0) return null;

  const nodes: JsonLdNode[] = [];
  for (const script of scripts) {
    const raw = script.textContent?.trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as JsonLdNode | JsonLdNode[];
      if (Array.isArray(parsed)) nodes.push(...parsed);
      else nodes.push(parsed);
    } catch {
      // JSON-LD inválido: se ignora
    }
  }

  const posting = findJobPosting(nodes);
  if (!posting) return null;

  const title = readString(posting["title"]);
  const company = readString(posting["hiringOrganization"]);
  const location = readLocation(posting["jobLocation"]) ?? readLocation(posting["jobLocationType"]);
  const { salary, currency } = readSalary(posting["baseSalary"]);
  const employmentType = readString(posting["employmentType"]);

  const remoteHint =
    typeof posting["jobLocationType"] === "string" &&
    (posting["jobLocationType"] as string).toUpperCase().includes("TELECOMMUTE");

  const workMode: WorkMode | null = remoteHint
    ? "remote"
    : detectWorkMode(
        typeof posting["description"] === "string" ? (posting["description"] as string) : null,
      );

  return {
    jobTitle: title,
    company,
    location,
    workMode,
    salary,
    currency,
    contractType: detectContractType(employmentType),
    description: stripHtml(
      typeof posting["description"] === "string" ? posting["description"] : null,
    ),
    postedAt: readString(posting["datePosted"]),
  };
}
