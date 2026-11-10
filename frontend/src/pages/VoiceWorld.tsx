import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { saveImage } from "../api/gallery";
import { Image, Record } from "../components/icons";
import { RecIndicator, useClipRecorder } from "../components/Recorder";
import { useToast } from "../components/Toast";
import { TopBar } from "../components/TopBar";
import { GestureGuide, micError, useHeard, VoiceBox, WorldIntro, type Stage, type VoiceInfo } from "../components/WorldHud";
import { useSettings } from "../settings";
import { pitchName } from "../voice/analysis";
import type { VoiceCommand } from "../voice/commands";
import type { VoiceState } from "../voice/voice";
import type { Weather } from "../worlds/voice/scene";
import { VoiceWorldSession } from "../worlds/voice/session";
import { nextWorld } from "../worlds";

const WEATHER: { kind: Weather; label: string; icon: string; color: string }[] = [
  { kind: "rain", label: "Rain", icon: "🌧️", color: "#5ab8ff" },
  { kind: "snow", label: "Snow", icon: "❄️", color: "#e8f4ff" },
  { kind: "moon", label: "Moon", icon: "🌙", color: "#fff2b0" },
  { kind: "storm", label: "Storm", icon: "⚡", color: "#c49bff" },
];

/** Loudness bar and pitch, updated straight from the frame loop (no React re-render). */
function VoiceMeters({ read }: { read(): { level: number; pitch: number | null } | null }) {
  const bar = useRef<HTMLSpanElement>(null);
  const pitch = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let frame = 0;
    let shown = "";
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const r = read();
      if (bar.current) bar.current.style.transform = `scaleX(${Math.min(1, (r?.level ?? 0) * 1.4)})`;
      const text = r?.pitch ? `${Math.round(r.pitch)} Hz · ${pitchName(r.pitch)}` : "—";
      if (pitch.current && text !== shown) {
        shown = text;
        pitch.current.textContent = text;
      }
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [read]);
  return (
    <div className="meters" aria-hidden="true">
      <div>
        <span className="meter-label">Loudness</span>
        <span className="meter-track">
          <span className="meter-fill" ref={bar} />
        </span>
      </div>
      <div>
        <span className="meter-label">Pitch</span>
        <span className="meter-value" ref={pitch}>
          —
        </span>
      </div>
    </div>
  );
}

export default function VoiceWorld() {
  const navigate = useNavigate();
  const { muted, calm } = useSettings();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sessionRef = useRef<VoiceWorldSession | null>(null);
  const commandRef = useRef<(c: VoiceCommand) => void>(() => {});

  const [stage, setStage] = useState<Stage>("intro");
  const [error, setError] = useState<string | null>(null);
  const [silent, setSilent] = useState(false);
  const [splash, setSplash] = useState<{ id: number; text: string } | null>(null);
  const [voice, setVoice] = useState<VoiceInfo>({ state: "off", talking: false });
  const readLevel = useCallback(() => sessionRef.current?.micLevel() ?? 0, []);
  const readMeters = useCallback(() => sessionRef.current?.reading ?? null, []);
  const [heard, setHeard] = useHeard();
  const [flash, setFlash] = useState(0);
  const [toast, showToast] = useToast();

  useEffect(() => {
    const session = new VoiceWorldSession(canvasRef.current!, {
      silent: setSilent,
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

  const weather = useCallback((kind: Weather) => {
    sessionRef.current?.sound.unlock();
    sessionRef.current?.setWeather(kind);
    setSplash({ id: Date.now(), text: WEATHER.find((w) => w.kind === kind)!.label });
  }, []);

  const save = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    const image = session.capture();
    setFlash((f) => f + 1);
    try {
      await saveImage("voice", image);
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
    world: "voice",
    canvas: () => sessionRef.current?.scene.stage.canvas ?? null,
    audio: () => sessionRef.current?.sound.captureStream() ?? null,
    poster: () => sessionRef.current?.capture(true) ?? null,
    toast: showToast,
  });
  const recordRef = useRef(clip.record);
  recordRef.current = clip.record;

  commandRef.current = (command) => {
    if (command === "save") void save();
    else if (command === "record") clip.record();
    else if (command === "next") navigate(nextWorld("voice").path);
    else if (command === "rain" || command === "snow" || command === "moon" || command === "storm") weather(command);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target instanceof Element && e.target.closest("input, textarea")) return;
      const index = ["1", "2", "3", "4"].indexOf(e.key);
      const key = e.key.toLowerCase();
      if (index >= 0) weather(WEATHER[index].kind);
      else if (key === "s") void save();
      else if (key === "r") recordRef.current();
      else if (key === "n") navigate(nextWorld("voice").path);
      else return;
      sessionRef.current?.sound.unlock();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, navigate, weather]);

  async function start() {
    const session = sessionRef.current;
    if (!session) return;
    session.sound.unlock();
    session.setMuted(muted);
    setError(null);
    setStage("starting");
    try {
      await session.start();
      setStage("mouse");
    } catch (e) {
      setError(micError(e));
      setStage("intro");
    }
  }

  const guide = [
    { key: "loud", icon: "🔊", label: "Loud = mountains", hint: "Speak, sing or whistle louder", active: false },
    { key: "pitch", icon: "🎵", label: "Low / high = colors", hint: "A low voice paints red, a high voice blue", active: false },
    { key: "words", icon: "💬", label: "Words fly", hint: "Everything you say flies over the land", active: voice.talking },
  ];
  const playing = stage === "mouse";

  return (
    <div className="world" style={{ ["--accent" as string]: "#ff5fd2" }}>
      <canvas ref={canvasRef} className="world-canvas" />
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
            <span className="world-number">04</span> Voice World
          </div>

          <div className="elements" role="group" aria-label="Magic words">
            {WEATHER.map((w, i) => (
              <button
                key={w.kind}
                type="button"
                className="element-pill"
                style={{ ["--pill" as string]: w.color }}
                onClick={() => weather(w.kind)}
                title={`Say “${w.kind}”`}
              >
                <span aria-hidden="true">{w.icon}</span>
                {w.label}
                <kbd>{i + 1}</kbd>
              </button>
            ))}
            <VoiceMeters read={readMeters} />
          </div>

          <VoiceBox
            voice={voice}
            readLevel={readLevel}
            heard={heard}
            hint={<>Say anything. Magic words: “rain”, “snow”, “moon”, “storm”</>}
          />
          <GestureGuide items={guide} />
          {silent && <p className="hand-hint">Sing, speak or whistle 🎤</p>}
        </>
      )}

      {!playing && (
        <WorldIntro
          number="04"
          title="Voice World"
          lead="Fly over a neon land that your voice builds. Loud makes mountains, low and high notes paint the sky, and every word you say flies past you in letters of light."
          stage={stage}
          error={error}
          micOnly
          onStart={() => void start()}
        />
      )}
      <RecIndicator secondsLeft={clip.secondsLeft} />
      {toast}
    </div>
  );
}
