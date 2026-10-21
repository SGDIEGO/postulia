import { detectWorkMode, firstText, type Extractor } from "./types";

const TITLE_SELECTORS = [
  "h1.job-details-jobs-unified-top-card__job-title",
  "h1.top-card-layout__title",
  "h1.t-24.t-black.t-normal",
  "h1[class*='job-title']",
  "h1",
];

const COMPANY_SELECTORS = [
  ".job-details-jobs-unified-top-card__company-name a",
  ".job-details-jobs-unified-top-card__company-name",
  "a.topcard__org-name-link",
  "[class*='company-name'] a",
  "[class*='company-name']",
];

const LOCATION_SELECTORS = [
  ".job-details-jobs-unified-top-card__primary-description-container .tvm__text",
  ".job-details-jobs-unified-top-card__bullet",
  ".topcard__flavor--bullet",
  "[class*='primary-description']",
];

const POSTED_SELECTORS = [
  ".job-details-jobs-unified-top-card__posted-date",
  "[class*='posted-time-ago']",
  "span.tvm__text--low-emphasis",
];

const WORKPLACE_SELECTORS = [
  ".job-details-jobs-unified-top-card__workplace-type",
  "[class*='workplace-type']",
];

function canonicalUrl(url: URL): string {
  const pathMatch = url.pathname.match(/\/jobs\/view\/(\d+)/);
  const queryId = url.searchParams.get("currentJobId");
  const jobId = pathMatch?.[1] ?? (queryId && /^\d+$/.test(queryId) ? queryId : null);
  return jobId ? `https://www.linkedin.com/jobs/view/${jobId}/` : url.toString();
}

export const linkedinExtractor: Extractor = {
  name: "linkedin",
  matches: (url) => {
    if (!/(^|\.)linkedin\.com$/i.test(url.hostname)) return false;
    const hasPath = /\/jobs\/view\/\d+/.test(url.pathname);
    const hasQueryId = /^\d+$/.test(url.searchParams.get("currentJobId") ?? "");
    const hasCollectionsJob = /\/jobs\/collections\/.*currentJobId=\d+/.test(url.toString());
    return hasPath || hasQueryId || hasCollectionsJob;
  },
  extract: (doc, url) => {
    const workplace = firstText(doc, WORKPLACE_SELECTORS);
    const location = firstText(doc, LOCATION_SELECTORS);

    return {
      jobTitle: firstText(doc, TITLE_SELECTORS),
      company: firstText(doc, COMPANY_SELECTORS),
      location: location ?? workplace,
      workMode: detectWorkMode(workplace ?? location),
      postedAt: firstText(doc, POSTED_SELECTORS),
      url: canonicalUrl(url),
    };
  },
};
