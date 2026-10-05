#!/usr/bin/env python3
"""Normalize generated Bilby frames and prepare an interpolated RGBA atlas.

Requires Pillow, NumPy, and OpenCV. Never changes source artwork.
All four premultiplied RGBA channels share the same bidirectional optical flow.
"""
import argparse
from collections import deque
import hashlib
import json
import math
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageFilter


def bbox(mask):
    yy, xx = np.nonzero(mask)
    return (int(xx.min()), int(yy.min()), int(xx.max()) + 1, int(yy.max()) + 1) if len(xx) else None


def low_runs(values, threshold=2):
    result = []
    start = None
    for i, value in enumerate(values):
        if value <= threshold and start is None:
            start = i
        elif value > threshold and start is not None:
            result.append((start, i))
            start = None
    if start is not None:
        result.append((start, len(values)))
    return result


def detect_cuts(alpha, divisions, axis):
    """Choose empty projection valleys, not fractional nominal grid boundaries."""
    profile = (alpha >= 128).sum(axis=axis)
    length = len(profile)
    nominal = length / divisions
    cuts = [0]
    for n in range(1, divisions):
        center = nominal * n
        radius = math.ceil(nominal * .18)
        lo, hi = max(0, round(center) - radius), min(length, round(center) + radius)
        candidates = low_runs(profile[lo:hi])
        if not candidates:
            raise ValueError("No transparent separator near %.1f; supply explicit crop cuts." % center)
        start, end = min(candidates, key=lambda run: abs(lo + sum(run) / 2 - center) + max(0, 6 - (run[1] - run[0])) * 2)
        cuts.append(round(lo + (start + end) / 2))
    cuts.append(length)
    return cuts


def explicit_cuts(text, length, divisions):
    values = [int(v) for v in text.split(',')]
    if len(values) == divisions - 1:
        values = [0] + values + [length]
    if len(values) != divisions + 1 or values[0] != 0 or values[-1] != length or sorted(set(values)) != values:
        raise ValueError("Cuts must be increasing, and include one boundary per source row/column.")
    return values


def remove_islands(im, minimum=16):
    """Remove detached matte specks only; preserve large separate props and antialiased edges."""
    rgba = np.array(im.convert('RGBA'))
    mask = rgba[:, :, 3] >= 32
    h, w = mask.shape
    seen = np.zeros_like(mask)
    keep = np.zeros_like(mask)
    for sy, sx in zip(*np.nonzero(mask)):
        if seen[sy, sx]:
            continue
        queue = deque([(int(sy), int(sx))])
        seen[sy, sx] = True
        points = []
        while queue:
            y, x = queue.popleft()
            points.append((y, x))
            for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
                ny, nx = y + dy, x + dx
                if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    queue.append((ny, nx))
        if len(points) >= minimum:
            yy, xx = zip(*points)
            keep[yy, xx] = True
    # Keep the original RGBA in and immediately around retained solid regions.
    halo = np.array(Image.fromarray((keep * 255).astype('uint8')).filter(ImageFilter.MaxFilter(5))) > 0
    removed = int(np.sum((rgba[:, :, 3] > 0) & ~halo))
    rgba[~halo] = 0
    rgba[rgba[:, :, 3] == 0, :3] = 0
    return Image.fromarray(rgba), removed


def landmarks(im, action):
    a = np.array(im).astype(float)
    r, g, b, alpha = [a[:, :, i] for i in range(4)]
    h, w = alpha.shape
    yy, xx = np.mgrid[:h, :w]
    bell = (r > 140) & (g > 110) & (b < 120) & (g > r * .62) & (r > g * 1.05) & (g > b * 1.45) & (alpha > 160)
    bell &= (xx > w * .38) & (xx < w * .83) & (yy > h * .32) & (yy < h * .67)
    by, bx = np.nonzero(bell)
    if len(bx) < 5:
        raise ValueError("Cannot confidently locate scarf bell; inspect source and supply a complete pose.")
    bell_xy = (float(np.median(bx)), float(np.median(by)))
    fur = (b > r * 1.08) & (b > g * .95) & (alpha > 220) & (yy > h * .70)
    fy, fx = np.nonzero(fur)
    if not len(fy):
        raise ValueError("No complete lower-body landmark found.")
    baseline = float(np.quantile(fy, .995))
    if action == 'run':
        anchor = bell_xy  # fixed torso; preserve the actual authored leg cycle
        strategy = 'scarf bell x/y'
    elif action == 'gift':
        box = (r > 170) & (r > g * 1.35) & (r > b * 1.35) & (alpha > 180) & (yy > h * .68) & (xx > w * .46)
        gy, gx = np.nonzero(box)
        if len(gx) < 20:
            raise ValueError("No stationary gift-box landmark found.")
        anchor = (float(np.median(gx)), float(np.quantile(gy, .98)))
        strategy = 'gift box center x / lower edge y'
    else:
        anchor = (bell_xy[0], baseline)
        strategy = 'scarf bell x / feet baseline y'
    return {'anchor': list(anchor), 'bell': list(bell_xy), 'fur_baseline': baseline, 'strategy': strategy}


def premultiplied_distance(a, b):
    aa, bb = np.array(a).astype(float) / 255, np.array(b).astype(float) / 255
    aa[:, :, :3] *= aa[:, :, 3:4]
    bb[:, :, :3] *= bb[:, :, 3:4]
    union = (aa[:, :, 3] > .04) | (bb[:, :, 3] > .04)
    return float(np.abs(aa - bb)[union].mean()) if union.any() else 0.0


def pack(frames, path):
    count, size = len(frames), frames[0].width
    columns = 6 if count == 36 else 8 if count in (32, 48) else math.ceil(math.sqrt(count))
    rows = math.ceil(count / columns)
    sheet = Image.new('RGBA', (columns * size, rows * size))
    for i, frame in enumerate(frames):
        sheet.paste(frame, ((i % columns) * size, (i // columns) * size))
    sheet.save(path, optimize=True)
    return columns, rows


def review_sheet(frames, path, indices):
    thumb = 240
    board = Image.new('RGB', (len(indices) * thumb, thumb * 2), '#FFFAF1')
    for i, index in enumerate(indices):
        pic = frames[index].resize((thumb, thumb), Image.Resampling.LANCZOS)
        board.paste(pic, (i * thumb, 0), pic)
        dark = Image.new('RGB', (thumb, thumb), '#263757')
        dark.paste(pic, (0, 0), pic)
        board.paste(dark, (i * thumb, thumb))
    board.save(path)


def interpolate_frames(frames, count, output_dir, protect_occlusions=False):
    """Warp color and alpha together, including the last-to-first transition.

    DIS estimates motion in each direction. Iterative inverse maps then move the
    premultiplied RGBA images into the requested instant. Forward/backward flow
    agreement lowers the contribution of occluded or mismatched pixels.
    """
    arrays = [np.array(frame, dtype=np.float32) / 255 for frame in frames]
    for array in arrays:
        array[:, :, :3] *= array[:, :, 3:4]
    guides = [np.clip(cv2.cvtColor(array[:, :, :3], cv2.COLOR_RGB2GRAY) * 255, 0, 255).astype('uint8') for array in arrays]
    h, w = guides[0].shape
    yy, xx = np.mgrid[:h, :w].astype(np.float32)
    grid = np.dstack((xx, yy))

    def remap(array, coords):
        return cv2.remap(array, coords[:, :, 0], coords[:, :, 1], cv2.INTER_LINEAR,
                         borderMode=cv2.BORDER_CONSTANT, borderValue=0)

    def flow(a, b):
        estimator = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
        estimator.setFinestScale(0)
        estimator.setGradientDescentIterations(32)
        estimator.setVariationalRefinementIterations(5)
        return estimator.calc(a, b, None)

    flows = []
    for i in range(len(frames)):
        next_index = (i + 1) % len(frames)
        forward = flow(guides[i], guides[next_index])
        backward = flow(guides[next_index], guides[i])
        # Consistent estimates cancel after sampling the reverse motion at its
        # endpoint. Keep a small floor so a newly visible edge is not punched out.
        err_a = np.linalg.norm(forward + remap(backward, grid + forward), axis=2)
        err_b = np.linalg.norm(backward + remap(forward, grid + backward), axis=2)
        confidence_a = 1 / (1 + err_a * err_a)
        confidence_b = 1 / (1 + err_b * err_b)
        flows.append((forward, backward, confidence_a, confidence_b))

    result = []
    for n in range(count):
        moment = n * len(frames) / count
        i, t = int(moment), moment % 1
        if t < 1e-8:
            image = frames[i].copy()
        else:
            forward, backward, confidence_a, confidence_b = flows[i]
            map_a, map_b = grid.copy(), grid.copy()
            for _ in range(10):
                # Relax the inverse solve: hard updates can oscillate where a
                # limb moves across a stationary torso or ribbon.
                map_a = .5 * map_a + .5 * (grid - t * remap(forward, map_a))
                map_b = .5 * map_b + .5 * (grid - (1 - t) * remap(backward, map_b))
            a = remap(arrays[i], map_a)
            b = remap(arrays[(i + 1) % len(frames)], map_b)
            wa = (1 - t) * np.maximum(remap(confidence_a, map_a), .02)
            wb = t * np.maximum(remap(confidence_b, map_b), .02)
            combined = (a * wa[:, :, None] + b * wb[:, :, None]) / np.maximum((wa + wb)[:, :, None], 1e-8)
            if protect_occlusions:
                # A newly visible foot/paw has no corresponding pixel on the
                # hidden side. Keep the nearer warped surface in such regions;
                # blending it with empty background creates a ghost limb. The
                # mask is spatially feathered, never an unwarped frame dissolve.
                disagreement = (np.max(np.abs(a - b), axis=2) > .18).astype(np.float32)
                disagreement = cv2.dilate(disagreement, np.ones((5, 5), np.uint8))
                disagreement = cv2.GaussianBlur(disagreement, (9, 9), 0)[:, :, None]
                nearer = a if t < .5 else b
                combined = combined * (1 - disagreement) + nearer * disagreement
            combined[:, :, :3] /= np.maximum(combined[:, :, 3:4], 1e-6)
            combined[combined[:, :, 3] < 1 / 255] = 0
            image = Image.fromarray(np.rint(np.clip(combined, 0, 1) * 255).astype('uint8'))
        image.save(output_dir / ('frame_%04d.png' % (n + 1)))
        result.append(image)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--name', required=True, choices=['wave', 'run', 'gift', 'album'])
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--columns', type=int, default=4)
    parser.add_argument('--rows', type=int, default=4)
    parser.add_argument('--column-cuts')
    parser.add_argument('--row-cuts')
    parser.add_argument('--drop-last-row', action='store_true')
    parser.add_argument('--drop-clipped', action='store_true')
    parser.add_argument('--loop', choices=['cycle', 'pingpong'], default='cycle')
    parser.add_argument('--cell-size', type=int, default=320)
    parser.add_argument('--padding', type=float, default=.055)
    parser.add_argument('--frames', type=int)
    parser.add_argument('--output-fps', type=int, default=24)
    parser.add_argument('--output-dir', type=Path, default=Path('app/assets/bilby-sprites/v2'))
    parser.add_argument('--work-dir', type=Path, default=Path('docs/design/bilby-motion-v2/candidates'))
    args = parser.parse_args()
    if not .05 <= args.padding <= .25 or args.cell_size < 64:
        raise ValueError('Use sensible padding and at least64px cells.')
    args.output_dir.mkdir(parents=True, exist_ok=True)
    work = args.work_dir / args.name
    work.mkdir(parents=True, exist_ok=True)
    source = Image.open(args.source).convert('RGBA')
    arr = np.array(source)
    w, h = source.size
    xcuts = explicit_cuts(args.column_cuts, w, args.columns) if args.column_cuts else detect_cuts(arr[:, :, 3], args.columns, 0)
    ycuts = explicit_cuts(args.row_cuts, h, args.rows) if args.row_cuts else detect_cuts(arr[:, :, 3], args.rows, 1)
    originals, metadata, discarded = [], [], []
    for n in range(args.rows * args.columns):
        row, col = divmod(n, args.columns)
        crop = (xcuts[col], ycuts[row], xcuts[col + 1], ycuts[row + 1])
        if args.drop_last_row and row == args.rows - 1:
            discarded.append({'frame': n + 1, 'reason': 'last source row explicitly discarded'})
            continue
        frame, specks = remove_islands(source.crop(crop))
        alpha = np.array(frame)[:, :, 3]
        solid = alpha >= 128
        clipped = []
        for label, edge in [('top', solid[:2]), ('bottom', solid[-2:]), ('left', solid[:, :2]), ('right', solid[:, -2:])]:
            if int(edge.sum()) >= 8:
                clipped.append(label)
        if clipped:
            reason = 'solid artwork touches crop edge: ' + ','.join(clipped)
            if args.drop_clipped:
                discarded.append({'frame': n + 1, 'reason': reason})
                continue
            raise ValueError('Source frame%d: %s. Inspect and explicitly discard incomplete frames.' % (n + 1, reason))
        feature = landmarks(frame, args.name)
        meta = {'source_frame': n + 1, 'source_crop': list(crop), 'visible_bbox': list(bbox(alpha >= 16)), 'removed_matte_pixels': specks, **feature}
        originals.append(frame)
        metadata.append(meta)
    if len(originals) < 4:
        raise ValueError('At least four complete frames are required.')
    # One scale across the entire animation; never normalize each silhouette independently.
    left = min(m['visible_bbox'][0] - m['anchor'][0] for m in metadata)
    top = min(m['visible_bbox'][1] - m['anchor'][1] for m in metadata)
    right = max(m['visible_bbox'][2] - m['anchor'][0] for m in metadata)
    bottom = max(m['visible_bbox'][3] - m['anchor'][1] for m in metadata)
    inner = args.cell_size * (1 - 2 * args.padding)
    scale = min(inner / (right - left), inner / (bottom - top))
    anchor_x = (args.cell_size - (right - left) * scale) / 2 - left * scale
    anchor_y = (args.cell_size - (bottom - top) * scale) / 2 - top * scale
    normalized = []
    for frame, meta in zip(originals, metadata):
        ax, ay = meta['anchor']
        transform = (1 / scale, 0, ax - anchor_x / scale, 0, 1 / scale, ay - anchor_y / scale)
        image = frame.convert('RGBa').transform((args.cell_size, args.cell_size), Image.Transform.AFFINE, transform, Image.Resampling.BICUBIC).convert('RGBA')
        normalized.append(image)
        meta['output_anchor'] = [anchor_x, anchor_y]
        meta['uniform_scale'] = scale
    pack(normalized, work / 'normalized-keyframes.png')
    diffs = [premultiplied_distance(normalized[i], normalized[(i + 1) % len(normalized)]) for i in range(len(normalized))]
    source_sequence = list(range(len(normalized)))
    if args.loop == 'pingpong':
        source_sequence += list(range(len(normalized) - 2, 0, -1))
    target_count = args.frames or (36 if args.name == 'wave' else 32 if args.name == 'run' else 48)
    cycle = [normalized[i] for i in source_sequence]
    outputs = work / 'interpolated'
    outputs.mkdir(exist_ok=True)
    duration = target_count / args.output_fps
    protect_occlusions = args.name in ('run', 'gift')
    result = interpolate_frames(cycle, target_count, outputs, protect_occlusions)
    margins = [bbox(np.array(frame)[:, :, 3] >= 16) for frame in result]
    if any(b is None or min(b[0], b[1], args.cell_size - b[2], args.cell_size - b[3]) < 4 for b in margins):
        raise RuntimeError('Output touches the cell edge; increase padding or inspect input.')
    out = args.output_dir / (args.name + '.png')
    cols, rows = pack(result, out)
    poster = args.output_dir / (args.name + '-poster.png')
    result[0].save(poster, optimize=True)
    review_indices = [0, 1, 2, target_count // 3, target_count // 2, target_count - 2, target_count - 1]
    review_sheet(result, work / 'review-light-dark.png', review_indices)
    review_sheet(normalized, work / 'keyframe-review-light-dark.png', list(range(min(7, len(normalized)))))
    summary = {
        'name': args.name, 'source': str(args.source.resolve()), 'source_sha256': hashlib.sha256(args.source.read_bytes()).hexdigest(),
        'source_size': [w, h], 'source_column_cuts': xcuts, 'source_row_cuts': ycuts,
        'source_frames_retained': len(normalized), 'discarded': discarded, 'landmarks': metadata,
        'loop_mode': args.loop, 'source_sequence': [metadata[i]['source_frame'] for i in source_sequence],
        'adjacent_keyframe_distances': diffs, 'seam_to_median_ratio': diffs[-1] / max(float(np.median(diffs[:-1])), 1e-9),
        'cellSize': args.cell_size, 'columns': cols, 'rows': rows, 'frames': target_count, 'fps': args.output_fps, 'frameAspect': 1,
        'duration_seconds': duration, 'interpolation': 'OpenCV DIS medium, finest scale 0; bidirectional consistency weighted premultiplied RGBA warp',
        'opencv_version': cv2.__version__, 'output': str(out), 'poster': str(poster), 'padding': args.padding,
        'occlusion_protection': 'nearer warped surface at inconsistent correspondence' if protect_occlusions else None,
        'review_indices': review_indices, 'review': str(work / 'review-light-dark.png'),
        'quality_status': 'candidate; human visual review required; no anatomy reconstruction',
    }
    out.with_suffix('.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps({k: summary[k] for k in ['name', 'source_column_cuts', 'source_row_cuts', 'source_frames_retained', 'discarded', 'seam_to_median_ratio', 'columns', 'rows', 'frames', 'fps', 'output', 'review']}, indent=2))


if __name__ == '__main__':
    main()
