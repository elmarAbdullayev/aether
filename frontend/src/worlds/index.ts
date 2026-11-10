import type { WorldId } from "../api/gallery";

export interface WorldInfo {
  id: WorldId;
  path: string;
  number: string;
  name: string;
  tagline: string;
  description: string;
  inputs: string[];
  ready: boolean;
}

/** In build order. "next world" goes through them in this order. */
export const WORLDS: WorldInfo[] = [
  {
    id: "hand",
    path: "/hand",
    number: "01",
    name: "Hand Magic",
    tagline: "Bend a galaxy with your fingers.",
    description:
      "Twenty thousand particles follow your hand. Make a fist to open a black hole, open your hand to make it explode, pinch a star and throw it.",
    inputs: ["Camera", "Voice"],
    ready: true,
  },
  {
    id: "draw",
    path: "/draw",
    number: "02",
    name: "Air Drawing",
    tagline: "Paint light into the air.",
    description: "Draw with your index finger in the air. Your lines float as a neon sculpture you can turn with the other hand.",
    inputs: ["Camera"],
    ready: false,
  },
  {
    id: "mirror",
    path: "/mirror",
    number: "03",
    name: "Hologram Mirror",
    tagline: "Become a being of light.",
    description: "The camera turns you into a hologram made of particles or falling letters. Change the style with a gesture.",
    inputs: ["Camera"],
    ready: false,
  },
  {
    id: "voice",
    path: "/voice",
    number: "04",
    name: "Voice World",
    tagline: "Your voice grows a living landscape.",
    description: "Speak loud and mountains rise. High and low notes paint the sky. Your words turn into glowing objects.",
    inputs: ["Voice"],
    ready: false,
  },
];

export function nextWorld(id: WorldId): WorldInfo {
  const at = WORLDS.findIndex((w) => w.id === id);
  return WORLDS[(at + 1) % WORLDS.length];
}
