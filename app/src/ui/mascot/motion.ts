export type MascotMood = "idle" | "welcome" | "attentive" | "thinking" | "success" | "gift" | "sleepy" | "reassuring"
  | "saving" | "receiving" | "searching" | "organizing" | "running" | "waving";

export type SpritePlaybackMode = "once" | "loop" | "ping-pong";
export type SpriteFrameRange = { start: number; end: number };

/** Ranges are inclusive, zero-based atlas indices; unused cells can never be selected. */
function resolveSpriteRange(frames: number, range?: SpriteFrameRange) {
  const available = Number.isFinite(frames) ? Math.max(1, Math.floor(frames)) : 1;
  const start = range && Number.isFinite(range.start) ? Math.max(0, Math.min(available - 1, Math.floor(range.start))) : 0;
  const end = range && Number.isFinite(range.end) ? Math.max(start, Math.min(available - 1, Math.floor(range.end))) : available - 1;
  return { start, count: end - start + 1 };
}

export interface MotionContext {
  active: boolean;
  focused: boolean;
  foreground: boolean;
  visible: boolean;
  reducedMotion: boolean | null;
  motionEnabled: boolean;
  hydrated: boolean;
  mood: MascotMood;
}

/** Unknown accessibility/preferences state is still, including the first render. */
export function shouldAnimate(context: MotionContext): boolean {
  return context.active && context.focused && context.foreground && context.visible
    && context.reducedMotion === false && context.motionEnabled && context.hydrated
    && context.mood !== "attentive" && context.mood !== "thinking";
}

/** Equal boundaries switch tiles without ever showing the space between them.
 * A completed action holds its final frame; only reviewed loops wrap to frame zero.
 */
export function spriteFrameStops(frames: number, columns: number, width: number, height: number, mode: SpritePlaybackMode = "once", range?: SpriteFrameRange, intro = false) {
  const { start, count } = resolveSpriteRange(frames, range);
  const introFrames = mode === "loop" && intro ? start : 0;
  const timelineStart = introFrames ? 0 : start;
  const across = Math.max(1, Math.floor(columns));
  const steps = mode === "ping-pong" ? Math.max(1, count * 2 - 2) : count + introFrames;
  const frameAt = (step: number) => mode === "ping-pong" && step >= count ? steps - step : step;
  const input: number[] = [0];
  const x: number[] = [-(timelineStart % across) * width];
  const y: number[] = [-Math.floor(timelineStart / across) * height];
  const append = (at: number, frame: number) => {
    input.push(at);
    x.push(-((timelineStart + frame) % across) * width);
    y.push(-Math.floor((timelineStart + frame) / across) * height);
  };
  for (let step = 0; step < steps - 1; step += 1) {
    const boundary = step + (mode === "once" ? 1 : 0.5);
    append(boundary, frameAt(step));
    append(boundary, frameAt(step + 1));
  }
  if (mode !== "once") {
    // Give the resting frame half a beat at both ends of a seamless loop.
    append(steps - 0.5, frameAt(steps - 1));
    append(steps - 0.5, introFrames);
  }
  append(steps, mode === "once" ? count - 1 : introFrames);
  return { input, x, y };
}

export function spritePlaybackPlan(frames: number, fps: number, mode: SpritePlaybackMode = "once", range?: SpriteFrameRange, intro = false) {
  const rate = Number.isFinite(fps) && fps > 0 ? Math.min(fps, 60) : 24;
  const { start, count } = resolveSpriteRange(frames, range);
  const end = mode === "ping-pong" ? Math.max(1, count * 2 - 2) : count;
  const introFrames = mode === "loop" && intro ? start : 0;
  return { mode, end, introFrames, fps: rate, duration: (end / rate) * 1000 };
}

/** A visibility change resumes in place and never replays an already completed action. */
export function spriteResumePoint(phase: number, end: number, fps: number, mode: SpritePlaybackMode = "once", replay = false) {
  const stopped = Number.isFinite(phase) ? Math.max(0, Math.min(phase, end)) : 0;
  const from = replay || (mode === "loop" && stopped === end) ? 0 : stopped;
  return { from, duration: ((end - from) / fps) * 1000 };
}

/** One clock owns each visible session. Disposing makes even queued callbacks inert. */
export function createMotionClock() {
  const pending = new Set<ReturnType<typeof setTimeout>>();
  let disposed = false;
  return {
    after(delay: number, callback: () => void) {
      if (disposed) return;
      const timer = setTimeout(() => {
        pending.delete(timer);
        if (!disposed) callback();
      }, delay);
      pending.add(timer);
    },
    dispose() {
      disposed = true;
      pending.forEach(clearTimeout);
      pending.clear();
    },
  };
}
