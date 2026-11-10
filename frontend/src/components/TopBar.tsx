import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { useSettings } from "../settings";
import { Calm, SoundOff, SoundOn, Sparkle } from "./icons";

/** Logo, navigation and the two global switches (sound, calm mode). */
export function TopBar({ children }: { children?: ReactNode }) {
  const { muted, calm, toggleMuted, toggleCalm } = useSettings();
  return (
    <header className="topbar">
      <Link to="/" className="logo" aria-label="Aether home">
        <span className="logo-orb" aria-hidden="true" />
        AETHER
      </Link>
      <nav className="topnav" aria-label="Main">
        <NavLink to="/hand">Hand Magic</NavLink>
        <NavLink to="/gallery">Gallery</NavLink>
      </nav>
      <div className="topbar-actions">
        {children}
        <button
          type="button"
          className="icon-btn"
          onClick={toggleMuted}
          aria-pressed={muted}
          title={muted ? "Sound is off" : "Sound is on"}
        >
          {muted ? <SoundOff /> : <SoundOn />}
          <span className="sr-only">{muted ? "Turn sound on" : "Turn sound off"}</span>
        </button>
        <button
          type="button"
          className={`icon-btn${calm ? " is-on" : ""}`}
          onClick={toggleCalm}
          aria-pressed={calm}
          title={calm ? "Calm mode is on: slower, softer effects" : "Calm mode: slower, softer effects"}
        >
          {calm ? <Calm /> : <Sparkle />}
          <span className="sr-only">Calm mode</span>
        </button>
      </div>
    </header>
  );
}
