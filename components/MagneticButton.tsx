"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type MagneticButtonProps = {
  children: React.ReactNode;
  className?: string;
  /** Tilt + pull strength; smaller than cards for compact targets */
  intensity?: number;
};

export function MagneticButton({
  children,
  className,
  intensity = 10,
}: MagneticButtonProps): React.JSX.Element {
  const ref = React.useRef<HTMLDivElement>(null);
  const frame = React.useRef<number | null>(null);
  const [style, setStyle] = React.useState<React.CSSProperties>({
    transition: "transform 0.45s cubic-bezier(0.22, 1, 0.36, 1)",
  });
  const [spot, setSpot] = React.useState({ x: 50, y: 50, on: false });

  const reset = React.useCallback(() => {
    setStyle({
      transform: "perspective(700px) rotateX(0deg) rotateY(0deg) translate3d(0, 0, 0)",
      transition: "transform 0.5s cubic-bezier(0.22, 1, 0.36, 1)",
    });
    setSpot((s) => ({ ...s, on: false }));
  }, []);

  const onMove = React.useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = ref.current;
      if (!el) return;
      const { clientX, clientY } = e;
      if (frame.current !== null) cancelAnimationFrame(frame.current);

      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        const rect = el.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;
        const px = x / rect.width - 0.5;
        const py = y / rect.height - 0.5;

        const rotateX = (-py * intensity * 0.5).toFixed(2);
        const rotateY = (px * intensity * 0.5).toFixed(2);
        const tx = (px * intensity * 0.35).toFixed(2);
        const ty = (py * intensity * 0.35).toFixed(2);

        setStyle({
          transform: `perspective(700px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translate3d(${tx}px, ${ty}px, 0)`,
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
      if (frame.current !== null) {
        cancelAnimationFrame(frame.current);
        frame.current = null;
      }
    };
  }, []);

  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={reset}
      className={cn("group relative inline-block will-change-transform", className)}
      style={style}
    >
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 rounded-[inherit] transition-opacity duration-300",
          spot.on ? "opacity-100" : "opacity-0",
        )}
        style={{
          background: `radial-gradient(circle at ${spot.x}% ${spot.y}%, rgba(255,255,255,0.28) 0%, transparent 55%)`,
        }}
      />
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute -inset-px rounded-[inherit] transition-opacity duration-300",
          spot.on ? "opacity-100" : "opacity-0",
        )}
        style={{
          background: `radial-gradient(circle at ${spot.x}% ${spot.y}%, rgba(8,145,178,0.18) 0%, transparent 60%)`,
        }}
      />
      {children}
    </div>
  );
}
