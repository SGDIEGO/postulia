import { detectWorkMode, firstText, type Extractor } from "./types";

const TITLE_SELECTORS = [
  "h1.jobsearch-JobInfoHeader-title",
  "h1[data-testid='jobsearch-JobInfoHeader-title']",
  "h1[class*='JobInfoHeader-title']",
  "h2.jobsearch-JobInfoHeader-title",
  "h1",
];

const COMPANY_SELECTORS = [
  "[data-testid='inlineHeader-companyName']",
  "[data-company-name='true']",
  ".jobsearch-CompanyInfoContainer a",
  ".jobsearch-InlineCompanyRating a",
  "[class*='companyName']",
];

const LOCATION_SELECTORS = [
  "[data-testid='inlineHeader-companyLocation']",
  "#jobLocationText",
  "[class*='companyLocation']",
];

const SALARY_SELECTORS = [
  "#salaryInfoAndJobType",
  "[data-testid='attribute_snippet_testid']",
  "[class*='salary-snippet']",
];

function canonicalUrl(url: URL): string {
  const jk = url.searchParams.get("jk") ?? url.searchParams.get("vjk");
  if (jk) return `https://www.indeed.com/viewjob?jk=${jk}`;
  const pathMatch = url.pathname.match(/\/viewjob\/([a-z0-9]+)/i);
  if (pathMatch?.[1]) return `https://www.indeed.com/viewjob?jk=${pathMatch[1]}`;
  return url.toString();
}

export const indeedExtractor: Extractor = {
  name: "indeed",
  matches: (url) => {
    if (!/(^|\.)indeed\.[a-z.]+$/i.test(url.hostname)) return false;
    return (
      /\/viewjob/.test(url.pathname) ||
      /\/m\/viewjob/.test(url.pathname) ||
      url.searchParams.has("jk") ||
      url.searchParams.has("vjk")
    );
  },
  extract: (doc, url) => {
    const location = firstText(doc, LOCATION_SELECTORS);
    const salaryText = firstText(doc, SALARY_SELECTORS);
    const description = firstText(doc, ["#jobDescriptionText", "[class*='jobDescription']"], 4000);

    return {
      jobTitle: firstText(doc, TITLE_SELECTORS),
      company: firstText(doc, COMPANY_SELECTORS),
      location,
      workMode: detectWorkMode(location ?? description),
      salary: salaryText,
      description: description ? description.slice(0, 4000) : null,
      url: canonicalUrl(url),
    };
  },
};
