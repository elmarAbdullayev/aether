import { useEffect, useRef, useState, type ReactNode } from "react";
import { voiceSupported, type VoiceState } from "../voice/voice";
import { Camera, Mic } from "./icons";

/** Interface parts every world shares: the start card, the voice box and the gesture bar. */

export type Stage = "intro" | "starting" | "camera" | "mouse";

export function cameraError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError") return "Camera access was blocked. Allow it in the address bar, or play with the mouse.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera found. You can play with the mouse.";
  if (name === "NotReadableError") return "The camera is busy in another app. Close it there and try again.";
  return `Hand tracking could not start (${error instanceof Error ? error.message : String(error)}). Check your internet connection: the hand model loads from Google.`;
}

export function WorldIntro(props: {
  number: string;
  title: string;
  lead: ReactNode;
  stage: Stage;
  error: string | null;
  onStart(withCamera: boolean): void;
  /** this world needs the camera, so there is no mouse button */
  cameraOnly?: boolean;
}) {
  const starting = props.stage === "starting";
  return (
    <div className="intro">
      <div className="intro-card">
        <p className="eyebrow">World {props.number}</p>
        <h1>{props.title}</h1>
        <p className="lead">{props.lead}</p>
        <div className="intro-actions">
          <button type="button" className="btn primary" onClick={() => props.onStart(true)} disabled={starting}>
            <Camera />
            {starting ? "Waking up the camera…" : "Start with camera"}
          </button>
          {!props.cameraOnly && (
            <button type="button" className="btn ghost" onClick={() => props.onStart(false)} disabled={starting}>
              Play with mouse
            </button>
          )}
        </div>
        {props.error && (
          <p className="intro-error" role="alert">
            {props.error}
          </p>
        )}
        <p className="fineprint">
          Your camera picture never leaves this computer: the hand points are found right here in the browser.
          {voiceSupported()
            ? " For voice commands the browser turns your speech into text with its own speech service."
            : " Voice commands need Edge or Chrome."}
        </p>
      </div>
    </div>
  );
}

const STATE_TEXT: Record<VoiceState, string> = {
  starting: "Starting microphone…",
  listening: "Listening",
  off: "Voice off",
  blocked: "Microphone blocked",
  "no-mic": "No microphone found",
  network: "Speech service not reachable",
  unsupported: "Voice needs Edge or Chrome",
  error: "Voice error",
};

const HELP: Partial<Record<VoiceState, string>> = {
  blocked:
    "Click the lock icon left of the address bar and allow the microphone. In Windows also check Settings › Privacy & security › Microphone.",
  "no-mic": "Plug in a microphone, or close apps that use it (Teams, Zoom, Discord…).",
  network: "The browser needs the internet to turn speech into text. Retrying…",
};

export interface VoiceInfo {
  state: VoiceState;
  /** the browser's error code, if any */
  detail?: string;
  /** the speech service hears someone talking */
  talking: boolean;
}

/**
 * Voice status with a live microphone meter. The meter shows if the microphone works at all;
 * the quoted text shows what the speech service understood.
 */
export function VoiceBox({
  voice,
  heard,
  hint,
  readLevel,
}: {
  voice: VoiceInfo;
  heard: string;
  hint: ReactNode;
  readLevel(): number;
}) {
  const problem = HELP[voice.state] ?? (voice.state === "error" && voice.detail ? `Code: ${voice.detail}` : null);
  const title = voice.state === "listening" && voice.talking ? "Hearing you…" : STATE_TEXT[voice.state];
  return (
    <div className="voice-box" data-state={voice.state} data-talking={voice.talking || undefined}>
      <Mic />
      <div>
        <div className="voice-state">
          {title}
          {(voice.state === "listening" || voice.state === "network") && <MicMeter read={readLevel} />}
        </div>
        <div className="voice-hint">{problem ?? (heard ? <>“{heard}”</> : hint)}</div>
      </div>
    </div>
  );
}

/** Five bars that move with the microphone volume. Updated outside React for speed. */
function MicMeter({ read }: { read(): number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const level = read();
      const bars = ref.current?.children;
      if (!bars) return;
      for (let i = 0; i < bars.length; i++) {
        const on = level > (i + 0.5) / (bars.length + 1);
        (bars[i] as HTMLElement).style.opacity = on ? "1" : "0.18";
      }
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [read]);
  return (
    <span className="mic-meter" ref={ref} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

/** The last thing the microphone heard; disappears after a moment. */
export function useHeard(): [string, (text: string) => void] {
  const [heard, setHeard] = useState("");
  useEffect(() => {
    if (!heard) return;
    const t = window.setTimeout(() => setHeard(""), 2600);
    return () => window.clearTimeout(t);
  }, [heard]);
  return [heard, setHeard];
}

export interface GuideItem {
  key: string;
  icon: string;
  label: string;
  hint: string;
  active: boolean;
}

export function GestureGuide({ items }: { items: GuideItem[] }) {
  return (
    <ul className="guide" aria-label="Gestures">
      {items.map((g) => (
        <li key={g.key} className={g.active ? "is-active" : ""} title={g.hint}>
          <span className="guide-icon" aria-hidden="true">
            {g.icon}
          </span>
          <span className="guide-label">{g.label}</span>
          <span className="guide-hint">{g.hint}</span>
        </li>
      ))}
    </ul>
  );
}
