import { describe, expect, it } from "vitest";

import { productNavigation } from "./navigation";

describe("productNavigation", () => {
  it("exposes the product routes in their intended order", () => {
    expect(productNavigation.map((item) => item.href)).toEqual([
      "/app",
      "/app/inbox",
      "/app/opportunities",
      "/app/contacts",
      "/app/automations",
      "/app/connections",
      "/app/settings",
    ]);
  });

  it("gives every destination a French label and icon component", () => {
    for (const item of productNavigation) {
      expect(item.label).toMatch(/[À-ÿA-Za-z]/);
      expect(item.icon).toBeDefined();
    }
  });
});
