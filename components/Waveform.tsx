// Owned by Track B3. Real-time bar waveform fed by an `AnalyserNode`.
// Spec §4.1 / §6: PatientPane top section.
"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface WaveformProps {
  /** Provider for the analyser. We accept the node lazily because the audio
   *  graph is built inside `useStt` after `getUserMedia` resolves. */
  analyser: AnalyserNode | null;
  className?: string;
  /** Bar count; default 64 fits comfortably in the patient pane width. */
  bars?: number;
  /** Fill color CSS string. Default: currentColor for theme inheritance. */
  color?: string;
}

export function Waveform({
  analyser,
  className,
  bars = 64,
  color,
}: WaveformProps): React.ReactElement {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const rafRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // High-DPI sizing.
    const dpr = window.devicePixelRatio || 1;
    const resize = (): void => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const buf = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;

    const draw = (): void => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);

      if (analyser && buf) {
        analyser.getByteFrequencyData(buf);
        const step = Math.max(1, Math.floor(buf.length / bars));
        const barW = w / bars;
        const fill = color ?? (getComputedStyle(canvas).color || "#0ea5e9");
        ctx.fillStyle = fill;
        for (let i = 0; i < bars; i++) {
          // Average the bin slice — smoother than a single sample.
          let sum = 0;
          const from = i * step;
          const to = Math.min(buf.length, from + step);
          for (let j = from; j < to; j++) sum += buf[j];
          const avg = sum / Math.max(1, to - from);
          const norm = avg / 255;
          const barH = Math.max(1, norm * h);
          ctx.fillRect(i * barW + barW * 0.1, h - barH, barW * 0.8, barH);
        }
      } else {
        // Idle baseline.
        const fill = color ?? "rgba(120,120,120,0.35)";
        ctx.fillStyle = fill;
        ctx.fillRect(0, h / 2 - 1, w, 2);
      }
      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, [analyser, bars, color]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label="microphone waveform"
      className={cn("h-16 w-full text-sky-500", className)}
    />
  );
}
