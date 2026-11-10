/** Pure text matching for voice commands, separate from the browser API so it can be tested. */

export type VoiceCommand = "galaxy" | "fire" | "ice" | "rainbow" | "next" | "save";

const PATTERNS: [VoiceCommand, RegExp][] = [
  ["next", /\bnext(\s+world)?\b/],
  ["save", /\b(save|safe|saved)\b/],
  ["galaxy", /\bgalax(y|ies)\b/],
  ["fire", /\b(fire|fires|fiery|flame|flames)\b/],
  ["ice", /\b(ice|eyes|ice cold|frozen|snow)\b/],
  ["rainbow", /\b(rainbow|rainbows)\b/],
];

/** All commands found in a piece of speech, in the order they were spoken. */
export function findCommands(transcript: string): VoiceCommand[] {
  const text = transcript.toLowerCase();
  const found: { command: VoiceCommand; at: number }[] = [];
  for (const [command, pattern] of PATTERNS) {
    const match = pattern.exec(text);
    if (match) found.push({ command, at: match.index });
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.command);
}
