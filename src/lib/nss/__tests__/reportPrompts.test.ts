// Covers managerPronounInstruction, which tells the report-generation LLM
// what pronoun (or name) to use in the manager-facing "managerInsights"
// bullets — the only place in the prompt that uses third-person pronouns.
// A prior version used pronoun.includes("he"), which also matches inside
// "she/her" and inside "they/them" itself ("they" contains the substring
// "he"), so they/them (and, before an earlier fix, she/her) respondents
// got misgendered as he/him in the generated report. It also now falls
// back to the person's name, rather than guessing a pronoun, whenever the
// stored pronoun set isn't recognized as he/she/they (a custom typed
// pronoun set, or "prefer not to say").
import { describe, it, expect } from "vitest";
import { managerPronounInstruction } from "../reportPrompts";

describe("managerPronounInstruction", () => {
  it("they/them resolves to they/their/them, not he/his/him", () => {
    expect(managerPronounInstruction("Jo", "they/them")).toBe("they/their/them pronouns");
  });

  it("she/her resolves to she/her/her", () => {
    expect(managerPronounInstruction("Jo", "she/her")).toBe("she/her/her pronouns");
  });

  it("he/him resolves to he/his/him", () => {
    expect(managerPronounInstruction("Jo", "he/him")).toBe("he/his/him pronouns");
  });

  it("an unrecognized or custom pronoun set falls back to using the person's name", () => {
    expect(managerPronounInstruction("French Fry", "prefer not to say")).toContain('"French Fry"');
    expect(managerPronounInstruction("French Fry", "ze/zir")).toContain('"French Fry"');
  });
});
