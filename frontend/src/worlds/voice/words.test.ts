import { describe, expect, it } from "vitest";
import { phrasePieces } from "./words";

describe("phrasePieces", () => {
  it("keeps a short phrase together", () => {
    expect(phrasePieces("hello world")).toEqual(["hello world"]);
  });

  it("splits a long phrase into pieces that fit", () => {
    const pieces = phrasePieces("this is a very long sentence that I am saying now");
    expect(pieces.length).toBeLessThanOrEqual(3);
    expect(pieces.every((p) => p.length <= 18)).toBe(true);
    expect(pieces[0]).toBe("this is a very");
  });

  it("ignores extra spaces", () => {
    expect(phrasePieces("  hi   there ")).toEqual(["hi there"]);
  });
});
