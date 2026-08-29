type AcquisitionEmail = { to: string; subject: string; text: string; html: string; unsubscribeUrl: string };

function required(name: "RESEND_API_KEY" | "RESEND_EMAIL_FROM") {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} doit être configurée pour envoyer les e-mails d'acquisition.`);
  return value;
}

export async function sendAcquisitionEmail(email: AcquisitionEmail) {
  const replyTo = process.env.RESEND_EMAIL_REPLY_TO?.trim();
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${required("RESEND_API_KEY")}`, "content-type": "application/json" },
    body: JSON.stringify({ from: required("RESEND_EMAIL_FROM"), to: [email.to], ...(replyTo ? { reply_to: replyTo } : {}), subject: email.subject, text: email.text, html: email.html, headers: { "List-Unsubscribe": `<${email.unsubscribeUrl}>` } }),
  });
  if (!response.ok) throw new Error("Resend n’a pas pu envoyer l’e-mail d’acquisition.");
  const payload = await response.json() as { id?: unknown };
  if (typeof payload.id !== "string" || !payload.id) throw new Error("Resend n’a pas retourné d’identifiant de message.");
  return { providerMessageId: payload.id };
}
