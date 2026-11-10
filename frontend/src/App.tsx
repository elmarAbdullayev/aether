import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { SettingsProvider } from "./settings";
import { WORLDS } from "./worlds";

const Home = lazy(() => import("./pages/Home"));
const HandWorld = lazy(() => import("./pages/HandWorld"));
const DrawWorld = lazy(() => import("./pages/DrawWorld"));
const Gallery = lazy(() => import("./pages/Gallery"));
const ComingSoon = lazy(() => import("./pages/ComingSoon"));

export default function App() {
  return (
    <SettingsProvider>
      <BrowserRouter>
        <Suspense fallback={<div className="loading" aria-label="Loading" />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/hand" element={<HandWorld />} />
            <Route path="/draw" element={<DrawWorld />} />
            {WORLDS.filter((w) => !w.ready).map((w) => (
              <Route key={w.id} path={w.path} element={<ComingSoon world={w} />} />
            ))}
            <Route path="/gallery" element={<Gallery />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </SettingsProvider>
  );
}
