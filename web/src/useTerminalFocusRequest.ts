import { useEffect, useRef } from "react";

/** Retries are for mobile keyboards; desktop defaults must yield to subsequent clicks. */
export function useTerminalFocusRequest(token: number, focus: () => void, retry: boolean) {
  const retryRef = useRef(retry);
  retryRef.current = retry;

  useEffect(() => {
    if (token === 0) return;
    const frame = window.requestAnimationFrame(focus);
    const timers = (retryRef.current ? [80, 220] : []).map((delay) =>
      window.setTimeout(focus, delay),
    );
    return () => {
      window.cancelAnimationFrame(frame);
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [focus, token]);
}
