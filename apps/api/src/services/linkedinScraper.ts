import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

const LINKEDIN_JOBS_URL = (keywords: string, location?: string) => {
  const params = new URLSearchParams({ keywords });
  if (location) params.set("location", location);
  return `https://www.linkedin.com/jobs/search/?${params.toString()}`;
};

interface ScrapedPost {
  linkedinPostUrl: string;
  recruiterName?: string;
  company?: string;
  title?: string;
  contentSnippet?: string;
  postedAt?: Date;
}

/**
 * Extrae ofertas de empleo públicas de LinkedIn Jobs.
 * No automatiza el login de LinkedIn; lee contenido público de la búsqueda de empleos.
 */
export async function scrapeLinkedInPosts(
  keywords: string,
  location?: string,
  maxPosts = 20,
): Promise<ScrapedPost[]> {
  const browser: Browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  let context: BrowserContext | null = null;
  try {
    context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0 Safari/537.36",
    });
    const page: Page = await context.newPage();

    const url = LINKEDIN_JOBS_URL(keywords, location);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

    // Esperar a que carguen los resultados de empleos
    await page.waitForTimeout(5000);

    const posts = await page.evaluate((maxPosts: number) => {
      const results: ScrapedPost[] = [];
      const doc: any = (globalThis as any).document;

      // Selectores de tarjetas de empleo en LinkedIn Jobs
      const cards = doc.querySelectorAll(
        ".base-card, .job-search-card, .jobs-search-results__list-item",
      );

      for (const card of cards) {
        if (results.length >= maxPosts) break;

        // Enlace al empleo
        const linkEl = card.querySelector('a[href*="/jobs/view/"]');
        const url = linkEl?.getAttribute("href") || "";
        if (!url) continue;

        const fullUrl = url.startsWith("http")
          ? url
          : `https://www.linkedin.com${url}`;

        // Título del empleo
        const titleEl =
          card.querySelector(".base-search-card__title") ||
          card.querySelector(".job-search-card__title") ||
          card.querySelector("h3");
        const title = titleEl?.textContent?.trim() || undefined;

        // Empresa
        const companyEl =
          card.querySelector(".base-search-card__subtitle") ||
          card.querySelector(".job-search-card__subtitle") ||
          card.querySelector(".job-search-card__company-name");
        const company = companyEl?.textContent?.trim() || undefined;

        // Ubicación
        const locationEl =
          card.querySelector(".base-search-card__metadata") ||
          card.querySelector(".job-search-card__location");
        const locationText = locationEl?.textContent?.trim() || undefined;

        // Fecha de publicación
        const timeEl = card.querySelector("time");
        const postedAt = timeEl?.getAttribute("datetime")
          ? new Date(timeEl.getAttribute("datetime"))
          : undefined;

        // El "reclutador" en este contexto es la empresa que publica
        const recruiterName = company;

        results.push({
          linkedinPostUrl: fullUrl,
          recruiterName,
          company,
          title,
          contentSnippet: locationText ? `Ubicación: ${locationText}` : undefined,
          postedAt,
        });
      }

      return results;
    }, maxPosts);

    return posts;
  } finally {
    if (context) await context.close();
    await browser.close();
  }
}
