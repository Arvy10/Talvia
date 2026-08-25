import { lookup as dnsLookup } from "node:dns/promises";
import * as http from "node:http";
import * as https from "node:https";
import { URL } from "node:url";

import { isBlockedIp, isLiteralIpHostname } from "./ip-guard";

const USER_AGENT = "TalviaBot/1.0 (+https://talvia.io; business context analysis)";
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2 MB
const MAX_REDIRECTS = 3;
const ALLOWED_CONTENT_TYPES = ["text/html", "application/xhtml+xml"];

export class UnsafeUrlError extends Error {}
export class FetchFailedError extends Error {}

export type FetchedPage = { url: string; html: string; contentType: string };

function assertPublicHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("URL invalide.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError("Seuls les protocoles http et https sont autorisés.");
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "0.0.0.0") {
    throw new UnsafeUrlError("Les adresses locales ne sont pas autorisées.");
  }
  if (isLiteralIpHostname(hostname)) {
    const bare = hostname.replace(/^\[|\]$/g, "");
    if (isBlockedIp(bare)) throw new UnsafeUrlError("Cette adresse IP n'est pas autorisée.");
  }
  return url;
}

// Resolves DNS ourselves and validates every candidate IP *before* the
// socket connects, then pins the connection to that exact IP via a custom
// `lookup` — the standard http/https resolver never runs again for this
// request, so a DNS answer that changes between check and connect
// (rebinding) can't smuggle a private IP through.
async function resolvePinnedAddress(hostname: string): Promise<{ address: string; family: number }> {
  if (isLiteralIpHostname(hostname)) {
    const bare = hostname.replace(/^\[|\]$/g, "");
    if (isBlockedIp(bare)) throw new UnsafeUrlError("Cette adresse IP n'est pas autorisée.");
    return { address: bare, family: bare.includes(":") ? 6 : 4 };
  }
  let records;
  try {
    records = await dnsLookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new FetchFailedError("Résolution DNS impossible.");
  }
  if (records.length === 0) throw new FetchFailedError("Résolution DNS impossible.");
  for (const record of records) {
    if (isBlockedIp(record.address)) throw new UnsafeUrlError("Ce nom de domaine pointe vers une adresse non autorisée.");
  }
  return records[0]!;
}

function fetchOnce(url: URL, pinned: { address: string; family: number }): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const request = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
        timeout: REQUEST_TIMEOUT_MS,
        // Pin the connection to the pre-validated IP; the original hostname
        // is still sent via SNI/Host so the site resolves normally.
        lookup: (_hostname, _options, callback) => {
          callback(null, pinned.address, pinned.family);
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let received = 0;
        response.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received > MAX_RESPONSE_BYTES) {
            response.destroy();
            reject(new FetchFailedError("Réponse trop volumineuse."));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks) }));
        response.on("error", () => reject(new FetchFailedError("Erreur réseau pendant la lecture de la réponse.")));
      },
    );
    request.on("timeout", () => request.destroy(new FetchFailedError("Délai dépassé.")));
    request.on("error", (error) => reject(error instanceof FetchFailedError ? error : new FetchFailedError("Erreur réseau.")));
    request.end();
  });
}

// Fetches one page, following same-validation-per-hop redirects. Never
// trust a redirect target just because the page that issued it was safe.
export async function fetchPageSafely(rawUrl: string): Promise<FetchedPage> {
  let current = assertPublicHttpUrl(rawUrl);
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const pinned = await resolvePinnedAddress(current.hostname);
    const response = await fetchOnce(current, pinned);

    if (response.status >= 300 && response.status < 400 && response.headers.location) {
      if (redirectCount === MAX_REDIRECTS) throw new FetchFailedError("Trop de redirections.");
      current = assertPublicHttpUrl(new URL(response.headers.location, current).toString());
      continue;
    }

    if (response.status < 200 || response.status >= 300) {
      throw new FetchFailedError(`Le site a répondu avec le statut ${response.status}.`);
    }

    const contentType = (response.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
    if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
      throw new FetchFailedError("Type de contenu non pris en charge.");
    }

    return { url: current.toString(), html: response.body.toString("utf-8"), contentType };
  }
  throw new FetchFailedError("Trop de redirections.");
}
