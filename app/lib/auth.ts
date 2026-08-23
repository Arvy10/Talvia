import { betterAuth } from "better-auth";

import { database } from "./database";

const baseURL = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

export const auth = betterAuth({
  database,
  emailAndPassword: {
    enabled: true,
  },
  advanced: {
    database: {
      joins: true,
      generateId: "uuid",
    },
  },
  trustedOrigins: [baseURL],
});
