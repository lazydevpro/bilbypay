import { afterEach, describe, expect, it, vi } from "vitest";
import { createMotionClock, shouldAnimate, spriteFrameStops, spritePlaybackPlan, spriteResumePoint, type MotionContext } from "./motion";

const ready: MotionContext = {
  active: true, focused: true, foreground: true, visible: true,
  reducedMotion: false, motionEnabled: true, hydrated: true, mood: "idle",
};

afterEach(() => vi.useRealTimers());

describe("Bilby motion eligibility", () => {
  it("waits for both persisted preference and accessibility state before moving", () => {
    expect(shouldAnimate(ready)).toBe(true);
    expect(shouldAnimate({ ...ready, hydrated: false })).toBe(false);
    expect(shouldAnimate({ ...ready, reducedMotion: null })).toBe(false);
  });

  it.each(["active", "focused", "foreground", "visible", "motionEnabled"] as const)(
    "stops when %s is false", (gate) => expect(shouldAnimate({ ...ready, [gate]: false })).toBe(false),
  );

  it("keeps payment review still even when every animation gate is open", () => {
    expect(shouldAnimate({ ...ready, mood: "attentive" })).toBe(false);
    expect(shouldAnimate({ ...ready, mood: "thinking" })).toBe(false);
    expect(shouldAnimate({ ...ready, reducedMotion: true, mood: "success" })).toBe(false);
  });

  it.each(["saving", "receiving", "searching", "organizing"] as const)(
    "applies reduced motion and visibility gates to the %s prop pose", (mood) => {
      expect(shouldAnimate({ ...ready, mood })).toBe(true);
      expect(shouldAnimate({ ...ready, mood, reducedMotion: true })).toBe(false);
      expect(shouldAnimate({ ...ready, mood, visible: false })).toBe(false);
    },
  );
});

describe("Bilby session cleanup", () => {
  it("cancels queued actions and prevents an old session from scheduling more work", () => {
    vi.useFakeTimers();
    const clock = createMotionClock();
    const animate = vi.fn();
    clock.after(100, animate);
    clock.dispose();
    clock.after(100, animate);
    vi.runAllTimers();
    expect(animate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("can stop a recurring blink without leaving a timer after the route loses focus", () => {
    vi.useFakeTimers();
    const clock = createMotionClock();
    let blinks = 0;
    const blink = () => { blinks += 1; clock.after(3000, blink); };
    clock.after(3000, blink);
    vi.advanceTimersByTime(9000);
    expect(blinks).toBe(3);
    clock.dispose();
    vi.advanceTimersByTime(30_000);
    expect(blinks).toBe(3);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("authored sprite playback", () => {
  // Matches the interval selection used by RN iOS, Android and web interpolation.
  const sample = (input: number[], output: number[], phase: number) => {
    let index = 1;
    while (index < input.length - 1 && input[index] < phase) index += 1;
    const start = index - 1;
    if (output[start] === output[index]) return output[start];
    if (input[start] === input[index]) return phase <= input[start] ? output[start] : output[index];
    return output[start] + ((phase - input[start]) / (input[index] - input[start])) * (output[index] - output[start]);
  };

  it.each(["once", "loop", "ping-pong"] as const)("never renders a fractional tile in a 57-frame %s atlas", (mode) => {
    const stops = spriteFrameStops(57, 8, 200, 200, mode);
    const { end } = spritePlaybackPlan(57, 24, mode);
    for (let frame = 0; frame < end; frame += 1) {
      for (const delta of [-0.00001, 0, 0.00001]) {
        const phase = Math.min(end, frame + (mode === "once" ? 1 : 0.5) + delta);
        const x = sample(stops.input, stops.x, phase);
        const y = sample(stops.input, stops.y, phase);
        expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
        expect(Number.isInteger(x / 200) && Number.isInteger(y / 200)).toBe(true);
        expect(x).toBeGreaterThanOrEqual(-1400);
        expect(y).toBeGreaterThanOrEqual(-1400);
        expect(-y / 200 * 8 - x / 200).toBeLessThan(57);
      }
    }
  });

  it("wraps a reviewed seamless loop onto the identical first tile", () => {
    const stops = spriteFrameStops(57, 8, 120, 100, "loop");
    expect(sample(stops.input, stops.x, 0)).toBeCloseTo(0);
    expect(sample(stops.input, stops.y, 0)).toBeCloseTo(0);
    expect(sample(stops.input, stops.x, 57)).toBeCloseTo(0);
    expect(sample(stops.input, stops.y, 57)).toBeCloseTo(0);
  });

  it("holds the final authored frame without resetting or displaying unused atlas cells", () => {
    const stops = spriteFrameStops(57, 8, 120, 100);
    expect(sample(stops.input, stops.x, 56.5)).toBeCloseTo(0);
    expect(sample(stops.input, stops.y, 56.5)).toBeCloseTo(-700);
    expect(sample(stops.input, stops.x, 57)).toBeCloseTo(0);
    expect(sample(stops.input, stops.y, 57)).toBeCloseTo(-700);
  });

  it("plays all 57 imported frames once at the configured frame rate", () => {
    const greeting = spritePlaybackPlan(57, 24);
    expect(greeting.mode).toBe("once");
    expect(greeting.end).toBe(57);
    expect(greeting.duration).toBe(2375);
    const running = spritePlaybackPlan(57, 30, "loop");
    expect(running.mode).toBe("loop");
    expect(running.duration).toBe(1900);
  });

  it("returns through adjacent authored frames for a ping-pong greeting, then holds eyes open", () => {
    const plan = spritePlaybackPlan(57, 24, "ping-pong");
    const stops = spriteFrameStops(57, 8, 120, 100, "ping-pong");
    const frameAt = (phase: number) => -sample(stops.input, stops.y, phase) / 100 * 8 - sample(stops.input, stops.x, phase) / 120;
    expect(plan.end).toBe(112);
    expect(plan.duration).toBeCloseTo(4666.6667);
    expect(frameAt(55)).toBe(55);
    expect(frameAt(56)).toBe(56);
    expect(frameAt(57)).toBe(55);
    expect(frameAt(111)).toBe(1);
    expect(frameAt(112)).toBe(0);
    expect(spriteResumePoint(112, 112, 24, "ping-pong")).toEqual({ from: 112, duration: 0 });
  });

  it("plays a selected gait only forwards and returns to its exact starting tile", () => {
    const range = { start: 3, end: 16 };
    const plan = spritePlaybackPlan(57, 24, "loop", range);
    const stops = spriteFrameStops(57, 8, 120, 100, "loop", range);
    const frameAt = (phase: number) => -sample(stops.input, stops.y, phase) / 100 * 8 - sample(stops.input, stops.x, phase) / 120;
    expect(plan.end).toBe(14);
    for (let phase = 0; phase < plan.end; phase += 1) expect(frameAt(phase)).toBe(phase + range.start);
    expect(frameAt(plan.end)).toBe(range.start);
    expect(plan.duration).toBeCloseTo(14 / 24 * 1000);
  });

  it("plays the running intro once, then loops only its reviewed forward stride", () => {
    const range = { start: 21, end: 32 };
    const plan = spritePlaybackPlan(57, 24, "loop", range, true);
    const stops = spriteFrameStops(57, 8, 120, 100, "loop", range, true);
    const frameAt = (phase: number) => -sample(stops.input, stops.y, phase) / 100 * 8 - sample(stops.input, stops.x, phase) / 120;
    expect(plan.introFrames).toBe(21);
    expect(plan.end).toBe(12);
    expect(plan.duration).toBe(500);
    for (let intro = 0; intro < plan.introFrames; intro += 1) expect(frameAt(intro)).toBe(intro);
    for (let cycle = 0; cycle < plan.end; cycle += 1) expect(frameAt(plan.introFrames + cycle)).toBe(range.start + cycle);
    expect(frameAt(plan.introFrames + plan.end)).toBe(range.start);
    expect(frameAt(plan.introFrames)).toBe(range.start);
  });

  it("clamps a selected cycle to existing source frames", () => {
    const plan = spritePlaybackPlan(57, 24, "once", { start: 54, end: 100 });
    const stops = spriteFrameStops(57, 8, 120, 100, "once", { start: 54, end: 100 });
    expect(plan.end).toBe(3);
    expect(sample(stops.input, stops.x, 0)).toBe(-720);
    expect(sample(stops.input, stops.y, 0)).toBe(-600);
    expect(sample(stops.input, stops.y, 3)).toBe(-700);
    expect(spritePlaybackPlan(57, 24, "loop", { start: 20, end: 10 }).end).toBe(1);
  });

  it("resumes a paused frame at the same frame rate without replaying a completed action", () => {
    const paused = spriteResumePoint(10.5, 57, 24);
    expect(paused.from).toBe(10.5);
    expect(paused.duration).toBeCloseTo((46.5 / 24) * 1000);
    expect(spriteResumePoint(57, 57, 24)).toEqual({ from: 57, duration: 0 });
    expect(spriteResumePoint(57, 57, 24, "loop")).toEqual({ from: 0, duration: 2375 });
    expect(spriteResumePoint(57, 57, 24, "once", true)).toEqual({ from: 0, duration: 2375 });
  });

  it("keeps malformed or single-frame playback within an actual tile", () => {
    expect(spritePlaybackPlan(1, 0).fps).toBe(24);
    expect(spritePlaybackPlan(1, 240).fps).toBe(60);
    expect(spriteResumePoint(Number.NaN, 57, 24).from).toBe(0);
    expect(spriteResumePoint(60, 57, 24).duration).toBe(0);
    const stops = spriteFrameStops(1, 1, 200, 200);
    expect(sample(stops.input, stops.x, 1)).toBeCloseTo(0);
    expect(sample(stops.input, stops.y, 1)).toBeCloseTo(0);
  });
});
