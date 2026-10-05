#!/usr/bin/env python3
"""Pack authored Bilby SVG or exported PNG frames into registered atlases.

Requires Pillow, NumPy, Node, and the repository's @resvg/resvg-wasm package.
No redrawing, temporal interpolation, or per-frame fitting occurs. Source files
remain unchanged; PNG working copies clear only individually reviewed debris.
Figma arranged each action on an eight-column grid. The duplicate final pose
straddles a row boundary, exposing the exact grid translation independently of
the character's animation. Subtracting that translation restores registration.
"""
from __future__ import annotations

import argparse
from collections import deque
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import tempfile
import xml.etree.ElementTree as ET
import zipfile

import numpy as np
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
SVG_NS = 'http://www.w3.org/2000/svg'
ET.register_namespace('', SVG_NS)
ACTION_NAMES = {
    'Waving': 'wave', 'Sleeping': 'sleep', 'Running': 'run', 'Searching': 'search',
    'Reviewing': 'review', 'Gifting': 'gift', 'Receiving': 'receive',
    'Saving': 'save', 'Organizing': 'album', 'Celebrating': 'celebrate',
}
SLEEP_DEBRIS_FRAMES = set(range(19, 28)) | {30, 31, 32, 36, 51}

NODE_RENDERER = r'''
const fs = require('node:fs');
const { initWasm, Resvg } = require('@resvg/resvg-wasm');
const plan = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
(async () => {
  await initWasm(fs.readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));
  for (const frame of plan) {
    const svg = fs.readFileSync(frame.svg, 'utf8');
    const renderer = new Resvg(svg, { fitTo: { mode: 'width', value: frame.size },
      font: { loadSystemFonts: false }, shapeRendering: 2 });
    const raster = renderer.render();
    fs.writeFileSync(frame.png, raster.asPng());
    raster.free(); renderer.free();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
'''


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def export_size(path):
    svg = ET.fromstring(path.read_text())
    box = [float(n) for n in svg.get('viewBox', '').replace(',', ' ').split()]
    if len(box) != 4:
        raise ValueError(f'{path}: SVG needs an explicit viewBox')
    return svg, box


def recover_grid(frames, columns):
    """Recover a row step from the authored identical last two poses."""
    previous, last = frames[-2:]
    c0, c1 = previous['index'] % columns, last['index'] % columns
    r0, r1 = previous['index'] // columns, last['index'] // columns
    if not (c0 != c1 and r0 != r1):
        raise ValueError('Final duplicate poses must straddle a source grid row.')
    # Figma's floating point transforms can differ by 0.001px after reparenting.
    if max(abs(previous[k] - last[k]) for k in ('width', 'height')) > .01:
        raise ValueError('Final pair bounds differ; explicit registration required.')
    step_x = (last['x'] - previous['x']) / (c1 - c0)
    step_y = (last['y'] - previous['y']) / (r1 - r0)
    if min(step_x, step_y) <= 0:
        raise ValueError('Recovered grid must have positive cell spacing.')
    return step_x, step_y


def extract_png_archive(archive, target):
    """Copy only explicitly named PNG members; never use archive paths directly."""
    records = []
    pattern = re.compile(r'(' + '|'.join(ACTION_NAMES) + r')(?:-(\d+))?\.png')
    with zipfile.ZipFile(archive) as source:
        members = source.infolist()
        if sum(member.file_size for member in members) > 256 * 1024 * 1024:
            raise ValueError('Unexpectedly large export archive.')
        seen = set()
        for member in members:
            match = pattern.fullmatch(member.filename)
            if not match or member.is_dir():
                raise ValueError(f'Unexpected archive member: {member.filename!r}')
            key = ACTION_NAMES[match.group(1)]
            index = int(match.group(2) or 0)
            if index > 56 or (key, index) in seen:
                raise ValueError(f'Duplicate or unexpected frame: {member.filename!r}')
            seen.add((key, index))
            path = target / key / f'frame_{index:03d}.png'
            path.parent.mkdir(parents=True, exist_ok=True)
            data = source.read(member)
            if not data.startswith(b'\x89PNG\r\n\x1a\n'):
                raise ValueError(f'Not PNG data: {member.filename!r}')
            path.write_bytes(data)
            with Image.open(path) as image:
                image.verify()
            with Image.open(path) as image:
                dimensions, mode = list(image.size), image.mode
            records.append({'key': key, 'index': index, 'archiveName': member.filename,
                            'file': str(path.relative_to(ROOT)), 'sha256': sha256(path),
                            'pixels': dimensions, 'mode': mode})
    manifest = {'archive': archive.name, 'sha256': sha256(archive),
                'members': len(records), 'frames': records}
    (target / 'archive-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    return manifest


def clear_verified_sleep_debris(image, index):
    """Clear reviewed remote top specks; retain every remaining pixel's origin."""
    if index not in SLEEP_DEBRIS_FRAMES:
        return image, []
    rgba = np.asarray(image).copy()
    mask = rgba[:, :, 3] > 0
    seen = np.zeros_like(mask)
    components = []
    for sy, sx in zip(*np.nonzero(mask)):
        if seen[sy, sx]:
            continue
        queue = deque([(int(sy), int(sx))])
        seen[sy, sx] = True
        points = []
        while queue:
            y, x = queue.popleft()
            points.append((y, x))
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < mask.shape[0] and 0 <= nx < mask.shape[1] and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        queue.append((ny, nx))
        yy, xx = zip(*points)
        components.append({'points': points, 'bbox': [min(xx), min(yy), max(xx) + 1, max(yy) + 1]})
    major = [c['bbox'] for c in components if len(c['points']) >= 40]
    cleared = []
    for component in components:
        x0, y0, x1, y1 = component['bbox']
        if not (len(component['points']) <= 25 and x0 >= 120 and y1 <= 8 and max(x1 - x0, y1 - y0) <= 8):
            continue
        gap = min(math.hypot(max(x0 - other[2], other[0] - x1, 0),
                             max(y0 - other[3], other[1] - y1, 0)) for other in major)
        if gap <= 80:
            continue
        for y, x in component['points']:
            rgba[y, x] = 0
        cleared.append({'sourceBounds': component['bbox'], 'rgbaPixelsRemoved': len(component['points']),
                        'gapToSignificantArtwork': gap})
    if not cleared:
        raise ValueError(f'Sleep frame {index}: reviewed speck signature changed; inspect source again.')
    return Image.fromarray(rgba), cleared


def render_png_frames(sequence, source_dir, frame_dir, size, columns, padding):
    """Apply one uniform transform to 1× PNG exports in their source coordinates."""
    frames = sorted(sequence['frames'], key=lambda frame: frame['index'])
    step_x, step_y = recover_grid(frames, columns)
    sources = []
    for frame in frames:
        path = source_dir / sequence['key'] / f"frame_{frame['index']:03d}.png"
        image = Image.open(path).convert('RGBA')
        # Figma's 1× export rounds each canvas upward to whole pixels. Do not
        # stretch these independently back to fractional bounding-box sizes.
        if abs(image.width - frame['width']) > 1.1 or abs(image.height - frame['height']) > 1.1:
            raise ValueError(f'{path}: expected 1× PNG dimensions matching source bounds.')
        cleared = []
        if sequence['key'] == 'sleep':
            image, cleared = clear_verified_sleep_debris(image, frame['index'])
        x = frame['x'] - frame['index'] % columns * step_x
        y = frame['y'] - frame['index'] // columns * step_y
        sources.append({'source': path, 'image': image, 'x': x, 'y': y, 'frame': frame,
                        'clearedDebris': cleared, 'visibleBounds': image.getchannel('A').getbbox()})
    # One union over all retained artwork chooses the sequence's shared canvas.
    # No frame is independently trimmed, translated, or resized after cleanup.
    x0 = min(s['x'] + s['visibleBounds'][0] for s in sources)
    y0 = min(s['y'] + s['visibleBounds'][1] for s in sources)
    x1 = max(s['x'] + s['visibleBounds'][2] for s in sources)
    y1 = max(s['y'] + s['visibleBounds'][3] for s in sources)
    side = max(x1 - x0, y1 - y0) / (1 - 2 * padding)
    center_x, center_y = (x0 + x1) / 2, (y0 + y1) / 2
    canvas = [center_x - side / 2, center_y - side / 2, side, side]
    scale = size / side
    frame_dir.mkdir(parents=True, exist_ok=True)
    rendered, provenance = [], []
    for source in sources:
        # Premultiplied color prevents dark fringes at fractional alpha edges.
        # Resampling is spatial only: every output has exactly one input frame.
        image = source['image'].convert('RGBa').transform(
            (size, size), Image.Transform.AFFINE,
            (1 / scale, 0, canvas[0] - source['x'],
             0, 1 / scale, canvas[1] - source['y']),
            resample=Image.Resampling.BICUBIC,
        ).convert('RGBA')
        index = source['frame']['index']
        image.save(frame_dir / f'frame_{index:03d}.png', optimize=True)
        rendered.append(image)
        provenance.append({
            'index': index, 'nodeId': source['frame']['id'],
            'png': str(source['source'].relative_to(ROOT)), 'sha256': sha256(source['source']),
            'sourcePixels': list(source['image'].size), 'exportScale': 1,
            'clearedDebris': source['clearedDebris'],
            'sourceBounds': {k: source['frame'][k] for k in ('x', 'y', 'width', 'height')},
            'registeredOrigin': [source['x'], source['y']],
        })
    return rendered, {
        'method': 'source-grid-translation; original 1× PNG pixels; uniform spatial resampling',
        'sourceGridColumns': columns, 'stepX': step_x, 'stepY': step_y,
        'sharedCanvas': canvas, 'uniformScale': scale, 'paddingFraction': padding,
        'sourcePixelRange': {'width': [min(s['image'].width for s in sources), max(s['image'].width for s in sources)],
                             'height': [min(s['image'].height for s in sources), max(s['image'].height for s in sources)]},
        'frames': provenance,
    }


def render_frames(sequence, source_dir, frame_dir, size, columns, padding, sheet_source=None):
    frames = sorted(sequence['frames'], key=lambda f: f['index'])
    if [f['index'] for f in frames] != list(range(len(frames))):
        raise ValueError('Frame indices must be contiguous and zero based.')
    step_x, step_y = recover_grid(frames, columns)
    sources = []
    for frame in frames:
        path = source_dir / sequence['key'] / f"frame_{frame['index']:03d}.svg"
        is_sheet = sheet_source is not None
        if is_sheet:
            path = sheet_source / f"{sequence['key']}.svg"
        svg, viewbox = export_size(path)
        x = frame['x'] - frame['index'] % columns * step_x
        y = frame['y'] - frame['index'] // columns * step_y
        sources.append({'source': path, 'svg': svg, 'viewbox': viewbox,
                        'x': x, 'y': y, 'frame': frame, 'is_sheet': is_sheet})
    x0, y0 = min(s['x'] for s in sources), min(s['y'] for s in sources)
    x1 = max(s['x'] + (s['frame']['width'] if s['is_sheet'] else s['viewbox'][2]) for s in sources)
    y1 = max(s['y'] + (s['frame']['height'] if s['is_sheet'] else s['viewbox'][3]) for s in sources)
    side = max(x1 - x0, y1 - y0) / (1 - 2 * padding)
    center_x, center_y = (x0 + x1) / 2, (y0 + y1) / 2
    canvas = [center_x - side / 2, center_y - side / 2, side, side]
    frame_dir.mkdir(parents=True, exist_ok=True)
    manifest = []
    provenance = []
    with tempfile.TemporaryDirectory(prefix='bilby-svg-') as temporary:
        temp = Path(temporary)
        for s in sources:
            svg = s['svg']
            # A nested SVG retains its original local coordinate system and IDs.
            index = s['frame']['index']
            svg.set('x', str(s['x']))
            svg.set('y', str(s['y']))
            if s['is_sheet']:
                svg.set('x', str(-(index % columns) * step_x))
                svg.set('y', str(-(index // columns) * step_y))
            svg.set('width', str(s['viewbox'][2]))
            svg.set('height', str(s['viewbox'][3]))
            wrapper = ET.Element(f'{{{SVG_NS}}}svg', {
                'width': str(size), 'height': str(size),
                'viewBox': ' '.join(str(v) for v in canvas),
            })
            wrapper.append(svg)
            staged = temp / f'frame_{index:03d}.svg'
            ET.ElementTree(wrapper).write(staged, encoding='unicode')
            output = frame_dir / f'frame_{index:03d}.png'
            manifest.append({'svg': str(staged), 'png': str(output), 'size': size})
            provenance.append({
                'index': index, 'nodeId': s['frame']['id'],
                'svg': str(s['source'].relative_to(ROOT)) if s['source'].is_relative_to(ROOT) else str(s['source']),
                'sha256': sha256(s['source']),
                'sourceBounds': {k: s['frame'][k] for k in ('x', 'y', 'width', 'height')},
                'registeredOrigin': [s['x'], s['y']],
                'svgViewBox': s['viewbox'],
            })
        plan = temp / 'plan.json'
        plan.write_text(json.dumps(manifest))
        subprocess.run(['node', '-e', NODE_RENDERER, str(plan)], cwd=ROOT, check=True)
    rendered = [Image.open(item['png']).convert('RGBA') for item in manifest]
    return rendered, {
        'method': 'source-grid-translation; identical final pose across row boundary',
        'sourceGridColumns': columns, 'stepX': step_x, 'stepY': step_y,
        'sharedCanvas': canvas, 'uniformScale': size / side,
        'paddingFraction': padding, 'frames': provenance,
    }


def difference(first, second):
    a = np.asarray(first, dtype=np.float32) / 255
    b = np.asarray(second, dtype=np.float32) / 255
    a[:, :, :3] *= a[:, :, 3:4]
    b[:, :, :3] *= b[:, :, 3:4]
    union = (a[:, :, 3] > .01) | (b[:, :, 3] > .01)
    return float(np.abs(a - b)[union].mean()) if union.any() else 0


def get_font(size):
    for path in ('/System/Library/Fonts/SFNS.ttf', '/System/Library/Fonts/Helvetica.ttc'):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            pass
    return ImageFont.load_default()


def contact_sheet(frames, path, title, indices=None, dark=False):
    indices = indices if indices is not None else list(range(len(frames)))
    columns, thumb, label, header = 8, 160, 22, 44
    rows = math.ceil(len(indices) / columns)
    bg, ink = ('#263757', '#FFFFFF') if dark else ('#FFFAF1', '#263757')
    board = Image.new('RGB', (columns * thumb, rows * (thumb + label) + header), bg)
    draw = ImageDraw.Draw(board)
    draw.text((14, 10), title, fill=ink, font=get_font(20))
    for order, index in enumerate(indices):
        image = frames[index].resize((thumb, thumb), Image.Resampling.LANCZOS)
        x, y = order % columns * thumb, order // columns * (thumb + label) + header
        board.paste(image, (x, y), image)
        draw.text((x + 8, y + thumb), f'{index + 1:02d}', fill=ink, font=get_font(14))
    board.save(path, optimize=True)


def gif_preview(frames, path, fps, pingpong=False):
    """A shared palette avoids color flicker; GIF is review-only, never runtime."""
    flattened = []
    for frame in frames:
        image = Image.new('RGB', frame.size, '#FFFAF1')
        image.paste(frame, (0, 0), frame)
        flattened.append(image)
    montage = Image.new('RGB', (80 * len(frames), 80))
    for i, image in enumerate(flattened):
        montage.paste(image.resize((80, 80)), (i * 80, 0))
    palette = montage.quantize(colors=256, method=Image.Quantize.MEDIANCUT)
    quantized = [im.quantize(palette=palette, dither=Image.Dither.NONE) for im in flattened]
    if pingpong:
        quantized += quantized[-2:0:-1]
    # Vary centisecond durations so long loops retain their requested cadence.
    durations = [10 * (round((i + 1) * 100 / fps) - round(i * 100 / fps))
                 for i in range(len(quantized))]
    quantized[0].save(path, save_all=True, append_images=quantized[1:],
                      duration=durations, loop=0, disposal=2, optimize=False)


def build(sequence, args):
    key = sequence['key']
    report = args.review / key
    report.mkdir(parents=True, exist_ok=True)
    if args.png_source:
        frames, registration = render_png_frames(sequence, args.png_source, report / 'frames',
                                                 args.size, args.columns, args.padding)
    else:
        frames, registration = render_frames(sequence, args.source, report / 'frames',
                                              args.size, args.columns, args.padding, args.sheet_source)
    columns, rows = args.columns, math.ceil(len(frames) / args.columns)
    atlas = Image.new('RGBA', (args.size * columns, args.size * rows))
    for index, frame in enumerate(frames):
        atlas.paste(frame, (index % columns * args.size, index // columns * args.size))
    args.output.mkdir(parents=True, exist_ok=True)
    atlas_path = args.output / f'{key}.png'
    atlas.save(atlas_path, optimize=True)
    poster = args.output / f'{key}-poster.png'
    frames[0].save(poster, optimize=True)
    contact_sheet(frames, report / 'contact-light.png', f'{sequence["name"]} · 57 authored frames')
    contact_sheet(frames, report / 'contact-dark.png', f'{sequence["name"]} · 57 authored frames', dark=True)
    contact_sheet(frames, report / 'endpoints.png', f'{key} · loop boundary',
                  list(range(4)) + list(range(len(frames) - 4, len(frames))))
    gif_preview(frames, report / 'forward.gif', args.fps)
    gif_preview(frames, report / 'ping-pong.gif', args.fps, pingpong=True)
    adjacent = [difference(a, b) for a, b in zip(frames, frames[1:])]
    if adjacent[-1] > .01:
        raise ValueError(f'{key}: final duplicate mismatch ({adjacent[-1]:.4f}); verify source registration.')
    loop = difference(frames[-1], frames[0])
    # Search plausible loop endpoints without silently discarding authored frames.
    candidates = sorted(({'start': a, 'end': b, 'distance': difference(frames[a], frames[b])}
                         for a in range(0, len(frames) - 15)
                         for b in range(a + 15, len(frames))),
                        key=lambda value: value['distance'])[:12]
    bounds = [frame.getchannel('A').getbbox() for frame in frames]
    margin = min(min(b[0], b[1], args.size - b[2], args.size - b[3]) for b in bounds)
    if margin < 4:
        raise ValueError(f'{key}: unsafe alpha margin: {margin}px')
    metadata = {
        'source': 'Figma 1× PNG exports of authored vector animation frames' if args.png_source else 'Figma authored vector animation frames',
        'fileKey': 'EQX5sbStSZeFf2lZCpvEJI', 'sequenceNodeId': sequence['id'],
        'key': key, 'name': sequence['name'], 'columns': columns, 'rows': rows,
        'frames': len(frames), 'fps': args.fps, 'cellSize': args.size, 'frameAspect': 1,
        'atlas': atlas_path.name, 'poster': poster.name,
        'registration': registration,
        'qa': {
            'sourceFramesPreserved': len(frames),
            'interpolation': False, 'redrawing': False,
            'minAlphaMarginPx': margin,
            'posterIdenticalToFirstFrame': sha256(poster) == sha256(report / 'frames' / 'frame_000.png'),
            'finalDuplicateDistance': adjacent[-1],
            'adjacentDistanceMedian': float(np.median(adjacent)),
            'adjacentDistanceMaximum': max(adjacent),
            'lastToFirstDistance': loop,
            'cyclicRangeCandidates': candidates,
        },
    }
    if key == 'wave':
        metadata['recommendedPlayback'] = {
            'mode': 'ping-pong', 'fps': args.fps, 'repeatDelayMs': 10000,
            'reason': 'Authored final smile has closed eyes; retracing the gesture avoids a last-to-first cut.',
        }
    elif key == 'sleep':
        cleared = [(frame['index'], item) for frame in registration['frames']
                   for item in frame.get('clearedDebris', [])]
        metadata['qa']['reviewedDebrisCleanup'] = {
            'components': len(cleared), 'frames': len(set(index for index, _ in cleared)),
            'rgbaPixels': sum(item['rgbaPixelsRemoved'] for _, item in cleared),
            'originalSourceFilesUnchanged': True,
            'rule': 'Reviewed isolated top specks: <=25 alpha pixels, <=8px extent, x>=120/y<8, >80px from significant artwork. Character and real bubbles unchanged.',
        }
        metadata['recommendedPlayback'] = {
            'mode': 'ping-pong', 'fps': args.fps, 'repeatDelayMs': 1500,
            'reason': 'Return through authored breathing and bubble poses before resting at the original pose.',
        }
    elif key == 'run':
        metadata['recommendedPlayback'] = {
            'mode': 'loop', 'fps': args.fps,
            'introRangeInclusive': [0, 20], 'loopRangeInclusive': [21, 32],
            'rangeIsZeroBased': True,
            'reason': 'One forward stride with matching heel-strike phase. Avoids source placement jumps at 34/46/49–52 and the late held pose. All57 source frames remain in the atlas.',
            'loopSeamDistance': difference(frames[32], frames[21]),
            'authoredNextFrameDistance': difference(frames[32], frames[33]),
        }
        contact_sheet(frames, report / 'cycle-boundary.png', 'Running · selected forward loop boundary (1-based labels)',
                      [29, 30, 31, 32, 21, 22, 23, 24])
        gif_preview(frames[21:33], report / 'cycle-forward.gif', args.fps)
    # PNG encoders can differ; validate poster content rather than compressed bytes.
    metadata['qa']['posterIdenticalToFirstFrame'] = np.array_equal(np.asarray(Image.open(poster)), np.asarray(frames[0]))
    (args.output / f'{key}.json').write_text(json.dumps(metadata, indent=2) + '\n')
    print(f'{key}: {len(frames)} frames, {columns}×{rows} atlas, {margin}px margin; '
          f'loop {loop:.4f}, adjacent median {np.median(adjacent):.4f}', flush=True)
    return metadata


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inventory', type=Path, default=ROOT / 'docs/design/figma-import/frame-inventory.json')
    parser.add_argument('--source', type=Path, default=ROOT / 'docs/design/figma-import/svg')
    parser.add_argument('--sheet-source', type=Path,
                        help='Directory of original whole-sequence SVG exports named wave.svg etc.; uses shared source grid cropping.')
    parser.add_argument('--png-source', type=Path,
                        help='Directory of original individual 1× PNG exports in action/frame_000.png layout.')
    parser.add_argument('--png-zip', type=Path,
                        help='Securely import a Figma PNG archive into --png-source before packing selected actions.')
    parser.add_argument('--output', type=Path, default=ROOT / 'app/assets/bilby-sprites/figma')
    parser.add_argument('--review', type=Path, default=ROOT / 'reports/figma-import')
    parser.add_argument('--key', action='append', help='Build only named actions; repeat to select several.')
    parser.add_argument('--size', type=int, default=320)
    parser.add_argument('--columns', type=int, default=8)
    parser.add_argument('--padding', type=float, default=.055)
    parser.add_argument('--fps', type=float, default=24)
    args = parser.parse_args()
    for name in ('inventory', 'source', 'sheet_source', 'png_source', 'png_zip', 'output', 'review'):
        value = getattr(args, name)
        if value is not None:
            setattr(args, name, value.resolve())
    if args.png_zip:
        args.png_source = args.png_source or ROOT / 'docs/design/figma-import/png'
        extract_png_archive(args.png_zip, args.png_source)
    if args.png_source and args.sheet_source:
        parser.error('Choose PNG or SVG input, not both.')
    sequences = json.loads(args.inventory.read_text())
    for sequence in sequences:
        if args.key and sequence['key'] not in args.key:
            continue
        build(sequence, args)


if __name__ == '__main__':
    main()
