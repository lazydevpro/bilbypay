// Clean leftovers from background-removed character frames: light, colourless (white/grey) blobs that touch the
// transparent background, such as motion-line strokes that a remover kept as opaque white. The character's own
// whites (eyes, highlights) are enclosed by its outline, and its cream/pastel areas are warm, so both survive.
//
//   node scripts/clean_sprite_frames.mjs <inDir> <outDir>
// Reads every *.png in inDir (sorted), writes cleaned PNGs with the same names to outDir and prints, per frame,
// how many pixels were removed. Requires ffmpeg/ffprobe on PATH.
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const [inDir, outDir] = process.argv.slice(2);
if (!inDir || !outDir) throw new Error("usage: clean_sprite_frames.mjs <inDir> <outDir>");
mkdirSync(outDir, { recursive: true });

const LIGHT = 215; // darkest channel at least this bright (the leftovers are near-white)…
const NEUTRAL = 18; // …and channels within this of each other (cream #EFE2D1 spreads 30, fur far more)
const CLEAR = 24; // alpha at or below this counts as background

for (const name of readdirSync(inDir).filter((n) => n.endsWith(".png")).sort()) {
  const file = join(inDir, name);
  const [W, H] = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries",
    "stream=width,height", "-of", "csv=p=0", file]).toString().trim().split(",").map(Number);
  const px = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", "rgba", "-"],
    { maxBuffer: 1 << 28 });
  const N = W * H;

  const isJunk = (p) => {
    const o = p * 4, r = px[o], g = px[o + 1], b = px[o + 2];
    return px[o + 3] > CLEAR && Math.min(r, g, b) >= LIGHT && Math.max(r, g, b) - Math.min(r, g, b) <= NEUTRAL;
  };
  const clear = (p) => px[p * 4 + 3] <= CLEAR;

  // Seed with junk pixels next to the background, then grow through connected junk (8-connected).
  const hit = new Uint8Array(N);
  const stack = [];
  const nbrs = (p, fn) => {
    const x = p % W, y = (p / W) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < W && ny < H) fn(ny * W + nx);
    }
  };
  for (let p = 0; p < N; p++) {
    if (!isJunk(p)) continue;
    let touches = false;
    nbrs(p, (q) => { if (clear(q)) touches = true; });
    if (touches) { hit[p] = 1; stack.push(p); }
  }
  while (stack.length) {
    const p = stack.pop();
    nbrs(p, (q) => { if (!hit[q] && isJunk(q)) { hit[q] = 1; stack.push(q); } });
  }
  // A blob's rim is tinted by the fur it sits on (pale blue). Grow from the blob into pale pixels that are not warm,
  // so cream/pink areas (red well above blue) are never touched.
  const paleCool = (p) => {
    const o = p * 4, r = px[o], g = px[o + 1], b = px[o + 2];
    return px[o + 3] > CLEAR && Math.min(r, g, b) >= 185 && b >= r - 4;
  };
  for (let p = 0; p < N; p++) if (hit[p]) stack.push(p);
  while (stack.length) {
    const p = stack.pop();
    nbrs(p, (q) => { if (!hit[q] && paleCool(q)) { hit[q] = 1; stack.push(q); } });
  }

  // Removed pixels that border the solid character were its anti-aliased (white-tinted) edge: keep them as a soft
  // edge, recoloured from the solid neighbours so the outline stays smooth without a white halo. Pixels inside a
  // stray blob have no solid neighbours and are dropped.
  const SOLID = 200;
  const orig = Uint8Array.from(px);
  let removed = 0;
  for (let p = 0; p < N; p++) {
    if (!hit[p]) continue;
    let r = 0, g = 0, b = 0, n = 0;
    nbrs(p, (q) => {
      const o = q * 4;
      if (!hit[q] && orig[o + 3] >= SOLID) { r += orig[o]; g += orig[o + 1]; b += orig[o + 2]; n++; }
    });
    const o = p * 4;
    if (n) {
      px[o] = r / n; px[o + 1] = g / n; px[o + 2] = b / n;
      px[o + 3] = Math.round(orig[o + 3] * 0.55);
    } else {
      px[o + 3] = 0;
      removed++;
    }
  }
  // A removed blob leaves its own faint anti-aliased rim behind. Drop see-through pixels next to a removed pixel
  // that have no solid neighbour (the character's real edge always has one; motion lines are solid enough to stay).
  for (let pass = 0; pass < 2; pass++) {
    const near = new Uint8Array(N);
    for (let p = 0; p < N; p++) if (hit[p] && px[p * 4 + 3] === 0) nbrs(p, (q) => (near[q] = 1));
    for (let p = 0; p < N; p++) {
      const o = p * 4;
      if (!near[p] || hit[p] || px[o + 3] === 0 || px[o + 3] >= 140) continue;
      let solid = false;
      nbrs(p, (q) => { if (px[q * 4 + 3] >= SOLID) solid = true; });
      if (!solid) { px[o + 3] = 0; hit[p] = 1; removed++; }
    }
  }

  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${W}x${H}`, "-i", "-",
    "-frames:v", "1", join(outDir, name)], { input: px });
  console.log(`${name}\t${removed}`);
}
