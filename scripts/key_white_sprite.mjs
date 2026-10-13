// Turn a white-background character video into a transparent sprite atlas (for site/static/img).
// "Chroma key" on white, but only for background *connected to the frame edge*, so white/cream parts of the
// character (belly, tail tip, eye highlights) stay opaque. Edge pixels get a soft alpha ramp and are un-mixed
// from white so there is no light fringe on dark backgrounds.
//
//   node scripts/key_white_sprite.mjs <video> <out.png | outDir> [cellWidth=342] [cols=8]
// out.png → one atlas image (then: cwebp -q 80 -alpha_q 90 out.png -o out.webp)
// outDir  → transparent frames f000.png… (then e.g. img2webp -loop 0 -lossy -q 80 -d 42 outDir/f*.png -o out.webp)
// Requires ffmpeg on PATH. Prints the atlas JSON (frames, fps, cols, rows, cell size) to stdout.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const [video, out, cellArg = "342", colsArg = "8"] = process.argv.slice(2);
if (!video || !out) throw new Error("usage: key_white_sprite.mjs <video> <out.png> [cellWidth] [cols]");

const probe = JSON.parse(
  execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-count_frames", "-show_entries",
    "stream=width,height,r_frame_rate,nb_read_frames", "-of", "json", video]).toString(),
).streams[0];
const W = Number(cellArg);
const H = Math.round((probe.height * W) / probe.width / 2) * 2;
const [fn, fd] = probe.r_frame_rate.split("/").map(Number);
const fps = fn / fd;
const frames = Number(probe.nb_read_frames);
const cols = Number(colsArg);
const rows = Math.ceil(frames / cols);

const raw = execFileSync("ffmpeg", ["-v", "error", "-i", video, "-vf", `scale=${W}:${H}:flags=lanczos`,
  "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1 << 30 });

// Distance from white = how much the darkest channel drops below 255. Background noise sits under ~8;
// the character's cream fur is ~46, so the soft edge lives between LO and HI.
const LO = 8, HI = 34;
const atlas = Buffer.alloc(W * cols * H * rows * 4);
const N = W * H;

for (let f = 0; f < frames; f++) {
  const src = raw.subarray(f * N * 3, (f + 1) * N * 3);
  const dist = new Uint8Array(N);
  for (let p = 0; p < N; p++) dist[p] = 255 - Math.min(src[p * 3], src[p * 3 + 1], src[p * 3 + 2]);

  // Flood fill from the border through near-white pixels.
  const bg = new Uint8Array(N);
  const stack = [];
  const push = (p) => { if (!bg[p] && dist[p] < HI) { bg[p] = 1; stack.push(p); } };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (stack.length) {
    const p = stack.pop(), x = p % W;
    if (x > 0) push(p - 1);
    if (x < W - 1) push(p + 1);
    if (p >= W) push(p - W);
    if (p < N - W) push(p + W);
  }

  const cx = (f % cols) * W, cy = Math.floor(f / cols) * H;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      let a = 255;
      if (bg[p]) a = dist[p] <= LO ? 0 : Math.round(((dist[p] - LO) / (HI - LO)) * 255);
      const o = ((cy + y) * W * cols + cx + x) * 4;
      if (a === 0) continue; // fully transparent (atlas buffer is zeroed)
      const k = a / 255;
      for (let c = 0; c < 3; c++) {
        // Un-mix the white background: observed = k*colour + (1-k)*255.
        const v = (src[p * 3 + c] - (1 - k) * 255) / k;
        atlas[o + c] = Math.max(0, Math.min(255, Math.round(v)));
      }
      atlas[o + 3] = a;
    }
  }
}

if (out.endsWith(".png")) {
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${W * cols}x${H * rows}`,
    "-i", "-", "-frames:v", "1", out], { input: atlas });
} else {
  // Directory: one transparent PNG per frame (f000.png…), e.g. for an animated WebP via img2webp.
  mkdirSync(out, { recursive: true });
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${W * cols}x${H * rows}`,
    "-i", "-", "-vf", `untile=${cols}x${rows},trim=end_frame=${frames}`, "-start_number", "0", `${out}/f%03d.png`],
    { input: atlas });
}
console.log(JSON.stringify({ frames, fps, cols, rows, cellWidth: W, cellHeight: H }));
