import { describe, expect, it } from "vitest";
import { DRAW_VOCABULARY, findCommands, HAND_VOCABULARY, MIRROR_VOCABULARY, VOICE_VOCABULARY } from "./commands";

describe("findCommands in Voice World", () => {
  it.each([
    ["let it rain", ["rain"]],
    ["snow please", ["snow"]],
    ["the moon", ["moon"]],
    ["thunder and lightning", ["storm"]],
    ["hello world", []],
  ])("%s", (text, expected) => {
    expect(findCommands(text, VOICE_VOCABULARY)).toEqual(expected);
  });
});

describe("findCommands in Hologram Mirror", () => {
  it.each([
    ["matrix", ["matrix"]],
    ["show the particles", ["particles"]],
    ["hologram please", ["hologram"]],
    ["record a video", ["record"]],
    ["red", []],
  ])("%s", (text, expected) => {
    expect(findCommands(text, MIRROR_VOCABULARY)).toEqual(expected);
  });
});

describe("findCommands in Hand Magic", () => {
  it.each([
    ["Fire", ["fire"]],
    ["make it galaxy", ["galaxy"]],
    ["ice and then rainbow", ["ice", "rainbow"]],
    ["next world please", ["next"]],
    ["save this one", ["save"]],
    ["safe", ["save"]],
    ["that is nice", []],
    ["hello", []],
    ["red", []],
  ])("%s", (text, expected) => {
    expect(findCommands(text, HAND_VOCABULARY)).toEqual(expected);
  });
});

describe("findCommands in Air Drawing", () => {
  it.each([
    ["red", ["red"]],
    ["now blue", ["blue"]],
    ["golden", ["gold"]],
    ["green then rainbow", ["green", "rainbow"]],
    ["undo", ["undo"]],
    ["clear everything", ["clear"]],
    ["save", ["save"]],
    ["fire", []],
    ["thank you", []],
  ])("%s", (text, expected) => {
    expect(findCommands(text, DRAW_VOCABULARY)).toEqual(expected);
  });
});
