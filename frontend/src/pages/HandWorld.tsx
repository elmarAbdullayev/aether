import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { saveImage } from "../api/gallery";
import { Camera, Image, Mic, Video } from "../components/icons";
import { useToast } from "../components/Toast";
import { TopBar } from "../components/TopBar";
import { createElements, ELEMENT_ORDER, type ElementName } from "../engine/elements";
import { useSettings } from "../settings";
import type { Gesture } from "../vision/gestures";
import type { VoiceCommand } from "../voice/commands";
import { voiceSupported, type VoiceState } from "../voice/voice";
import { HandSession } from "../worlds/hand/session";
import { nextWorld } from "../worlds";

const ELEMENTS = createElements();

const GUIDE: { key: Gesture | "zoom"; icon: string; label: string; hint: string }[] = [
  { key: "point", icon: "☝️", label: "Move", hint: "Particles follow your finger" },
  { key: "fist", icon: "✊", label: "Black hole", hint: "Make a fist and hold it" },
  { key: "open", icon: "🖐️", label: "Explode", hint: "Open the fist fast" },
  { key: "pinch", icon: "🤏", label: "Grab a star", hint: "Pinch, move, let go to throw" },
  { key: "zoom", icon: "🙌", label: "Zoom", hint: "Two hands apart or together" },
];

type Stage = "intro" | "starting" | "camera" | "mouse";

function cameraError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError") return "Camera access was blocked. Allow it in the address bar, or play with the mouse.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera found. You can play with the mouse.";
  if (name === "NotReadableError") return "The camera is busy in another app. Close it there and try again.";
  return `Hand tracking could not start (${error instanceof Error ? error.message : String(error)}). Check your internet connection: the hand model loads once from Google.`;
}

export default function HandWorld() {
  const navigate = useNavigate();
  const { muted, calm } = useSettings();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const sessionRef = useRef<HandSession | null>(null);
  const commandRef = useRef<(c: VoiceCommand) => void>(() => {});

  const [stage, setStage] = useState<Stage>("intro");
  const [error, setError] = useState<string | null>(null);
  const [element, setElement] = useState<ElementName>("galaxy");
  const [splash, setSplash] = useState<{ id: number; text: string } | null>(null);
  const [gestures, setGestures] = useState<Gesture[]>([]);
  const [handsVisible, setHandsVisible] = useState(true);
  const [voice, setVoice] = useState<VoiceState>("off");
  const [heard, setHeard] = useState("");
  const [preview, setPreview] = useState(true);
  const [flash, setFlash] = useState(0);
  const [toast, showToast] = useToast();

  useEffect(() => {
    const session = new HandSession(canvasRef.current!, {
      gestures: setGestures,
      handsVisible: setHandsVisible,
      element: (name) => {
        setElement(name);
        setSplash({ id: Date.now(), text: ELEMENTS[name].label });
      },
      voiceState: setVoice,
      heard: setHeard,
      command: (c) => commandRef.current(c),
    });
    sessionRef.current = session;
    return () => {
      session.dispose();
      sessionRef.current = null;
    };
  }, []);

  useEffect(() => sessionRef.current?.setCalm(calm), [calm]);
  useEffect(() => sessionRef.current?.setMuted(muted), [muted]);
  useEffect(() => {
    sessionRef.current?.setPreview(preview && stage === "camera" ? previewRef.current : null);
  }, [preview, stage]);

  const save = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    const image = session.capture();
    setFlash((f) => f + 1);
    try {
      await saveImage("hand", image);
      showToast(
        <>
          Saved. <Link to="/gallery">Open the gallery</Link>
        </>,
      );
    } catch (e) {
      showToast(`Could not save: ${e instanceof Error ? e.message : e}. Is the Aether server running?`, "error");
    }
  }, [showToast]);

  commandRef.current = (command) => {
    const session = sessionRef.current;
    if (!session) return;
    if (command === "save") void save();
    else if (command === "next") navigate(nextWorld("hand").path);
    else session.setElement(command);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target instanceof Element && e.target.closest("input, textarea")) return;
      const index = ["1", "2", "3", "4"].indexOf(e.key);
      if (index >= 0) sessionRef.current?.setElement(ELEMENT_ORDER[index]);
      else if (e.key === "s" || e.key === "S") void save();
      else if (e.key === "c" || e.key === "C") setPreview((p) => !p);
      else if (e.key === "n" || e.key === "N") navigate(nextWorld("hand").path);
      else return;
      sessionRef.current?.sound.unlock();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, navigate]);

  useEffect(() => {
    if (!heard) return;
    const t = window.setTimeout(() => setHeard(""), 2600);
    return () => window.clearTimeout(t);
  }, [heard]);

  async function start(withCamera: boolean) {
    const session = sessionRef.current;
    if (!session) return;
    session.sound.unlock();
    session.setMuted(muted);
    setError(null);
    if (withCamera) {
      setStage("starting");
      try {
        await session.startCamera(videoRef.current!);
        setStage("camera");
      } catch (e) {
        setError(cameraError(e));
        setStage("intro");
        return;
      }
    } else {
      setStage("mouse");
    }
    session.startVoice();
  }

  const moving = gestures.some((g) => g !== "fist" && g !== "pinch");
  const freeHands = gestures.filter((g) => g !== "fist" && g !== "pinch").length;
  const isActive = (key: Gesture | "zoom") =>
    key === "zoom" ? freeHands >= 2 : key === "point" ? moving && freeHands < 2 : gestures.includes(key);
  const accent = ELEMENTS[element].accent;
  const playing = stage === "camera" || stage === "mouse";

  return (
    <div className="world" style={{ ["--accent" as string]: accent }}>
      <canvas ref={canvasRef} className="world-canvas" />
      <video ref={videoRef} className="hidden-video" muted playsInline />
      {flash > 0 && <div key={flash} className="flash" aria-hidden="true" />}
      {splash && (
        <div key={splash.id} className="splash" aria-hidden="true">
          {splash.text}
        </div>
      )}

      <TopBar>
        {playing && (
          <button type="button" className="icon-btn" onClick={() => void save()} title="Save picture to gallery (S)">
            <Image />
            <span className="sr-only">Save picture</span>
          </button>
        )}
        {stage === "camera" && (
          <button
            type="button"
            className={`icon-btn${preview ? " is-on" : ""}`}
            onClick={() => setPreview((p) => !p)}
            aria-pressed={preview}
            title="Show camera picture (C)"
          >
            <Video />
            <span className="sr-only">Camera picture</span>
          </button>
        )}
      </TopBar>

      {playing && (
        <>
          <div className="world-title">
            <span className="world-number">01</span> Hand Magic
          </div>

          <div className="elements" role="group" aria-label="Element">
            {ELEMENT_ORDER.map((name, i) => (
              <button
                key={name}
                type="button"
                className={`element-pill${name === element ? " is-active" : ""}`}
                style={{ ["--pill" as string]: ELEMENTS[name].accent }}
                onClick={() => {
                  sessionRef.current?.sound.unlock();
                  sessionRef.current?.setElement(name);
                }}
                aria-pressed={name === element}
              >
                <span className="pill-dot" />
                {ELEMENTS[name].label}
                <kbd>{i + 1}</kbd>
              </button>
            ))}
          </div>

          <div className="voice-box" data-state={voice}>
            <Mic />
            <div>
              <div className="voice-state">
                {voice === "listening" && "Listening"}
                {voice === "off" && "Voice off"}
                {voice === "blocked" && "Microphone blocked"}
                {voice === "unsupported" && "Voice needs Edge or Chrome"}
                {voice === "error" && "Voice paused, retrying"}
              </div>
              <div className="voice-hint">
                {heard ? <>“{heard}”</> : <>Say “fire”, “ice”, “galaxy”, “rainbow”, “save” or “next world”</>}
              </div>
            </div>
          </div>

          <ul className="guide" aria-label="Gestures">
            {GUIDE.map((g) => (
              <li key={g.key} className={isActive(g.key) ? "is-active" : ""} title={g.hint}>
                <span className="guide-icon" aria-hidden="true">
                  {g.icon}
                </span>
                <span className="guide-label">{g.label}</span>
                <span className="guide-hint">{g.hint}</span>
              </li>
            ))}
          </ul>

          {stage === "mouse" && (
            <p className="mouse-hint">
              Mouse: move · hold left button = black hole · let go = explosion · right button = grab and throw a star ·
              wheel = zoom
            </p>
          )}
          {stage === "camera" && !handsVisible && <p className="hand-hint">Show your hand to the camera ✋</p>}
          {stage === "camera" && (
            <canvas
              ref={previewRef}
              className={`preview${preview ? "" : " is-hidden"}`}
              width={256}
              height={144}
              aria-label="Your camera with the detected hand points"
            />
          )}
        </>
      )}

      {!playing && (
        <div className="intro">
          <div className="intro-card">
            <p className="eyebrow">World 01</p>
            <h1>Hand Magic</h1>
            <p className="lead">
              Twenty thousand particles listen to your hand. Make a fist to open a black hole, open it to explode the
              universe, pinch a star and throw it.
            </p>
            <div className="intro-actions">
              <button type="button" className="btn primary" onClick={() => void start(true)} disabled={stage === "starting"}>
                <Camera />
                {stage === "starting" ? "Waking up the camera…" : "Start with camera"}
              </button>
              <button type="button" className="btn ghost" onClick={() => void start(false)} disabled={stage === "starting"}>
                Play with mouse
              </button>
            </div>
            {error && (
              <p className="intro-error" role="alert">
                {error}
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
      )}
      {toast}
    </div>
  );
}
