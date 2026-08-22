import { describe, expect, it } from "vitest";

import { AUTOMATION_TEMPLATES } from "./templates";

describe("AUTOMATION_TEMPLATES", () => {
  it("keeps every template addressable by a unique workflow id", () => {
    const ids = AUTOMATION_TEMPLATES.map((template) => template.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses a supported product channel for every workflow", () => {
    expect(AUTOMATION_TEMPLATES.map((template) => template.channel)).toEqual(
      expect.arrayContaining(["linkedin", "whatsapp", "gmail"]),
    );
    expect(AUTOMATION_TEMPLATES.every((template) => ["linkedin", "whatsapp", "gmail"].includes(template.channel))).toBe(true);
  });

  it("describes reusable capabilities without fabricated activity or recipients", () => {
    const copy = AUTOMATION_TEMPLATES.map(({ title, description, trigger, action }) => `${title} ${description} ${trigger} ${action}`).join(" ");

    expect(copy).not.toMatch(/\b(\d+|un|une|deux|trois|premier|première)\b/i);
    expect(copy).not.toMatch(/\b(jean|marie|sophie|paul|acme|talvia|inc|sarl|sas)\b/i);
    expect(copy).not.toMatch(/\b(gagn|augment|résultat|conversion|prospect|client|destinataire)\w*/i);
    expect(copy).toMatch(/automati/i);
  });
});
