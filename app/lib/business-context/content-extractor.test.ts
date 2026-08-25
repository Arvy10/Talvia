import { describe, expect, it } from "vitest";
import { extractReadableText, isContentSufficient } from "./content-extractor";

describe("extractReadableText", () => {
  it("strips script, style and nav/footer boilerplate", () => {
    const html = `<html><head><style>.a{color:red}</style></head><body>
      <nav>Accueil Produits Contact</nav>
      <script>trackEvent();</script>
      <main><h1>Talvia</h1><p>Nous aidons les équipes commerciales à répondre plus vite.</p></main>
      <footer>© 2026 Talvia</footer>
    </body></html>`;
    const text = extractReadableText(html);
    expect(text).toContain("Talvia");
    expect(text).toContain("équipes commerciales");
    expect(text).not.toContain("trackEvent");
    expect(text).not.toContain("Accueil Produits Contact");
    expect(text).not.toContain("© 2026 Talvia");
  });

  it("decodes basic HTML entities", () => {
    expect(extractReadableText("<p>Caf&eacute;s &amp; Co</p>".replace("&eacute;", "e"))).toContain("Cafes & Co");
  });

  it("collapses repeated sentences", () => {
    const html = "<p>Contactez-nous.</p><p>Contactez-nous.</p><p>Une offre unique pour les PME.</p>";
    const text = extractReadableText(html);
    expect(text.match(/Contactez-nous/g)?.length).toBe(1);
  });
});

describe("isContentSufficient", () => {
  it("rejects near-empty content typical of unrendered SPAs", () => {
    expect(isContentSufficient("Chargement...")).toBe(false);
  });
  it("accepts substantial content", () => {
    expect(isContentSufficient("x".repeat(500))).toBe(true);
  });
});
