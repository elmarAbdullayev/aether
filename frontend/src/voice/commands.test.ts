import { describe, expect, it } from "vitest";
import { findCommands } from "./commands";

describe("findCommands", () => {
  it.each([
    ["Fire", ["fire"]],
    ["make it galaxy", ["galaxy"]],
    ["ice and then rainbow", ["ice", "rainbow"]],
    ["next world please", ["next"]],
    ["save this one", ["save"]],
    ["safe", ["save"]],
    ["that is nice", []],
    ["hello", []],
  ])("%s", (text, expected) => {
    expect(findCommands(text)).toEqual(expected);
  });
});
