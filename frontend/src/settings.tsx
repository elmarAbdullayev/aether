import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

interface Settings {
  muted: boolean;
  calm: boolean;
  toggleMuted(): void;
  toggleCalm(): void;
}

const SettingsContext = createContext<Settings | null>(null);
const KEY = "aether.settings";

function load(): { muted: boolean; calm: boolean } {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const value = JSON.parse(raw) as Partial<{ muted: boolean; calm: boolean }>;
      return { muted: value.muted === true, calm: value.calm === true };
    }
  } catch {
    /* storage blocked: use defaults */
  }
  return { muted: false, calm: false };
}

/** Sound on/off and calm mode, remembered in this browser. Animations stay on unless calm mode is chosen. */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(load);

  useEffect(() => {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
    document.documentElement.dataset.calm = state.calm ? "on" : "off";
  }, [state]);

  const toggleMuted = useCallback(() => setState((s) => ({ ...s, muted: !s.muted })), []);
  const toggleCalm = useCallback(() => setState((s) => ({ ...s, calm: !s.calm })), []);
  const value = useMemo(() => ({ ...state, toggleMuted, toggleCalm }), [state, toggleMuted, toggleCalm]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): Settings {
  const value = useContext(SettingsContext);
  if (!value) throw new Error("useSettings needs <SettingsProvider>");
  return value;
}
