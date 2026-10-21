import { detectSource } from "@postulia/shared";
import {
  cleanText,
  detectContractType,
  detectWorkMode,
  metaContent,
  stripHtml,
  type Extractor,
} from "./types";

const COMPANY_SELECTORS = [
  "[itemprop='hiringOrganization']",
  "[class*='company-name']",
  "[class*='companyName']",
  "[class*='empresa']",
  "[data-company]",
  "a[href*='/company']",
  "a[href*='/empresa']",
];

const LOCATION_SELECTORS = [
  "[itemprop='jobLocation']",
  "[class*='location']",
  "[class*='ubicacion']",
  "[class*='ubicación']",
];

const SALARY_SELECTORS = ["[class*='salary']", "[class*='salario']", "[itemprop='baseSalary']"];

const TITLE_SELECTORS = [
  "[itemprop='title']",
  "h1[class*='title']",
  "h1[class*='titulo']",
  "h2[class*='title']",
  "h1",
];

/** Extractores genéricos: sirven para portales sin adaptador propio. */
export const genericExtractor: Extractor = {
  name: "generic",
  matches: () => true,
  extract: (doc) => {
    const title =
      cleanText(doc.querySelector("h1")?.textContent) ??
      metaContent(doc, ["og:title", "twitter:title"]) ??
      cleanText(doc.title.split(/[|\-–]/)[0] ?? doc.title);

    const location = cleanText(
      doc.querySelector(LOCATION_SELECTORS.join(", "))?.textContent ?? null,
    );
    const salary = cleanText(doc.querySelector(SALARY_SELECTORS.join(", "))?.textContent ?? null);

    const descriptionHtml =
      doc.querySelector("[class*='description'], [itemprop='description']")?.innerHTML ?? null;

    return {
      jobTitle: title,
      company: cleanText(doc.querySelector(COMPANY_SELECTORS.join(", "))?.textContent ?? null),
      location,
      workMode: detectWorkMode(location),
      salary: salary && /\d/.test(salary) ? salary : null,
      contractType: detectContractType(location),
      description: stripHtml(descriptionHtml),
      url: undefined,
    };
  },
};

export function genericSourceName(url: string): string {
  return detectSource(url);
}
