# Figma animation import

Source: [Bilby Animations](https://www.figma.com/design/EQX5sbStSZeFf2lZCpvEJI/Bilby-Animations), page `0:1`.

## Status — 2026-09-30

| Action | Exported frames | Runtime |
| --- | ---: | --- |
| Waving | 57 / 57 | Imported Figma atlas |
| Sleeping | 57 / 57 PNGs | Imported Figma atlas |
| Running | 57 / 57 PNGs; 5 SVGs | Imported Figma atlas with selected forward stride |
| Searching, reviewing, gifting, receiving, saving, organizing, celebrating | 0 / 57 each | Previous artwork retained |

The Figma connector reached its plan limit while exporting frames. The user then supplied `Bilby Animations.zip`: 171 PNGs, comprising complete waving, sleeping, and running sequences. The SVG-based wave remains in use because it provides better rasterization quality. The remaining seven sequences still require exports. The five downloaded running SVGs (indices 0, 1, 2, 10, 34) are retained as source references.

`frame-inventory.json` records all ten source sequences and their 570 frame IDs and bounds. `downloaded-frames.json` records downloaded SVGs, source IDs, sizes, and SHA-256 hashes. Expiring asset URLs are not stored here.

## Artwork and registration

The wave atlas is rasterized directly from the exported vector paths with resvg. Sleep and run use the user's PNG exports. No paths were redrawn and no intermediate frames were generated. Every frame uses the same scale and canvas, preserving the character's movement relative to the original eight-column source grid. The identical final two poses span a row boundary and establish the original grid spacing.

All 171 PNG dimensions agree with the recorded source bounds within export rounding (1.1 pixels). These are 1× exports: running is only 64–83 × 106–120 pixels, and sleeping is 173–174 pixels wide. Upscaling into the shared atlas cannot restore missing detail; SVG or higher-resolution PNG exports can improve sharpness later.

The wave uses 320-pixel transparent cells in an 8 × 8 atlas (2560 × 2560 pixels). Its poster exactly matches frame zero. The minimum transparent edge margin is 17 pixels, and the atlas is 992,460 bytes.

Sleep and run also use 320-pixel cells in 8 × 8 atlases, with 18 pixels of minimum transparent margin. Sleep is 1,685,292 bytes; run is 2,003,752 bytes. Sleep working copies have 163 pixels of confirmed detached top-edge debris removed across 14 frames. Original PNGs remain unchanged; each cleared component is recorded in `sleep.json` under `registration.frames[].clearedDebris`. Character and bubble positions are preserved.

PNG filename order was checked against the known wave SVGs: 56 of 57 frames match their corresponding source most closely; frame 55 matches frame 56 because the last two poses are duplicates. See `png/wave-order-check.json`.

These exports use the source sequences after detached-fragment cleanup. The separate face and gift-corner studies have not been propagated across the sequences; see [the cleanup notes](../figma-vector-cleanup/README.md).

## Playback

The Figma source contains a frame grid without authored timeline or frame-rate metadata. **24 fps is an application playback choice.**

| Action | App playback | Context |
| --- | --- | --- |
| Wave | All 57 frames forward and reverse; ten-second rest | Welcome, greeting, daytime Home |
| Sleep | All 57 frames forward and reverse; 1.5-second rest | Unlock and nighttime Home |
| Run | Intro 0–20, then forward stride 21–32 repeatedly | Actual pending send/claim state |

Frame indices above are zero-based. The wave's last pose has closed eyes and differs from the first; a direct wrap would visibly jump. Tapping Bilby replays the gesture when it is resting. The run selects one complete stride because later source frames contain horizontal placement jumps; no gait reversal or invented frames are used, and all 57 source frames remain in the atlas and review material. Sleeping Bilby's unlock-screen placement was adjusted to rest on the floor ellipse after the atlas import.

The runtime supports play-once, continuous-loop, and forward/reverse modes. It preserves reduced-motion, screen-focus, foreground, visibility, and user motion-preference gates. Payment-review artwork remains still. Existing complete animations remain in use until each replacement sequence is available.

Confirm and claim screens prefetch the running atlas and poster while the person reviews the details. The prefetch never blocks submission or extends the payment state. Readiness is keyed by the resolved asset URI, so a Fast Refresh that recreates an equivalent image-source object cannot strand a loaded atlas behind its poster. Actual image `onLoad` still gates playback.

## Rebuild

From the repository root, with Pillow, NumPy, Node, and `@resvg/resvg-wasm` available:

```sh
python3 scripts/prepare_figma_atlases.py --key wave
```

Rebuild the imported PNG sequences:

```sh
python3 scripts/prepare_figma_atlases.py --png-source docs/design/figma-import/png --key sleep --key run
```

An original Figma PNG ZIP can be extracted safely using `--png-zip /absolute/path/to/archive.zip`. The script validates action names and frame indices, preserving source files and hashes.

For whole-sheet SVG exports, preserve the original Figma sequence dimensions and grid layout, name each SVG with its action key, and pass the containing directory:

```sh
python3 scripts/prepare_figma_atlases.py --sheet-source /absolute/path/to/svg-exports --key sleep
```

Action keys: `wave`, `sleep`, `run`, `search`, `review`, `gift`, `receive`, `save`, `album`, `celebrate`. Review registration, transparency, endpoints, playback rate, and loop behavior separately for every imported action before updating its runtime mapping.

## Verification

- 138 app unit tests pass across 13 files, including 25 motion tests and five asset identity/prefetch tests.
- TypeScript passes; Expo lint has zero errors and five pre-existing warnings.
- Android production export succeeds and includes all three imported atlases and matching posters. Existing `@noble/hashes/crypto.js` export warnings remain; physical-device performance was not tested.
- Web welcome and unlock pages at 390 × 844 load their 2560 × 2560 Figma atlases. Mascot tap and sleep frame advancement are verified. `wave/welcome-web.png` and `sleep/unlock-web.png` show the app contexts.
- Live Home also uses the imported atlas; see `home-integrated.png`. During a fictional local demo payment review, both running PNGs appeared in the observed page resources before submission (`payment-review-preload.json`). The review was cancelled without sending a payment.
- The offline review loads all three atlases without browser errors; pause, frame stepping, and running intro/loop preview are verified. No payment was submitted for the review.
- `git diff --check` passes.

Review artifacts are in `reports/figma-import/{wave,sleep,run}/`: contact sheets, endpoint comparisons, GIFs, and individual rasterized frames. `reports/figma-import/review.html` embeds the three atlases and provides playback and frame inspection at app sizes. Rebuild it with `python3 scripts/render_figma_import_review.py`; configuration lives in `reports/figma-import/review-manifest.json`. The preview shows configured cycles and frame rates; page-entry delays and lifecycle transitions remain app behavior.
