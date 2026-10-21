import { detectContractType, detectWorkMode, firstText, type Extractor } from "./types";

const TITLE_SELECTORS = ["h1.fs24", "h1[class*='fs24']", ".box_detail h1", "h2.fs24", "h1"];

const COMPANY_SELECTORS = [
  ".box_detail a[href*='/empresas/']",
  ".box_company a",
  "[class*='company'] a[href*='/empresas/']",
  "[class*='company']",
];

const LOCATION_SELECTORS = [".box_detail p.fs13", "[class*='location']", "p[class*='fs13']"];

const SALARY_SELECTORS = ["[class*='salary']", "[class*='salario']", ".box_detail .fs16"];

export const computrabajoExtractor: Extractor = {
  name: "computrabajo",
  matches: (url) => {
    if (!/(^|\.)computrabajo\.[a-z.]+$/i.test(url.hostname)) return false;
    return (
      /\/oferta-de-trabajo\//.test(url.pathname) || /\/ofertas-de-trabajo\/[^/]+/.test(url.pathname)
    );
  },
  extract: (doc, url) => {
    const location = firstText(doc, LOCATION_SELECTORS);
    const salaryText = firstText(doc, SALARY_SELECTORS);
    const salary =
      salaryText && /\d/.test(salaryText) && /[$€£]|s\/|usd/i.test(salaryText) ? salaryText : null;

    const description = firstText(doc, [".box_detail", "[class*='description']"], 4000);

    return {
      jobTitle: firstText(doc, TITLE_SELECTORS),
      company: firstText(doc, COMPANY_SELECTORS),
      location,
      workMode: detectWorkMode(location ?? description),
      salary,
      contractType: detectContractType(description),
      description: description ? description.slice(0, 4000) : null,
      url: url.toString(),
    };
  },
};
