export function acquisitionTemplate(type: "welcome" | "day_1" | "day_3" | "beta_access", firstName: string | null, unsubscribeUrl: string) {
  const name = firstName ? ` ${firstName}` : "";
  const copy = type === "welcome" ? `Bienvenue${name} dans la bêta Talvia.` : type === "day_1" ? `Bonjour${name}, Talvia se construit avec ses premiers utilisateurs.` : type === "day_3" ? `Bonjour${name}, merci de suivre la bêta Talvia.` : `Bonjour${name}, votre accès bêta Talvia est ouvert.`;
  return { subject: type === "beta_access" ? "Votre accès bêta Talvia" : "Bienvenue dans la bêta Talvia", text: `${copy}\n\nSe désinscrire : ${unsubscribeUrl}`, html: `<main style="font-family:Arial,sans-serif;line-height:1.5;color:#17212b"><h1>${copy}</h1><p>Nous vous écrirons seulement pour vous tenir informé(e) de la bêta.</p><p><a href="${unsubscribeUrl}">Se désinscrire</a></p></main>` };
}
