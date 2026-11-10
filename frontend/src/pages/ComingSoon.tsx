import { Link } from "react-router-dom";
import { AmbientCanvas } from "../components/AmbientCanvas";
import { Arrow, Back } from "../components/icons";
import { TopBar } from "../components/TopBar";
import { WORLDS, type WorldInfo } from "../worlds";

export default function ComingSoon({ world }: { world: WorldInfo }) {
  const ready = WORLDS.filter((w) => w.ready);
  return (
    <div className="home">
      <AmbientCanvas count={9000} />
      <TopBar />
      <main className="soon">
        <p className="eyebrow">World {world.number}</p>
        <h1>{world.name}</h1>
        <p className="card-tagline">{world.tagline}</p>
        <p className="lead">{world.description}</p>
        <p className="badge">This world is still being built</p>
        <div className="cta">
          {ready.map((w) => (
            <Link key={w.id} className="btn primary" to={w.path}>
              Try {w.name} <Arrow />
            </Link>
          ))}
          <Link className="btn ghost" to="/">
            <Back /> All worlds
          </Link>
        </div>
      </main>
    </div>
  );
}
