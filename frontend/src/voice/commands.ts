/** Pure text matching for voice commands, separate from the browser API so it can be tested. */

export type VoiceCommand =
  | "galaxy"
  | "fire"
  | "ice"
  | "rainbow"
  | "red"
  | "blue"
  | "green"
  | "gold"
  | "undo"
  | "clear"
  | "particles"
  | "matrix"
  | "hologram"
  | "next"
  | "save"
  | "record";

/** The words one world listens to. Speech recognition often hears similar words, so some are accepted too. */
export type Vocabulary = [VoiceCommand, RegExp][];

const NEXT: [VoiceCommand, RegExp] = ["next", /\bnext(\s+world)?\b/];
const SAVE: [VoiceCommand, RegExp] = ["save", /\b(save|safe|saved)\b/];
const RAINBOW: [VoiceCommand, RegExp] = ["rainbow", /\b(rainbow|rainbows)\b/];
const RECORD: [VoiceCommand, RegExp] = ["record", /\b(record|recording|video)\b/];

export const HAND_VOCABULARY: Vocabulary = [
  NEXT,
  SAVE,
  RECORD,
  ["galaxy", /\bgalax(y|ies)\b/],
  ["fire", /\b(fire|fires|fiery|flame|flames)\b/],
  ["ice", /\b(ice|eyes|ice cold|frozen|snow)\b/],
  RAINBOW,
];

export const DRAW_VOCABULARY: Vocabulary = [
  NEXT,
  SAVE,
  RECORD,
  RAINBOW,
  ["red", /\b(red|read)\b/],
  ["blue", /\b(blue|blew)\b/],
  ["green", /\b(green|greens)\b/],
  ["gold", /\b(gold|golden|yellow)\b/],
  ["undo", /\b(undo|under|and do|on do)\b/],
  ["clear", /\b(clear|clean|delete|erase)\b/],
];

export const MIRROR_VOCABULARY: Vocabulary = [
  NEXT,
  SAVE,
  RECORD,
  ["particles", /\b(particles?|parties|particular)\b/],
  ["matrix", /\b(matrix|matrices|metrics)\b/],
  ["hologram", /\b(holograms?|hollow ?grams?)\b/],
];

/** All commands found in a piece of speech, in the order they were spoken. */
export function findCommands(transcript: string, vocabulary: Vocabulary = HAND_VOCABULARY): VoiceCommand[] {
  const text = transcript.toLowerCase();
  const found: { command: VoiceCommand; at: number }[] = [];
  for (const [command, pattern] of vocabulary) {
    const match = pattern.exec(text);
    if (match) found.push({ command, at: match.index });
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.command);
}
