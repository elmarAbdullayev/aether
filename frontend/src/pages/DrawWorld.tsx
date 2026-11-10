import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { saveImage } from "../api/gallery";
import { Image, Trash, Undo, Video } from "../components/icons";
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
import { BRUSH_ORDER, BRUSHES, type BrushColor } from "../engine/sculpture";
import { useSettings } from "../settings";
import type { Gesture } from "../vision/gestures";
import type { VoiceCommand } from "../voice/commands";
import type { VoiceState } from "../voice/voice";
import { DrawSession } from "../worlds/draw/session";
import { nextWorld } from "../worlds";

export default function DrawWorld() {
  const navigate = useNavigate();
  const { muted, calm } = useSettings();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const sessionRef = useRef<DrawSession | null>(null);
  const commandRef = useRef<(c: VoiceCommand) => void>(() => {});

  const [stage, setStage] = useState<Stage>("intro");
  const [error, setError] = useState<string | null>(null);
  const [brush, setBrush] = useState<BrushColor>("rainbow");
  const [strokes, setStrokes] = useState(0);
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
    const session = new DrawSession(canvasRef.current!, {
      gestures: setGestures,
      handsVisible: setHandsVisible,
      brush: (b) => {
        setBrush(b);
        setSplash({ id: Date.now(), text: BRUSHES[b].label });
      },
      strokes: setStrokes,
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
    const { image, sculpture } = session.capture();
    setFlash((f) => f + 1);
    try {
      await saveImage("draw", image, sculpture);
      showToast(
        <>
          {sculpture ? "Saved in 3D." : "Picture saved."} <Link to="/gallery">Open the gallery</Link>
        </>,
      );
    } catch (e) {
      showToast(`Could not save: ${e instanceof Error ? e.message : e}. Is the Aether server running?`, "error");
    }
  }, [showToast]);

  const undo = useCallback(() => {
    sessionRef.current?.sound.unlock();
    sessionRef.current?.undo();
  }, []);

  const clear = useCallback(() => {
    sessionRef.current?.sound.unlock();
    sessionRef.current?.clear();
  }, []);

  commandRef.current = (command) => {
    const session = sessionRef.current;
    if (!session) return;
    if (command === "save") void save();
    else if (command === "next") navigate(nextWorld("draw").path);
    else if (command === "undo") undo();
    else if (command === "clear") clear();
    else if ((BRUSH_ORDER as string[]).includes(command)) session.setBrush(command as BrushColor);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target instanceof Element && e.target.closest("input, textarea")) return;
      const index = ["1", "2", "3", "4", "5"].indexOf(e.key);
      const key = e.key.toLowerCase();
      if (index >= 0) sessionRef.current?.setBrush(BRUSH_ORDER[index]);
      else if (key === "z" || e.key === "Backspace") undo();
      else if (key === "x" || e.key === "Delete") clear();
      else if (key === "s") void save();
      else if (key === "c") setPreview((p) => !p);
      else if (key === "n") navigate(nextWorld("draw").path);
      else return;
      e.preventDefault();
      sessionRef.current?.sound.unlock();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, undo, clear, navigate]);

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
    { key: "draw", icon: "🤏", label: "Draw", hint: "Pinch thumb and index finger, then move", active: gestures.includes("pinch") },
    { key: "turn", icon: "✊", label: "Turn", hint: "Make a fist and move it. Let go to spin", active: gestures.includes("fist") },
    { key: "zoom", icon: "🙌", label: "Zoom", hint: "Two open hands apart or together", active: freeHands >= 2 },
  ];
  const playing = stage === "camera" || stage === "mouse";

  return (
    <div className="world" style={{ ["--accent" as string]: BRUSHES[brush].css }}>
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
            <button type="button" className="icon-btn" onClick={undo} disabled={!strokes} title="Undo last line (Z)">
              <Undo />
              <span className="sr-only">Undo</span>
            </button>
            <button type="button" className="icon-btn" onClick={clear} disabled={!strokes} title="Clear everything (X)">
              <Trash />
              <span className="sr-only">Clear</span>
            </button>
            <button type="button" className="icon-btn" onClick={() => void save()} title="Save picture and 3D sculpture (S)">
              <Image />
              <span className="sr-only">Save</span>
            </button>
          </>
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
            <span className="world-number">02</span> Air Drawing
          </div>

          <div className="elements" role="group" aria-label="Brush color">
            {BRUSH_ORDER.map((name, i) => (
              <button
                key={name}
                type="button"
                className={`element-pill${name === brush ? " is-active" : ""}`}
                style={{ ["--pill" as string]: BRUSHES[name].css }}
                onClick={() => {
                  sessionRef.current?.sound.unlock();
                  sessionRef.current?.setBrush(name);
                }}
                aria-pressed={name === brush}
              >
                <span className={`pill-dot${name === "rainbow" ? " pill-rainbow" : ""}`} />
                {BRUSHES[name].label}
                <kbd>{i + 1}</kbd>
              </button>
            ))}
          </div>

          <VoiceBox
            voice={voice}
            readLevel={readLevel}
            heard={heard}
            hint={<>Say “red”, “blue”, “green”, “gold”, “rainbow”, “undo”, “clear” or “save”</>}
          />
          <GestureGuide items={guide} />

          {strokes === 0 && (
            <p className="draw-hint">
              {stage === "camera"
                ? "Pinch thumb and index finger together and draw in the air ✍️"
                : "Hold the left mouse button and draw ✍️"}
            </p>
          )}
          {stage === "mouse" && (
            <p className="mouse-hint">
              Mouse: left button = draw · right button = turn · wheel = zoom · Z = undo · X = clear
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
          number="02"
          title="Air Drawing"
          lead="Pinch your fingers and paint light into the air. The sculpture turns while you draw, so every line becomes a real 3D shape. Turn it with your fist and save it in 3D."
          stage={stage}
          error={error}
          onStart={(withCamera) => void start(withCamera)}
        />
      )}
      {toast}
    </div>
  );
}
