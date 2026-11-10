import { Link } from "react-router-dom";
import { AmbientCanvas } from "../components/AmbientCanvas";
import { Arrow } from "../components/icons";
import { TopBar } from "../components/TopBar";
import { WORLDS } from "../worlds";

const STEPS = [
  { title: "Camera", text: "Your webcam picture stays in the browser. Nothing is uploaded." },
  { title: "21 points per hand", text: "MediaPipe finds every joint of up to two hands, 30 times a second." },
  { title: "Gestures", text: "Simple geometry turns the points into fist, open hand, pinch or pointing." },
  { title: "Physics", text: "20,000 particles feel springs, swirls and gravity, then glow with WebGL bloom." },
];

export default function Home() {
  return (
    <div className="home">
      <AmbientCanvas />
      <TopBar />
      <main>
        <section className="hero">
          <p className="eyebrow">Camera · Voice · 20,000 particles</p>
          <h1 className="hero-title">
            AETHER<span className="hero-glow" aria-hidden="true">AETHER</span>
          </h1>
          <p className="lead">
            Shape light with your hands and your voice. No install, no account. Everything runs in your browser.
          </p>
          <div className="cta">
            <Link className="btn primary" to="/hand">
              Enter Hand Magic <Arrow />
            </Link>
            <a className="btn ghost" href="#worlds">
              See all worlds
            </a>
          </div>
          <p className="hint">Move your mouse. The galaxy is alive.</p>
        </section>

        <section id="worlds" className="section">
          <h2>Four worlds</h2>
          <div className="world-grid">
            {WORLDS.map((w) => (
              <Link key={w.id} to={w.path} className={`world-card card-${w.id}`}>
                <div className="card-art" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
                <div className="card-body">
                  <div className="card-top">
                    <span className="world-number">{w.number}</span>
                    <span className={`badge${w.ready ? " badge-ready" : ""}`}>{w.ready ? "Open" : "Coming soon"}</span>
                  </div>
                  <h3>{w.name}</h3>
                  <p className="card-tagline">{w.tagline}</p>
                  <p className="card-text">{w.description}</p>
                  <div className="chips">
                    {w.inputs.map((i) => (
                      <span key={i} className="chip">
                        {i}
                      </span>
                    ))}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>

        <section className="section">
          <h2>How it works</h2>
          <ol className="steps">
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <span className="step-number">{i + 1}</span>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>
      <footer className="footer">
        Built with React, TypeScript, Three.js, MediaPipe and FastAPI · <Link to="/gallery">Gallery</Link>
      </footer>
    </div>
  );
}
