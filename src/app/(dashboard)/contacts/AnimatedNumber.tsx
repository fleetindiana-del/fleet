"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Animated 0 -> target count, eased out. Re-plays whenever `target` changes,
 * so it doubles as a visible confirmation that something actually updated
 * (a filter, a fresh sync count) rather than being pure decoration.
 * Shared by the page header and the Insights KPI tiles so there's one
 * implementation of the easing/timing, not two drifting copies.
 */
export function useCountUp(target: number, durationMs = 700): number {
  const [value, setValue] = useState(0);
  const fromRef = useRef(0);

  useEffect(() => {
    const from = fromRef.current;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = Math.round(from + (target - from) * eased);
      setValue(next);
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);

  return value;
}

export function AnimatedNumber({
  value,
  durationMs = 700,
  className,
}: {
  value: number;
  durationMs?: number;
  className?: string;
}) {
  const animated = useCountUp(value, durationMs);
  return <span className={className}>{animated.toLocaleString()}</span>;
}
