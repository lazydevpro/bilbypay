import type { ImageSourcePropType } from "react-native";
import type { MascotMood, SpriteFrameRange, SpritePlaybackMode } from "./motion";

export type BilbySprite = {
  source: ImageSourcePropType;
  poster: ImageSourcePropType;
  columns: number;
  rows: number;
  frames: number;
  fps: number;
  playback: SpritePlaybackMode;
  /** A reviewed contiguous cycle inside the full source atlas, inclusive and zero-based. */
  frameRange?: SpriteFrameRange;
  /** Play frames before the selected range once before beginning its repeated cycle. */
  intro?: boolean;
  /** Repeat a return-to-start gesture after resting; omitted means play once. */
  repeatDelayMs?: number;
  frameAspect?: number;
};

/** Import only complete sequences. Remaining Figma exports can replace these per action. */
const wave: BilbySprite = {
  source: require("../../../assets/bilby-sprites/figma/wave.png"),
  poster: require("../../../assets/bilby-sprites/figma/wave-poster.png"),
  columns: 8, rows: 8, frames: 57, fps: 24, playback: "ping-pong", repeatDelayMs: 10_000,
};
const sleep: BilbySprite = {
  source: require("../../../assets/bilby-sprites/figma/sleep.png"),
  poster: require("../../../assets/bilby-sprites/figma/sleep-poster.png"),
  columns: 8, rows: 8, frames: 57, fps: 24, playback: "ping-pong", repeatDelayMs: 1500,
};
const run: BilbySprite = {
  source: require("../../../assets/bilby-sprites/figma/run.png"),
  poster: require("../../../assets/bilby-sprites/figma/run-poster.png"),
  // Later source frames contain horizontal jumps. This authored stride returns to heel strike.
  columns: 8, rows: 8, frames: 57, fps: 24, playback: "loop", frameRange: { start: 21, end: 32 }, intro: true,
};
const gift: BilbySprite = {
  source: require("../../../assets/bilby-sprites/v2/gift.png"),
  poster: require("../../../assets/bilby-sprites/v2/gift-poster.png"),
  columns: 8, rows: 6, frames: 48, fps: 24, playback: "loop", repeatDelayMs: 12_000,
};
const album: BilbySprite = {
  source: require("../../../assets/bilby-sprites/v2/album.png"),
  poster: require("../../../assets/bilby-sprites/v2/album-poster.png"),
  columns: 8, rows: 6, frames: 48, fps: 24, playback: "loop", repeatDelayMs: 12_000,
};

export const SPRITES: Partial<Record<MascotMood, BilbySprite>> = {
  idle: wave,
  welcome: wave,
  waving: wave,
  sleepy: sleep,
  running: run,
  gift,
  organizing: album,
};

/** Every imported action uses its own exact poster, including reduced-motion states. */
export const POSTERS: Record<MascotMood, ImageSourcePropType> = {
  idle: wave.poster,
  welcome: wave.poster,
  waving: wave.poster,
  running: run.poster,
  gift: gift.poster,
  organizing: album.poster,
  sleepy: sleep.poster,
  searching: require("../../../assets/bilby-poses/searching.png"),
  attentive: require("../../../assets/bilby-poses/reviewing.png"),
  thinking: require("../../../assets/bilby-poses/reviewing.png"),
  receiving: require("../../../assets/bilby-poses/receiving.png"),
  reassuring: require("../../../assets/bilby-poses/receiving.png"),
  saving: require("../../../assets/bilby-poses/saving.png"),
  success: require("../../../assets/bilby-poses/celebrating.png"),
};
