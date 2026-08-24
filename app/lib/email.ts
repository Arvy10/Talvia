type TransactionalEmail = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

function requiredEnvironment(name: "BREVO_API_KEY" | "EMAIL_FROM_ADDRESS") {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`La variable d’environnement ${name} doit être configurée pour envoyer les e-mails.`);
  }
  return value;
}

/** Sends a transactional email through Brevo. This module is server-only. */
export async function sendTransactionalEmail(email: TransactionalEmail) {
  const apiKey = requiredEnvironment("BREVO_API_KEY");
  const senderEmail = requiredEnvironment("EMAIL_FROM_ADDRESS");
  const senderName = process.env.EMAIL_FROM_NAME?.trim() || "Talvia";

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      accept: "application/json",
      "api-key": apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      sender: { name: senderName, email: senderEmail },
      to: [{ email: email.to }],
      subject: email.subject,
      textContent: email.text,
      htmlContent: email.html,
    }),
  });

  if (!response.ok) {
    throw new Error("Brevo n’a pas pu envoyer l’e-mail transactionnel. Vérifiez l’expéditeur dans Brevo.");
  }
}
