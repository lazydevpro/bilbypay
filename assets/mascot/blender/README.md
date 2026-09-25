# Bilby: Blender source (v2, turnaround-sheet design)

The whole mascot is built by a script, so it's rebuilt headless in about 20 seconds. Every shape, colour
region, bone and animation lives in [`build_bilby.py`](build_bilby.py).

The body and tail are signed distance fields: ellipsoids and round cones joined with a smooth union, then
meshed through OpenVDB (bundled with Blender). That's why the torso, limbs, paws, snout, tufts and
cheek fluff flow into each other with no creases. To reshape something, change a primitive or its blend
radius `k` in `sdf.add(...)`. Eyes are surface-hugging domes, so their outline stays a clean ellipse.

```bash
blender -b --factory-startup -P build_bilby.py        # -> bilby.blend (T-pose rest, rig, actions)
blender -b bilby.blend -P export_glb.py               # -> ../3d/bilby.glb, ../3d/bilby_lite.glb, textures/
blender -b bilby.blend -P render_sheet.py -- out.png front:rest q34:Idle@1 side:Run@3 face:Hello@64
                                                      # contact sheet: view:pose (pose = rest | Action@frame)
```

Views available to `render_sheet.py`: `front`, `q34`, `side`, `back`, `qback`, `face`, `faceq`, `faceside`, `arms`, `armsq`, `hand`, `handq`, `handside`, `tail`, `tailq`, `tailtop`.

## Design (from the turnaround sheet)

- **Head:** big and round, with a pointed bilby snout that flows out of the forehead.
- **Eyes:** big glossy navy eyes set low and wide, each with a thin white rim, a large sparkle and a small one.
- **Face details:** thin navy brows, a small peach nose with a highlight, a tiny smile, a soft three-lock tuft on top and rounded cheek fluff.
- **Ears:** tall upright leaves with pink cupped insides, turned 30° outward so they read from the front and the side.
- **Body:** slim, with one clean cream patch running from under the snout down the throat into the belly. Cat-style paws with two claw lines. Navy feet.
- **Tail:** a tapering blue stem, then a cream band, then a bushy navy plume ending in three soft curled locks.
- **Palette (estimated by eye from the sheet):**

  | Part | Hex |
  |---|---|
  | Fur | `#7DA9D4` |
  | Cream | `#F4EDE4` |
  | Ear pink | `#F2AB93` |
  | Nose | `#EF967C` |
  | Navy | `#3E4A66` |
  | Pupil | `#252D44` |

## Rig (rest = T-pose)

The main chain is `root → hips → spine → chest → head`. The other bones:

| Area | Bones |
|---|---|
| Arms | `upper_arm_L/R → forearm_L/R → hand_L/R` |
| Legs | `thigh_L/R → foot_L/R` |
| Ears | `ear_L/R.1–3` |
| Tail | `tail.1–5` |
| Eyes | `eye_L/R` (scale to blink) → `pupil_L/R` (rotate to look) |
| Face | `brow_L/R`, `nose`, `mouth` |
| Expression | `eyehappy_L/R`, `mouth_open` |

The body uses automatic weights; the ears and tail are weighted along their length, and the face parts are rigid.

Expression parts (happy ^^ eyes, open mouth with tongue) sit hidden inside the head at rest. To use them,
slide `eyehappy_*` / `mouth_open` out along their bone axis about 5 cm, and slide `eye_*` / `mouth` back in.

## Actions

| Clip | Length | Notes |
|---|---|---|
| `Idle` | 2 s loop | breathing, sway, ear + tail motion |
| `Hello` | 4.5 s | idle → notices you → gets happy → waves → says "Hello!" (^^) → settles |
| `Run` | 0.33 s loop | sprint: big strides, pumping arms, lean, ears and tail streaming |
| `Hop` · `TailWag` · `Blink` | | |

## Look

- **Renders:** EEVEE with a two-tone cel ramp. Each material's `Toon` node: 1 = cel shaded, 0 = flat albedo.
- **GLB:** standard PBR with baked textures. `../3d/index.html` swaps in `MeshToonMaterial` for the flat look.
