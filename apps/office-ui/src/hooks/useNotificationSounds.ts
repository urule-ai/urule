"use client";

import { useEffect, useRef } from "react";
import { useToastStore, type Toast } from "@/store/useToastStore";
import { useUserPrefsStore } from "@/store/useUserPrefsStore";

/**
 * Subscribes to the toast store and plays a short tone when a toast is
 * added — gated by `useUserPrefsStore.notificationSoundsEnabled`.
 *
 * Sound generation is via the Web Audio API: a short attack-decay
 * envelope on a sine wave, frequency keyed off toast type. No audio
 * assets shipped — generating tones in code keeps the bundle small and
 * means there's nothing to localise / re-license. Volume is fixed
 * conservatively to avoid startling users.
 *
 * Browsers gate AudioContext resumption on user interaction; the
 * context is lazily created on the first toast event AFTER the user
 * has interacted with the page. If creation fails (e.g., headless
 * tests, very old browsers) we silently no-op — the toast still
 * surfaces visually.
 */
export function useNotificationSounds(): void {
  const enabled = useUserPrefsStore((s) => s.notificationSoundsEnabled);
  const ctxRef = useRef<AudioContext | null>(null);
  const lastSeenIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;

    // Subscribe to additions only — fire on the new toast at the tail.
    const unsub = useToastStore.subscribe((state, prev) => {
      if (state.toasts.length <= prev.toasts.length) return;
      const newest = state.toasts[state.toasts.length - 1];
      if (!newest || newest.id === lastSeenIdRef.current) return;
      lastSeenIdRef.current = newest.id;
      void playToneForToast(newest, ctxRef);
    });
    return unsub;
  }, [enabled]);

  // Best-effort cleanup of the AudioContext when the hook unmounts.
  useEffect(() => {
    return () => {
      ctxRef.current?.close().catch(() => {});
      ctxRef.current = null;
    };
  }, []);
}

const TYPE_FREQ: Record<Toast['type'], number> = {
  // Pleasant ascending two-note chime for success; single notes for the rest.
  success: 880,   // A5
  info: 660,      // E5
  warning: 520,   // C5
  error: 380,     // F#4
};

async function playToneForToast(toast: Toast, ctxRef: { current: AudioContext | null }): Promise<void> {
  try {
    if (typeof window === 'undefined') return;
    type AudioCtor = typeof AudioContext;
    const Ctor: AudioCtor | undefined =
      (window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext);
    if (!Ctor) return;

    if (!ctxRef.current) ctxRef.current = new Ctor();
    const ctx = ctxRef.current;
    if (ctx.state === 'suspended') await ctx.resume();

    const baseFreq = TYPE_FREQ[toast.type];
    // Success gets a two-note ascending chime; everything else gets one note.
    if (toast.type === 'success') {
      playTone(ctx, baseFreq, 0, 0.12);
      playTone(ctx, baseFreq * 1.25, 0.12, 0.16);
    } else {
      playTone(ctx, baseFreq, 0, 0.18);
    }
  } catch {
    // Headless / autoplay-blocked / context-creation-failed: silently no-op.
  }
}

function playTone(ctx: AudioContext, frequency: number, startOffset: number, duration: number): void {
  const now = ctx.currentTime + startOffset;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = frequency;
  // Attack-decay envelope. 0.06 peak gain stays below most users' OS-level volume.
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.06, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + duration + 0.02);
}
