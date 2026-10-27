// Covers possessiveForm, used in the "Tips for Helping {firstName} Meet
// {possessiveForm} Needs" manager-facing heading. A prior version used
// pronouns.includes("he"), which also matches inside "they/them" itself
// ("they" contains the substring "he"), so a they/them respondent's report
// showed "His Needs" instead of "Their Needs". It now also falls back to
// the person's name, rather than guessing a pronoun, whenever the pronoun
// set isn't recognized as he/she/they (a custom typed pronoun set, "prefer
// not to say", or no pronoun on file).
import { describe, it, expect } from "vitest";
import { possessiveForm } from "../ReportView";

describe("possessiveForm", () => {
  it("they/them resolves to Their, not His", () => {
    expect(possessiveForm("French Fry", "they/them")).toBe("Their");
  });

  it("she/her resolves to Her", () => {
    expect(possessiveForm("French Fry", "she/her")).toBe("Her");
  });

  it("he/him resolves to His", () => {
    expect(possessiveForm("French Fry", "he/him")).toBe("His");
  });

  it("null, undefined, or an unrecognized pronoun set falls back to the person's name", () => {
    expect(possessiveForm("French Fry", null)).toBe("French Fry's");
    expect(possessiveForm("French Fry", undefined)).toBe("French Fry's");
    expect(possessiveForm("French Fry", "prefer not to say")).toBe("French Fry's");
    expect(possessiveForm("French Fry", "ze/zir")).toBe("French Fry's");
  });
});
