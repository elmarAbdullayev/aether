import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

interface ToastMessage {
  id: number;
  text: ReactNode;
  tone: "ok" | "error";
}

/** Small message at the bottom that disappears by itself. */
export function useToast(): [ReactNode, (text: ReactNode, tone?: "ok" | "error") => void] {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const show = useCallback((text: ReactNode, tone: "ok" | "error" = "ok") => {
    window.clearTimeout(timer.current);
    setToast({ id: Date.now(), text, tone });
    timer.current = window.setTimeout(() => setToast(null), tone === "error" ? 6000 : 3200);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const node = (
    <div className="toast-area" role="status" aria-live="polite">
      {toast && (
        <div key={toast.id} className={`toast toast-${toast.tone}`}>
          {toast.text}
        </div>
      )}
    </div>
  );
  return [node, show];
}
