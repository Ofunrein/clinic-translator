// Owned by Track B3. Singleton AudioContext + audio output device routing.
// Spec §6 (AudioPlayer barge-in), §7 (autoplay policy banner).
"use client";

import * as React from "react";

export interface AudioContextValue {
  /** Lazy-instantiated. Null until first user interaction or `ensure()`. */
  audioContext: AudioContext | null;
  /** True when the underlying AudioContext is suspended (browser autoplay policy). */
  isSuspended: boolean;
  /** Resume the AudioContext after a user gesture. */
  resume: () => Promise<void>;
  /** Construct (if needed) and return the AudioContext. */
  ensure: () => AudioContext;
  /** Current output deviceId for `setSinkId`, or `"default"`. */
  outputDeviceId: string;
  setOutputDeviceId: (id: string) => void;
}

const Ctx = React.createContext<AudioContextValue | null>(null);

interface WindowWithWebkit extends Window {
  webkitAudioContext?: typeof AudioContext;
}

function constructAudioContext(): AudioContext {
  const w = window as WindowWithWebkit;
  const Ctor = window.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) {
    throw new Error("AudioContext is not supported in this browser");
  }
  return new Ctor();
}

export interface AudioContextProviderProps {
  children: React.ReactNode;
}

export function AudioContextProvider({
  children,
}: AudioContextProviderProps): React.ReactElement {
  const ctxRef = React.useRef<AudioContext | null>(null);
  const [audioContext, setAudioContext] = React.useState<AudioContext | null>(null);
  const [isSuspended, setIsSuspended] = React.useState(false);
  const [outputDeviceId, setOutputDeviceId] = React.useState<string>("default");

  const ensure = React.useCallback((): AudioContext => {
    if (!ctxRef.current) {
      const ac = constructAudioContext();
      ctxRef.current = ac;
      setAudioContext(ac);
      setIsSuspended(ac.state === "suspended");
      ac.onstatechange = () => {
        setIsSuspended(ac.state === "suspended");
      };
    }
    return ctxRef.current;
  }, []);

  const resume = React.useCallback(async (): Promise<void> => {
    const ac = ensure();
    if (ac.state === "suspended") {
      await ac.resume();
    }
    setIsSuspended(ac.state === "suspended");
  }, [ensure]);

  const value = React.useMemo<AudioContextValue>(
    () => ({
      audioContext,
      isSuspended,
      resume,
      ensure,
      outputDeviceId,
      setOutputDeviceId,
    }),
    [audioContext, isSuspended, resume, ensure, outputDeviceId],
  );

  React.useEffect(() => {
    return () => {
      // Best-effort cleanup; ignore close failure on already-closed contexts.
      if (ctxRef.current && ctxRef.current.state !== "closed") {
        void ctxRef.current.close().catch(() => {});
      }
    };
  }, []);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAudioContext(): AudioContextValue {
  const v = React.useContext(Ctx);
  if (!v) {
    throw new Error("useAudioContext must be used within <AudioContextProvider>");
  }
  return v;
}
