import type { Contact, Opportunity, SandboxMessage } from "../state/types";

export type ReplyMode = "generate" | "shorter" | "professional" | "natural" | "warmer" | "direct";
export type ReplyContext = { conversation: SandboxMessage[]; contact?: Contact; opportunity?: Opportunity; currentDraft?: string };

export function generateReply(context: ReplyContext, mode: ReplyMode): string {
  const firstName = context.contact?.name.split(" ")[0] ?? "bonjour";
  const latest = [...context.conversation].reverse().find((message) => message.direction === "inbound")?.body;
  const base = context.currentDraft?.trim() || (latest ? `Bonjour ${firstName}, merci pour votre retour. Je vous propose que nous échangions sur la prochaine étape.` : `Bonjour ${firstName}, je souhaitais revenir vers vous afin de poursuivre notre échange.`);
  if (mode === "shorter") return `Bonjour ${firstName}, merci pour votre retour. Pouvons-nous échanger sur la suite ?`;
  if (mode === "professional") return `Bonjour ${firstName}, merci pour votre retour. Je reste à votre disposition afin de convenir ensemble de la prochaine étape.`;
  if (mode === "natural") return `Bonjour ${firstName}, merci pour votre retour ! On peut regarder la suite ensemble quand vous le souhaitez.`;
  if (mode === "warmer") return `Bonjour ${firstName}, ravi d’avoir de vos nouvelles ! Je serais heureux que nous avancions ensemble sur la suite.`;
  if (mode === "direct") return `Bonjour ${firstName}, merci. Êtes-vous disponible pour définir la prochaine étape ?`;
  return base;
}
