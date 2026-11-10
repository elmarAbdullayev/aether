import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { saveImage } from "../api/gallery";
import { Image, Record } from "../components/icons";
import { RecIndicator, useClipRecorder } from "../components/Recorder";
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
import { useSettings } from "../settings";
import type { Gesture } from "../vision/gestures";
import type { VoiceCommand } from "../voice/commands";
import type { VoiceState } from "../voice/voice";
import { MirrorSession } from "../worlds/mirror/session";
import { STYLE_ORDER, STYLES, type MirrorStyle } from "../worlds/mirror/scene";
import { nextWorld } from "../worlds";

export default function MirrorWorld() {
  const navigate = useNavigate();
  const { muted, calm } = useSettings();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const sessionRef = useRef<MirrorSession | null>(null);
  const commandRef = useRef<(c: VoiceCommand) => void>(() => {});

  const [stage, setStage] = useState<Stage>("intro");
  const [error, setError] = useState<string | null>(null);
  const [style, setStyle] = useState<MirrorStyle>("particles");
  const [splash, setSplash] = useState<{ id: number; text: string } | null>(null);
  const [gestures, setGestures] = useState<Gesture[]>([]);
  const [person, setPerson] = useState(true);
  const [voice, setVoice] = useState<VoiceInfo>({ state: "off", talking: false });
  const readLevel = useCallback(() => sessionRef.current?.micLevel() ?? 0, []);
  const [heard, setHeard] = useHeard();
  const [flash, setFlash] = useState(0);
  const [toast, showToast] = useToast();

  useEffect(() => {
    const session = new MirrorSession(canvasRef.current!, {
      style: (s) => {
        setStyle(s);
        setSplash({ id: Date.now(), text: STYLES[s].label });
      },
      gestures: setGestures,
      person: setPerson,
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

  const save = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    const image = session.capture();
    setFlash((f) => f + 1);
    try {
      await saveImage("mirror", image);
      showToast(
        <>
          Saved. <Link to="/gallery">Open the gallery</Link>
        </>,
      );
    } catch (e) {
      showToast(`Could not save: ${e instanceof Error ? e.message : e}`, "error");
    }
  }, [showToast]);

  const clip = useClipRecorder({
    world: "mirror",
    canvas: () => sessionRef.current?.scene.stage.canvas ?? null,
    audio: () => sessionRef.current?.sound.captureStream() ?? null,
    poster: () => sessionRef.current?.capture(true) ?? null,
    toast: showToast,
  });
  const recordRef = useRef(clip.record);
  recordRef.current = clip.record;

  commandRef.current = (command) => {
    const session = sessionRef.current;
    if (!session) return;
    if (command === "save") void save();
    else if (command === "record") clip.record();
    else if (command === "next") navigate(nextWorld("mirror").path);
    else if ((STYLE_ORDER as string[]).includes(command)) session.setStyle(command as MirrorStyle);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target instanceof Element && e.target.closest("input, textarea")) return;
      const index = ["1", "2", "3"].indexOf(e.key);
      const key = e.key.toLowerCase();
      if (index >= 0) sessionRef.current?.setStyle(STYLE_ORDER[index]);
      else if (e.key === "ArrowRight") sessionRef.current?.stepStyle(1);
      else if (e.key === "ArrowLeft") sessionRef.current?.stepStyle(-1);
      else if (key === "s") void save();
      else if (key === "r") recordRef.current();
      else if (key === "n") navigate(nextWorld("mirror").path);
      else return;
      sessionRef.current?.sound.unlock();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, navigate]);

  async function start() {
    const session = sessionRef.current;
    if (!session) return;
    session.sound.unlock();
    session.setMuted(muted);
    setError(null);
    setStage("starting");
    try {
      await session.start(videoRef.current!);
      setStage("camera");
    } catch (e) {
      setError(cameraError(e));
      setStage("intro");
      return;
    }
    session.startVoice();
  }

  const guide = [
    { key: "swipe", icon: "👋", label: "Change style", hint: "Wave your hand quickly to the left or right", active: false },
    { key: "fist", icon: "✊", label: "Turn to dust", hint: "Make a fist", active: gestures.includes("fist") },
    { key: "open", icon: "🖐️", label: "Rebuild", hint: "Open your hand", active: gestures.includes("open") },
  ];
  const playing = stage === "camera";

  return (
    <div className="world" style={{ ["--accent" as string]: STYLES[style].accent }}>
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
          <>
            <button
              type="button"
              className={`icon-btn rec-btn${clip.secondsLeft !== null ? " is-on" : ""}`}
              onClick={clip.record}
              title="Record a 5 second video (R)"
            >
              <Record />
              <span className="sr-only">Record video</span>
            </button>
            <button type="button" className="icon-btn" onClick={() => void save()} title="Save picture to gallery (S)">
              <Image />
              <span className="sr-only">Save picture</span>
            </button>
          </>
        )}
      </TopBar>

      {playing && (
        <>
          <div className="world-title">
            <span className="world-number">03</span> Hologram Mirror
          </div>

          <div className="elements" role="group" aria-label="Style">
            {STYLE_ORDER.map((name, i) => (
              <button
                key={name}
                type="button"
                className={`element-pill${name === style ? " is-active" : ""}`}
                style={{ ["--pill" as string]: STYLES[name].accent }}
                onClick={() => {
                  sessionRef.current?.sound.unlock();
                  sessionRef.current?.setStyle(name);
                }}
                aria-pressed={name === style}
              >
                <span className="pill-dot" />
                {STYLES[name].label}
                <kbd>{i + 1}</kbd>
              </button>
            ))}
          </div>

          <VoiceBox
            voice={voice}
            readLevel={readLevel}
            heard={heard}
            hint={<>Say “particles”, “matrix”, “hologram”, “save” or “record”</>}
          />
          <GestureGuide items={guide} />
          {!person && <p className="hand-hint">Step in front of the camera 🧍</p>}
        </>
      )}

      {!playing && (
        <WorldIntro
          number="03"
          title="Hologram Mirror"
          lead="The camera turns you into light: glowing particles, falling green letters or a flickering blue hologram. Wave to change the style, make a fist to fall apart into dust."
          stage={stage}
          error={error}
          cameraOnly
          onStart={() => void start()}
        />
      )}
      <RecIndicator secondsLeft={clip.secondsLeft} />
      {toast}
    </div>
  );
}
