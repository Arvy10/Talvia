import { betterAuth } from "better-auth";

import { database } from "./database";
import { sendTransactionalEmail } from "./email";

const baseURL = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

export const auth = betterAuth({
  database,
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
  },
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendTransactionalEmail({
        to: user.email,
        subject: "Confirmez votre adresse e-mail — Talvia",
        text: `Bienvenue sur Talvia. Confirmez votre adresse e-mail pour activer votre espace : ${url}`,
        html: `<main style="font-family:Arial,sans-serif;color:#17212b;line-height:1.5"><h1>Confirmez votre adresse e-mail</h1><p>Bienvenue sur Talvia. Confirmez votre adresse e-mail pour activer votre espace.</p><p><a href="${url}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#1f6f62;color:#fff;text-decoration:none">Confirmer mon adresse e-mail</a></p><p style="font-size:13px;color:#5f6b76">Ce lien expire dans une heure. Si vous n’avez pas créé de compte Talvia, vous pouvez ignorer cet e-mail.</p></main>`,
      });
    },
    afterEmailVerification: async (user) => {
      const { ensureWorkspaceForUser } = await import("./workspace-context");
      await ensureWorkspaceForUser({ id: user.id, email: user.email, name: user.name });
    },
  },
  advanced: {
    database: {
      joins: true,
      generateId: "uuid",
    },
  },
  trustedOrigins: [baseURL, "http://127.0.0.1:3000"],
});
