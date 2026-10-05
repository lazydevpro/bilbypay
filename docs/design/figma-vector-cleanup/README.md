# Figma Bilby vector cleanup

Source: [Bilby Animations](https://www.figma.com/design/EQX5sbStSZeFf2lZCpvEJI/Bilby-Animations?node-id=0-1).

## Inspection

The supplied file contains ten action sequences with 57 grouped vector frames each (570 total): waving, sleeping, running, searching, reviewing, gifting, receiving, saving, organizing and celebrating. These offer substantially more authored poses than the application's earlier generated keyframe sheets. Playback rate is not established by the grid alone.

The conversion introduced two distinct problems:

1. Detached neutral strips and tiny remote fragments inflate the character group's bounds. For example, the first sleeping frame contains a small fragment roughly 124px above the body. Resizing each exported group to its own bounding box would make the character change size between frames.
2. Some small facial details were merged or simplified by tracing. In the first wave frame, a highlight becomes a notch in the pupil, eye whites contain angular transitions, and a white sliver is left below the cream muzzle. The vector paths already have zero corner radius; a global radius or sharpening change cannot recover those shapes.

Organic shapes need continuous curves, while paper, cards and prop corners need deliberate sharp joins. Whole-file smoothing or rounding would affect both. The number of vector layers and vertices also varies across frames, so copying a vertex edit to the same index in every frame is unsafe.

## Facial detail study

[Open the before/after board](https://www.figma.com/design/EQX5sbStSZeFf2lZCpvEJI/Bilby-Animations?node-id=11-3).

Page: `Vector cleanup · face study` (`11:2`). Board: `11:3`.

- Before group: `11:10`, copied from source wave frame `1:3`.
- After group: `11:52`.
- Refit four eye/pupil contours into continuous curves.
- Restore the two highlights as separate editable ellipse layers.
- Match the stray muzzle sliver to the surrounding cream fill.
- Preserve the original body, expression, pose, colors, scarf, ears and timing source.

This is a single-frame review study. The original wave sequence's face is unchanged. Detailed corrections require semantic matching per frame before they can become a consistent animation set. The setup script is `scripts/figma_bilby_face_study.js`; it is intended for Figma's plugin context and stops if the study page already exists.

Local comparison image: `reports/figma-vector-cleanup/face-study.png`.

## Gift-box corner study

[Open the gift-box comparison](https://www.figma.com/design/EQX5sbStSZeFf2lZCpvEJI/Bilby-Animations?node-id=16-2) on the same review page. Board `16:2` contains before group `16:9` and after group `16:78`, both based on gift frame `1:12994`.

Four traced box planes/folds are replaced with straight segments and explicit corners. Five irregular pattern fragments are hidden in this review copy, and five separate editable dots restore a consistent pattern. The soft ribbon and character retain their source paths. The original gift sequence is unchanged. Script: `scripts/figma_bilby_prop_study.js`; screenshot: `reports/figma-vector-cleanup/prop-study.png`.

## Completed sequence cleanup

399 verified detached neutral fragments were moved from 259 source frame groups into a hidden archive frame. Nothing was deleted. All ten sequences retain their 57 frames. Across affected groups, all 11,995 retained artwork nodes have identical absolute transforms before and after cleanup.

| Action | Archived fragments |
| --- | ---: |
| Sleeping | 29 |
| Running | 173 |
| Searching | 61 |
| Receiving | 3 |
| Saving | 72 |
| Organizing | 61 |

Archive page: `Vector cleanup · archived fragments` (`14:2`); hidden archive frame: `14:3`. Restoration data was saved before mutation in `reports/figma-vector-cleanup/restore-manifest.json`, including original node IDs, parent IDs, child indexes, relative/absolute transforms and visibility. `archive-result.json` records the affected IDs, after-state and checks.

Candidate detection uses pale neutral color, a large gap from the colored character, and either a very thin vertical strip or a tiny fragment more than 80px away. First and late frames were visually checked in each affected action. Sleeping bubbles, running shadows, receiving attention marks and watering details remain. The neutral-color rule was deliberately narrowed after an earlier candidate rule also caught a genuine sleeping highlight.

Example group bounds after removing only the detached fragments:

| Frame | Before | After |
| --- | --- | --- |
| Sleeping 01 | 173.17 × 201.78 | 173.17 × 77.38 |
| Searching 01 | 208.35 × 159.80 | 175.03 × 159.80 |
| Saving 01 | 217.77 × 226.42 | 145.96 × 138.06 |

These corrected bounds improve export registration without moving the actual character. Body motion and pose silhouettes can still change bounds legitimately; atlas preparation should preserve a shared canvas/anchor instead of independently stretching each frame.

## Application scope

This pass operates on the supplied Figma vectors. It does not replace the application's current PNG atlases. A later integration should preserve the sequence's original registration, choose playback timing, and compare loop boundaries before rendering new atlases or a named vector rig.
