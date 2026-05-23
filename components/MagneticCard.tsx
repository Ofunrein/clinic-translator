"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

const CARD_SURFACE = cn(
  "rounded-2xl border-0 bg-card text-card-foreground",
  "shadow-[0_10px_40px_-12px_rgba(15,23,42,0.18)]",
  "dark:shadow-[0_16px_48px_-14px_rgba(0,0,0,0.65)]",
);

type MagneticCardProps = {
  children: React.ReactNode;
  className?: string;
  /** Tilt + pull strength in px/deg scale */
  intensity?: number;
};

export function MagneticCard({
  children,
  className,
  intensity = 16,
}: MagneticCardProps): React.JSX.Element {
  const ref = React.useRef<HTMLDivElement>(null);
  const frame = React.useRef<number | null>(null);
  const [style, setStyle] = React.useState<React.CSSProperties>({
    transition: "transform 0.5s cubic-bezier(0.22, 1, 0.36, 1)",
  });
  const [spot, setSpot] = React.useState({ x: 50, y: 50, on: false });

  const reset = React.useCallback(() => {
    setStyle({
      transform: "perspective(900px) rotateX(0deg) rotateY(0deg) translate3d(0, 0, 0)",
      transition: "transform 0.55s cubic-bezier(0.22, 1, 0.36, 1)",
    });
    setSpot((s) => ({ ...s, on: false }));
  }, []);

  const onMove = React.useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = ref.current;
      if (!el) return;
      if (frame.current) cancelAnimationFrame(frame.current);

      frame.current = requestAnimationFrame(() => {
        const rect = el.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const px = x / rect.width - 0.5;
        const py = y / rect.height - 0.5;

        const rotateX = (-py * intensity * 0.55).toFixed(2);
        const rotateY = (px * intensity * 0.55).toFixed(2);
        const tx = (px * intensity * 0.4).toFixed(2);
        const ty = (py * intensity * 0.4).toFixed(2);

        setStyle({
          transform: `perspective(900px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translate3d(${tx}px, ${ty}px, 0)`,
          transition: "none",
        });
        setSpot({
          x: (x / rect.width) * 100,
          y: (y / rect.height) * 100,
          on: true,
        });
      });
    },
    [intensity],
  );

  React.useEffect(() => {
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, []);

  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={reset}
      className={cn("group relative will-change-transform", CARD_SURFACE, className)}
      style={style}
    >
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 rounded-[inherit] transition-opacity duration-300",
          spot.on ? "opacity-100" : "opacity-0",
        )}
        style={{
          background: `radial-gradient(circle at ${spot.x}% ${spot.y}%, rgba(255,255,255,0.22) 0%, transparent 58%)`,
        }}
      />
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute -inset-px rounded-[inherit] transition-opacity duration-300",
          spot.on ? "opacity-100" : "opacity-0",
        )}
        style={{
          background: `radial-gradient(circle at ${spot.x}% ${spot.y}%, rgba(8,145,178,0.14) 0%, transparent 65%)`,
        }}
      />
      {children}
    </div>
  );
}

export { CARD_SURFACE };
