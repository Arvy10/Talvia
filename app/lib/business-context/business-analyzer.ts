import { getAIProvider, type AIProvider } from "../ai";
import { extractPage, isContentSufficient } from "./content-extractor";
import { businessAnalysisSchema, validateBusinessAnalysisResult, type BusinessAnalysisResult } from "./types";
import { fetchPageSafely, FetchFailedError, UnsafeUrlError } from "./website-fetcher";

const CANDIDATE_PATHS = ["", "/about", "/about-us", "/services", "/pricing"];
const MAX_PAGES = 4;
const MAX_TOTAL_CHARS = 24_000;

export type AnalysisSuccess = {
  status: "ready";
  result: BusinessAnalysisResult;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
  sourcePages: string[];
  contentChars: number;
  pagesFetched: number;
};

export type AnalysisFailure = {
  status: "error" | "insufficient_content" | "unavailable";
  reason: string;
  pagesFetched: number;
  contentChars: number;
};

export type AnalysisOutcome = AnalysisSuccess | AnalysisFailure;

function toAbsolute(baseUrl: string, path: string): string {
  return new URL(path, baseUrl).toString();
}

// The homepage is fetched first and is required (its failure aborts the
// whole analysis with a specific reason). The remaining candidate pages
// are then fetched CONCURRENTLY rather than one after another — with 5
// candidate paths and an 8s per-request timeout, a sequential crawl could
// take up to ~40s even on a healthy site; in parallel it's bounded by the
// single slowest request instead.
async function collectPages(website: string): Promise<{ pages: { url: string; text: string }[]; pagesFetched: number }> {
  const targets = Array.from(new Set(CANDIDATE_PATHS.map((path) => toAbsolute(website, path))));
  const [homepageTarget, ...secondaryTargets] = targets;

  const homepage = await fetchPageSafely(homepageTarget!);
  let pagesFetched = 1;
  const pages: { url: string; text: string }[] = [];
  let totalChars = 0;

  const homepageExtracted = extractPage(homepage.url, homepage.html);
  if (homepageExtracted.text.length >= 40) {
    pages.push(homepageExtracted);
    totalChars += homepageExtracted.text.length;
  }

  const secondaryResults = await Promise.allSettled(secondaryTargets.map((target) => fetchPageSafely(target)));
  for (const result of secondaryResults) {
    if (pages.length >= MAX_PAGES || totalChars >= MAX_TOTAL_CHARS) break;
    if (result.status !== "fulfilled") continue; // secondary pages are best-effort
    pagesFetched += 1;
    const extracted = extractPage(result.value.url, result.value.html);
    if (extracted.text.length < 40) continue;
    pages.push(extracted);
    totalChars += extracted.text.length;
  }

  return { pages, pagesFetched };
}

function buildPrompt(pages: { url: string; text: string }[]): string {
  const sections = pages.map((page) => `### Page: ${page.url}\n${page.text.slice(0, MAX_TOTAL_CHARS)}`);
  return sections.join("\n\n");
}

const SYSTEM_PROMPT = `Tu es un analyste qui construit le profil commercial d'une entreprise à partir du contenu brut de son site web.

Règles strictes :
- N'invente jamais d'information absente du contenu fourni.
- "companyName", "businessDescription", "services", "products", "keywords" doivent venir directement du texte (des faits observés), pas de suppositions.
- Pour chaque champ noté "provenance", utilise "fact" uniquement si le texte l'affirme explicitement, "inference" si tu le déduis raisonnablement du contexte, "suggestion" si c'est une recommandation commerciale que tu proposes (ex: painPoints, salesAngles) plutôt qu'un constat.
- "confidence" doit refléter honnêtement ton incertitude (0 à 1).
- Si le contenu fourni est trop pauvre, contradictoire, ou ressemble à une page vide/JS non rendue, mets "insufficientContent" à true et reste minimal sur les autres champs plutôt que d'halluciner.
- Réponds uniquement selon le schéma demandé.`;

export async function analyzeBusinessFromWebsite(website: string, provider?: AIProvider | null): Promise<AnalysisOutcome> {
  const aiProvider = provider === undefined ? getAIProvider() : provider;
  if (!aiProvider) {
    return { status: "unavailable", reason: "Aucun fournisseur IA n'est configuré.", pagesFetched: 0, contentChars: 0 };
  }

  let pages: { url: string; text: string }[];
  let pagesFetched: number;
  try {
    const collected = await collectPages(website);
    pages = collected.pages;
    pagesFetched = collected.pagesFetched;
  } catch (error) {
    if (error instanceof UnsafeUrlError) {
      return { status: "error", reason: error.message, pagesFetched: 0, contentChars: 0 };
    }
    if (error instanceof FetchFailedError) {
      return { status: "error", reason: error.message, pagesFetched: 0, contentChars: 0 };
    }
    return { status: "error", reason: "Échec inattendu lors de la récupération du site.", pagesFetched: 0, contentChars: 0 };
  }

  const contentChars = pages.reduce((sum, page) => sum + page.text.length, 0);
  const combinedText = pages.map((page) => page.text).join(" ");
  if (pages.length === 0 || !isContentSufficient(combinedText)) {
    return { status: "insufficient_content", reason: "Le contenu récupéré est insuffisant pour une analyse fiable.", pagesFetched, contentChars };
  }

  let generation;
  try {
    generation = await aiProvider.generateStructured<unknown>({
      system: SYSTEM_PROMPT,
      prompt: buildPrompt(pages),
      schemaName: "business_analysis",
      schema: businessAnalysisSchema,
      maxTokens: 4096,
    });
  } catch (error) {
    return {
      status: "error",
      reason: error instanceof Error ? error.message : "Échec de l'appel au fournisseur IA.",
      pagesFetched,
      contentChars,
    };
  }

  const validated = validateBusinessAnalysisResult(generation.data);
  if (!validated) {
    return { status: "error", reason: "La réponse du modèle ne correspond pas au schéma attendu.", pagesFetched, contentChars };
  }
  if (validated.insufficientContent) {
    return { status: "insufficient_content", reason: "Le modèle juge le contenu du site insuffisant.", pagesFetched, contentChars };
  }

  return {
    status: "ready",
    result: validated,
    model: generation.model,
    usage: generation.usage,
    sourcePages: pages.map((page) => page.url),
    contentChars,
    pagesFetched,
  };
}
