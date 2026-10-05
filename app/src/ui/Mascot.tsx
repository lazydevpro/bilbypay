import { useEffect, useMemo, useRef, useState } from "react";
import { useIsFocused } from "expo-router";
import {
  AccessibilityInfo, Animated, AppState, Easing, Platform, Pressable, StyleSheet, View,
  type StyleProp, type ViewStyle,
} from "react-native";
import { useCompanionPreferences } from "../state/companion";
import { createMotionClock, shouldAnimate, spriteFrameStops, spritePlaybackPlan, spriteResumePoint, type MascotMood } from "./mascot/motion";
import { POSTERS, SPRITES } from "./mascot/sprites";
import { mascotAssetKey } from "./mascot/assets";

export type { MascotMood } from "./mascot/motion";

export interface MascotProps {
  size?: number;
  mood?: MascotMood;
  interactive?: boolean;
  active?: boolean;
  backdrop?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/** Plays the supplied artwork without redrawing or distorting the character. */
export function Mascot({
  size = 160, mood = "idle", interactive = false, active = true, backdrop = false,
  accessibilityLabel, style,
}: MascotProps) {
  const preferences = useCompanionPreferences();
  const focused = useIsFocused();
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  const [visible, setVisible] = useState(Platform.OS !== "web" || typeof document === "undefined" || document.visibilityState !== "hidden");
  const [reducedMotion, setReducedMotion] = useState<boolean | null>(null);
  const [frame] = useState(() => new Animated.Value(0));
  const [cycleFrame] = useState(() => new Animated.Value(0));
  const phase = useMemo(() => Animated.add(frame, cycleFrame), [frame, cycleFrame]);
  const [fallback] = useState(() => ({ lift: new Animated.Value(0), breath: new Animated.Value(0), tilt: new Animated.Value(0) }));
  const greetedFallback = useRef<MascotMood | null>(null);
  const reactToTap = useRef<() => void>(() => {});
  const sprite = SPRITES[mood];
  const spriteKey = sprite ? mascotAssetKey(sprite.source) : null;
  const playback = useMemo(() => sprite ? spritePlaybackPlan(sprite.frames, sprite.fps, sprite.playback, sprite.frameRange, sprite.intro) : null, [sprite]);
  const lastArt = useRef<{ mood: MascotMood; sourceKey: string | null } | null>(null);
  const [loadedSpriteKey, setLoadedSpriteKey] = useState<string | null>(null);
  const spriteReady = Boolean(spriteKey && loadedSpriteKey === spriteKey);
  const still = mood === "attentive" || mood === "thinking";

  useEffect(() => {
    let mounted = true;
    let eventReceived = false;
    const accessibility = AccessibilityInfo.addEventListener("reduceMotionChanged", (value) => {
      eventReceived = true;
      setReducedMotion(value);
    });
    AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted && !eventReceived) setReducedMotion(value);
    }).catch(() => { if (mounted) setReducedMotion(true); });
    const app = AppState.addEventListener("change", (state) => setForeground(state === "active"));
    const visibility = () => setVisible(document.visibilityState !== "hidden");
    if (Platform.OS === "web" && typeof document !== "undefined") document.addEventListener("visibilitychange", visibility);
    return () => {
      mounted = false;
      accessibility.remove();
      app.remove();
      if (Platform.OS === "web" && typeof document !== "undefined") document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  const animate = shouldAnimate({
    active, focused, foreground, visible, reducedMotion, mood,
    motionEnabled: preferences.motionEnabled, hydrated: preferences.hydrated,
  }) && (!sprite || spriteReady);

  useEffect(() => {
    const clock = createMotionClock();
    let animation: Animated.CompositeAnimation | null = null;
    let disposed = false;
    let playing = false;
    let repeatVersion = 0;
    // Pausing preserves the current pose. Only a different action resets the timeline.
    if (lastArt.current?.mood !== mood || lastArt.current?.sourceKey !== spriteKey) {
      frame.setValue(0);
      cycleFrame.setValue(0);
      Object.values(fallback).forEach((value) => value.setValue(0));
      lastArt.current = { mood, sourceKey: spriteKey };
    }
    if (!animate || !sprite || !playback) {
      reactToTap.current = () => {};
      return () => clock.dispose();
    }
    const timingValue = (value: Animated.Value, toValue: number, duration: number) => Animated.timing(value, {
      toValue, duration, easing: Easing.linear,
      useNativeDriver: Platform.OS !== "web", isInteraction: false,
    });
    const timing = (duration: number) => timingValue(frame, playback.end, duration);
    const play = (replay = false) => {
      if (playing || disposed) return;
      playing = true;
      const version = ++repeatVersion;
      if (playback.introFrames > 0) {
        // The cycle has its own zero-based value, so native reset never replays the intro.
        frame.stopAnimation((introPhase) => {
          if (disposed) return;
          const beginCycle = () => {
            cycleFrame.stopAnimation((cyclePhase) => {
              if (disposed) return;
              const resume = spriteResumePoint(cyclePhase, playback.end, playback.fps, "loop");
              cycleFrame.setValue(resume.from);
              const loop = () => {
                if (disposed) return;
                cycleFrame.setValue(0);
                animation = Animated.loop(timingValue(cycleFrame, playback.end, playback.duration));
                animation.start();
              };
              if (resume.from === 0) loop();
              else {
                animation = timingValue(cycleFrame, playback.end, resume.duration);
                animation.start(({ finished }) => { if (finished && !disposed) loop(); });
              }
            });
          };
          if (introPhase >= playback.introFrames) beginCycle();
          else {
            animation = timingValue(frame, playback.introFrames, (playback.introFrames - introPhase) / playback.fps * 1000);
            animation.start(({ finished }) => { if (finished && !disposed) beginCycle(); });
          }
        });
        return;
      }
      // Read a stopped native value once, without a JS listener or React update per frame.
      frame.stopAnimation((phase) => {
        if (disposed) return;
        const resume = spriteResumePoint(phase, playback.end, playback.fps, playback.mode, replay);
        const continuous = playback.mode === "loop" && sprite.repeatDelayMs === undefined;
        const queueRepeat = () => {
          // Only a path that returns to its first pose can repeat without a jump.
          if (playback.mode !== "once" && sprite.repeatDelayMs !== undefined) {
            clock.after(sprite.repeatDelayMs, () => { if (version === repeatVersion) play(true); });
          }
        };
        if (resume.duration === 0) { playing = false; queueRepeat(); return; }
        frame.setValue(resume.from);
        const loop = () => {
          if (disposed) return;
          frame.setValue(0);
          animation = Animated.loop(timing(playback.duration));
          animation.start();
        };
        if (continuous && resume.from === 0) loop();
        else {
          animation = timing(resume.duration);
          animation.start(({ finished }) => {
            if (!finished || disposed) return;
            if (continuous) loop();
            else { playing = false; queueRepeat(); }
          });
        }
      });
    };
    reactToTap.current = () => play(true);
    clock.after(mood === "running" || mood === "sleepy" ? 0 : mood === "success" ? 180 : mood === "gift" || mood === "organizing" ? 450 : 350, () => play());

    return () => {
      disposed = true;
      clock.dispose();
      reactToTap.current = () => {};
      animation?.stop();
      frame.stopAnimation();
      cycleFrame.stopAnimation();
    };
  }, [animate, mood, playback, sprite, spriteKey, frame, cycleFrame, fallback]);

  // Preserve the existing gentle motion for actions whose Figma sequence is not imported yet.
  useEffect(() => {
    if (sprite || !animate) return;
    const clock = createMotionClock();
    const animations = new Set<Animated.CompositeAnimation>();
    const timing = (value: Animated.Value, toValue: number, duration: number) => Animated.timing(value, {
      toValue, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: Platform.OS !== "web", isInteraction: false,
    });
    const play = (animation: Animated.CompositeAnimation) => { animations.add(animation); animation.start(() => animations.delete(animation)); };
    const nod = () => play(Animated.sequence([timing(fallback.tilt, 1.1, 650), timing(fallback.tilt, 0, 850)]));
    reactToTap.current = nod;
    if (mood === "sleepy") play(Animated.loop(Animated.sequence([
      timing(fallback.breath, 1, 3100), timing(fallback.breath, 0, 3400),
    ])));
    if (greetedFallback.current !== mood) {
      greetedFallback.current = mood;
      if (mood === "success") clock.after(180, () => play(Animated.sequence([
        timing(fallback.lift, -0.04, 240), timing(fallback.lift, 0, 300),
        timing(fallback.lift, -0.014, 190), timing(fallback.lift, 0, 230),
      ])));
      if (mood === "saving" || mood === "receiving" || mood === "reassuring") clock.after(600, nod);
    }
    return () => {
      clock.dispose();
      reactToTap.current = () => {};
      animations.forEach((animation) => animation.stop());
      Object.values(fallback).forEach((value) => value.stopAnimation());
    };
  }, [animate, fallback, mood, sprite]);

  const canInteract = interactive && animate && mood !== "sleepy" && mood !== "running";
  const label = accessibilityLabel ?? (canInteract ? "Bilby. Tap to say hello."
    : mood === "sleepy" ? "Bilby curled up asleep"
    : mood === "running" ? "Bilby running"
    : mood === "thinking" ? "Bilby thinking quietly"
    : "Bilby, your payment companion");

  const atlas = useMemo(() => {
    if (!sprite || !playback) return null;
    const aspect = typeof sprite.frameAspect === "number" && sprite.frameAspect > 0 ? sprite.frameAspect : 1;
    const width = aspect >= 1 ? size : size * aspect;
    const height = aspect >= 1 ? size / aspect : size;
    const stops = spriteFrameStops(sprite.frames, sprite.columns, width, height, playback.mode, sprite.frameRange, sprite.intro);
    return {
      width, height,
      x: phase.interpolate({ inputRange: stops.input, outputRange: stops.x, extrapolate: "clamp" }),
      y: phase.interpolate({ inputRange: stops.input, outputRange: stops.y, extrapolate: "clamp" }),
    };
  }, [sprite, playback, size, phase]);

  const character = <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.artContainer}>
    {backdrop && <View style={[styles.backdrop, { width: size * 0.94, height: size * 0.94, borderRadius: size }]} />}
    {(still || !spriteReady) && <Animated.Image source={POSTERS[mood]} resizeMode="contain" fadeDuration={0} accessible={false} style={{
      position: "absolute", width: size, height: size,
      transform: sprite || still ? undefined : [
        { translateY: fallback.lift.interpolate({ inputRange: [-1, 1], outputRange: [-size, size] }) },
        { rotate: fallback.tilt.interpolate({ inputRange: [-10, 10], outputRange: ["-10deg", "10deg"] }) },
        { scaleY: fallback.breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.015] }) },
      ],
    }} />}
    {!still && sprite && atlas && <View style={{ width: atlas.width, height: atlas.height, overflow: "hidden", opacity: spriteReady ? 1 : 0 }}>
      <Animated.Image
        key={spriteKey}
        source={sprite.source} resizeMode="stretch" fadeDuration={0} accessible={false}
        onLoad={() => setLoadedSpriteKey(spriteKey)}
        style={{
          position: "absolute", left: 0, top: 0, width: atlas.width * sprite.columns, height: atlas.height * sprite.rows,
          transform: [{ translateX: atlas.x }, { translateY: atlas.y }],
        }}
      />
    </View>}
  </View>;

  if (canInteract) {
    return <Pressable
      accessibilityRole="button" accessibilityLabel={label} accessibilityHint={mood === "welcome" || mood === "waving" || mood === "idle"
        ? "Bilby waves hello." : mood === "organizing" ? "Bilby turns a page."
        : mood === "gift" ? "Bilby adjusts the gift ribbon." : "Bilby responds to your greeting."}
      onPress={() => reactToTap.current()} hitSlop={8} style={[styles.container, { width: size, height: size }, style]}
    >{character}</Pressable>;
  }
  return <View accessible accessibilityRole="image" accessibilityLabel={label} style={[styles.container, { width: size, height: size }, style]}>{character}</View>;
}

const styles = StyleSheet.create({
  container: { alignSelf: "center", flexShrink: 0, overflow: "visible" },
  artContainer: { width: "100%", height: "100%", alignItems: "center", justifyContent: "center" },
  backdrop: { position: "absolute", backgroundColor: "#F4EAD8" },
});
