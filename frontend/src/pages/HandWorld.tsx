import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { saveImage } from "../api/gallery";
import { Image, Video } from "../components/icons";
import { useToast } from "../components/Toast";
import { TopBar } from "../components/TopBar";
import {
  cameraError,
  GestureGuide,
  useHeard,
  VoiceBox,
  WorldIntro,
  type Stage,
  type VoiceInfo,
} from "../components/WorldHud";
import { createElements, ELEMENT_ORDER, type ElementName } from "../engine/elements";
import { useSettings } from "../settings";
import type { Gesture } from "../vision/gestures";
import type { VoiceCommand } from "../voice/commands";
import type { VoiceState } from "../voice/voice";
import { HandSession } from "../worlds/hand/session";
import { nextWorld } from "../worlds";

const ELEMENTS = createElements();

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
  const [voice, setVoice] = useState<VoiceInfo>({ state: "off", talking: false });
  const readLevel = useCallback(() => sessionRef.current?.micLevel() ?? 0, []);
  const [heard, setHeard] = useHeard();
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
      voiceState: (state: VoiceState, detail?: string) => setVoice((v) => ({ ...v, state, detail })),
      talking: (talking) => setVoice((v) => ({ ...v, talking })),
      heard: setHeard,
      command: (c) => commandRef.current(c),
    });
    sessionRef.current = session;
    return () => {
      session.dispose();
      sessionRef.current = null;
    };
  }, [setHeard]);

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
    else if ((ELEMENT_ORDER as string[]).includes(command)) session.setElement(command as ElementName);
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

  const freeHands = gestures.filter((g) => g !== "fist" && g !== "pinch").length;
  const guide = [
    { key: "point", icon: "☝️", label: "Move", hint: "Particles follow your finger", active: freeHands === 1 },
    { key: "fist", icon: "✊", label: "Black hole", hint: "Make a fist and hold it", active: gestures.includes("fist") },
    { key: "open", icon: "🖐️", label: "Explode", hint: "Open the fist fast", active: gestures.includes("open") },
    { key: "pinch", icon: "🤏", label: "Grab a star", hint: "Pinch, move, let go to throw", active: gestures.includes("pinch") },
    { key: "zoom", icon: "🙌", label: "Zoom", hint: "Two hands apart or together", active: freeHands >= 2 },
  ];
  const playing = stage === "camera" || stage === "mouse";

  return (
    <div className="world" style={{ ["--accent" as string]: ELEMENTS[element].accent }}>
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

          <VoiceBox
            voice={voice}
            readLevel={readLevel}
            heard={heard}
            hint={<>Say “fire”, “ice”, “galaxy”, “rainbow”, “save” or “next world”</>}
          />
          <GestureGuide items={guide} />

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
        <WorldIntro
          number="01"
          title="Hand Magic"
          lead="Twenty thousand particles listen to your hand. Make a fist to open a black hole, open it to explode the universe, pinch a star and throw it."
          stage={stage}
          error={error}
          onStart={(withCamera) => void start(withCamera)}
        />
      )}
      {toast}
    </div>
  );
}
