#!/usr/bin/env python3
"""Build an offline, self-contained Bilby sprite comparison page.

Usage:
  python3 scripts/render_motion_review.py reports/bilby-motion-v2/manifest.json \
    --output reports/bilby-motion-v2/review.html --gifs reports/bilby-motion-v2/gifs

Manifest:
  {"title": "Bilby motion v2", "animations": [{
    "id": "wave", "label": "Waving", "context": "Welcome / Home", "displaySize": 180,
    "before": {"path": "../../app/assets/bilby-sprites/wave.png",
      "columns": 2, "rows": 2, "frames": 4, "fps": 5, "label": "Current"},
    "after": {"path": "candidate-wave.png", "columns": 4, "rows": 4,
      "frames": 16, "fps": 12, "label": "Candidate"}
  }]}

Paths resolve relative to the manifest. Each cell is rendered into a square by
default, matching the app; optional frameAspect matches the app's sprite option.
Use --allow-missing while candidate sheets are being generated: missing art is
explicitly marked, never replaced with the current art. No remote assets/scripts.
Pillow is used for validation and optional GIF export; no new dependency installer.
"""

import argparse
import base64
import html
import io
import json
import math
from pathlib import Path
import sys

from PIL import Image, ImageDraw

CREAM = "#FFFAF1"
RESAMPLE = getattr(Image, "Resampling", Image).LANCZOS


def positive_number(value, field, integer=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
        raise ValueError(f"{field} must be a positive number")
    if integer and int(value) != value:
        raise ValueError(f"{field} must be an integer")
    return int(value) if integer else float(value)


def load_source(raw, base, *, allow_missing=False):
    if not isinstance(raw, dict):
        raise ValueError("Each before/after source must be an object")
    source = {key: positive_number(raw.get(key), key, integer=key != "fps")
              for key in ("columns", "rows", "frames", "fps")}
    if source["frames"] > source["columns"] * source["rows"]:
        raise ValueError("frames exceeds the grid's cell count")
    if source["fps"] > 120:
        raise ValueError("fps must not exceed 120")
    source["label"] = str(raw.get("label", ""))
    source["aspect"] = positive_number(raw.get("frameAspect", 1), "frameAspect")
    source["duration"] = source["frames"] / source["fps"]
    path = Path(raw["path"]).expanduser()
    path = path if path.is_absolute() else base / path
    source["filename"] = path.name
    if not path.is_file():
        if not allow_missing:
            raise ValueError(f"Sprite file does not exist: {path}")
        source.update(missing=True, data=None)
        return source
    with Image.open(path) as image:
        if image.format != "PNG":
            raise ValueError(f"Expected PNG sprite art: {path}")
        width, height = image.size
        if width % source["columns"] or height % source["rows"]:
            raise ValueError(f"{path.name}: {width}×{height} does not divide evenly into the declared grid")
        source.update(width=width, height=height, cellWidth=width // source["columns"],
                      cellHeight=height // source["rows"], missing=False)
    source["data"] = "data:image/png;base64," + base64.b64encode(path.read_bytes()).decode("ascii")
    return source


def load_manifest(path, allow_missing):
    raw = json.loads(path.read_text())
    items = raw.get("animations")
    if not isinstance(items, list) or not items:
        raise ValueError("Manifest requires a nonempty animations array")
    animations, ids = [], set()
    for item in items:
        animation_id = str(item["id"])
        if animation_id in ids:
            raise ValueError(f"Duplicate animation id: {animation_id}")
        ids.add(animation_id)
        animation = {"id": animation_id, "label": str(item.get("label", animation_id)),
                     "context": str(item.get("context", "")),
                     "displaySize": positive_number(item.get("displaySize", 180), "displaySize", True)}
        if animation["displaySize"] > 600:
            raise ValueError("displaySize must not exceed 600 pixels")
        animation["before"] = load_source(item["before"], path.parent)
        animation["after"] = load_source(item["after"], path.parent, allow_missing=allow_missing)
        animations.append(animation)
    return {"title": str(raw.get("title", "Bilby motion comparison")), "animations": animations}


DOCUMENT = r'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>__TITLE__</title>
<style>
:root{font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#14284B;background:#F3F0E9;font-size:15px;line-height:1.5}
*{box-sizing:border-box}body{margin:0}main{max-width:1120px;margin:auto;padding:30px 24px 60px}h1{font-size:30px;line-height:1.2;margin:0 0 8px;letter-spacing:-.7px}h2{font-size:21px;margin:0}.intro{color:#5C6980;max-width:760px;margin:0 0 22px}.controls{position:sticky;top:0;z-index:2;display:flex;align-items:center;flex-wrap:wrap;gap:12px;padding:14px 16px;background:#FFFEFA;border:1px solid #E9E2D5;border-radius:16px;box-shadow:0 3px 15px #14284b09;margin-bottom:22px}.control{display:flex;gap:7px;align-items:center;font-size:13px}button,select{font:inherit;color:inherit;border:1px solid #D6D7DA;border-radius:9px;background:#fffefa;padding:9px 12px;min-height:40px}button{cursor:pointer}button:hover{background:#EAF0FF}button:disabled{cursor:default;opacity:.5}button.primary{background:#3264ED;color:white;border-color:#244CB7;min-width:92px}button:focus-visible,select:focus-visible,input:focus-visible,summary:focus-visible{outline:3px solid #3264ED;outline-offset:3px}input[type=checkbox]{width:17px;height:17px;accent-color:#3264ED}input[type=range]{accent-color:#3264ED;min-height:40px;min-width:80px}.review{background:#FFFEFA;border:1px solid #E9E2D5;border-radius:18px;padding:20px;margin:0 0 22px}.row-title{display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:6px;margin-bottom:16px}.context,.size-note{color:#5C6980;font-size:13px;margin:3px 0}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}.sample{min-width:0;border:1px solid #E9E2D5;border-radius:13px;overflow:hidden}.sample-head{display:flex;align-items:center;justify-content:space-between;gap:8px;background:#F7F0E3;padding:10px 13px;font-size:13px}.version{font-weight:750}.canvas-stage{background:#FFFAF1;min-height:262px;display:flex;align-items:center;justify-content:center;padding:18px;overflow:auto}canvas{display:block;flex:none}.meta{font-variant-numeric:tabular-nums;font-size:12px;color:#5C6980;padding:10px 13px;display:flex;flex-wrap:wrap;gap:4px 12px;border-top:1px solid #E9E2D5}.scrub{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:13px}.scrub input{flex:1}.scrub output{font-variant-numeric:tabular-nums;min-width:115px;font-size:13px}.step{padding:6px 12px;font-size:17px}.sheet-toggle{margin-top:12px;font-size:12px;color:#5C6980}.sheets{display:grid;grid-template-columns:1fr 1fr;gap:14px;padding-top:12px}.sheets img{display:block;width:100%;height:auto;background-color:#fffafa;background-image:linear-gradient(45deg,#eee 25%,transparent 25%),linear-gradient(-45deg,#eee 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#eee 75%),linear-gradient(-45deg,transparent 75%,#eee 75%);background-size:16px 16px;background-position:0 0,0 8px,8px -8px,-8px 0}.missing{font-size:13px;max-width:220px;text-align:center;color:#5C6980}.note{font-size:12px;color:#5C6980;max-width:820px}.loading{color:#5C6980;font-size:13px}.file{overflow-wrap:anywhere}summary{cursor:pointer}.footer{margin-top:26px;border-top:1px solid #D9D7D2;padding-top:16px}select{max-width:210px}[hidden]{display:none!important}
@media(max-width:600px){main{padding:18px 12px 40px}h1{font-size:25px}.controls{gap:8px;padding:10px;position:relative}.review{padding:13px}.pair{gap:8px}.canvas-stage{min-height:226px;padding:8px;justify-content:flex-start}.sample-head{padding:8px;font-size:12px;flex-wrap:wrap}.meta{padding:8px}.control{font-size:12px}.size-note{display:none}.scrub{gap:6px}.scrub output{min-width:90px;font-size:12px}.sheets{gap:8px}}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}
</style></head><body><main>
<h1 id="title"></h1><p class="intro">Compare the original and revised animations at the size used in the app. Pause and scrub to check pose continuity, spacing, and the transition back to the first frame.</p>
<div class="controls" aria-label="Playback controls">
  <button class="primary" id="play" disabled>Loading…</button><button id="restart" disabled>Restart</button>
  <label class="control">Speed <select id="speed"><option value="0.25">¼× slow</option><option value="0.5">½× slow</option><option value="1" selected>1× actual</option><option value="2">2× fast</option></select></label>
  <label class="control">Preview <select id="zoom"><option value="1">App size</option><option value="2">2× inspect</option></select></label>
  <label class="control"><input id="sync" type="checkbox"> Match loop lengths</label>
  <label class="control">Show <select id="filter"><option value="all">All motions</option></select></label>
</div>
<p id="loading" class="loading" role="status">Loading embedded artwork…</p>
<div id="reviews"></div>
<p class="note footer"><strong>Timing:</strong> “1× actual” plays each sheet at its configured frame rate. “Match loop lengths” retimes the original to the candidate’s cycle for pose comparison. Scrubbing pauses all playback and aligns both sheets to the same fraction of a loop. No frame interpolation, generated in-between frames, character redrawing, or extra bobbing is added here.</p>
<p class="note">Artwork is embedded in this file. It opens offline and sends no requests. Reduced-motion preferences start playback paused. Any exported GIF is a convenience preview: GIF timing is quantized and transparency is composited onto cream; this PNG-based page is the reference.</p>
</main><script type="application/json" id="manifest">__DATA__</script><script>
(()=>{
"use strict";
const manifest=JSON.parse(document.getElementById('manifest').textContent);
document.getElementById('title').textContent=manifest.title;
const ui=Object.fromEntries(['play','restart','speed','zoom','sync','filter','loading','reviews'].map(k=>[k,document.getElementById(k)]));
let playing=false,ready=false,speed=1,zoom=1,raf=0,lastTime=0;
const rows=[];
const fmt=n=>Number(n.toFixed(3)).toString();
function element(tag,className,text){const e=document.createElement(tag);if(className)e.className=className;if(text!==undefined)e.textContent=text;return e;}
function frameOf(source){return Math.min(source.frames-1,Math.floor(((source.position%source.duration)+1e-7)*source.fps));}
function dimensions(source,size){return source.aspect>=1?[size,size/source.aspect]:[size*source.aspect,size];}
function reference(row){return row.after.missing?row.before:row.after;}
function draw(source,row,force=false){
 if(source.missing)return;
 const frame=frameOf(source),key=frame+':'+zoom;
 if(!force&&source.lastKey===key)return;
 source.lastKey=key;
 const size=row.displaySize*zoom,[w,h]=dimensions(source,size),dpr=Math.min(window.devicePixelRatio||1,2);
 source.canvas.width=Math.round(w*dpr);source.canvas.height=Math.round(h*dpr);
 source.canvas.style.width=w+'px';source.canvas.style.height=h+'px';
 const context=source.canvas.getContext('2d');context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';
 context.drawImage(source.image,(frame%source.columns)*source.cellWidth,Math.floor(frame/source.columns)*source.cellHeight,source.cellWidth,source.cellHeight,0,0,source.canvas.width,source.canvas.height);
 source.counter.textContent='Frame '+(frame+1)+' / '+source.frames;
 source.canvas.setAttribute('aria-label',source.label+', '+row.label+', frame '+(frame+1)+' of '+source.frames);
}
function render(force=false){for(const row of rows){draw(row.before,row,force);draw(row.after,row,force);const source=reference(row),index=frameOf(source);row.scrubber.value=index;row.frameOutput.textContent='Frame '+(index+1)+' / '+source.frames;}}
function tick(now){
 if(!playing)return;
 const delta=lastTime?Math.min((now-lastTime)/1000,.1)*speed:0;lastTime=now;
 for(const row of rows){const ref=reference(row);for(const source of [row.before,row.after])if(!source.missing)source.position+=delta*(ui.sync.checked?source.duration/ref.duration:1);}
 render();raf=requestAnimationFrame(tick);
}
function setPlaying(next){if(!ready)return;playing=next;ui.play.textContent=playing?'Pause':'Play';ui.play.setAttribute('aria-pressed',String(playing));cancelAnimationFrame(raf);lastTime=0;if(playing)raf=requestAnimationFrame(tick);}
function scrub(row,frame){setPlaying(false);const ref=reference(row),index=(frame+ref.frames)%ref.frames,phase=index/ref.frames;for(const source of [row.before,row.after])source.position=phase*source.duration;render(true);}
function sample(row,source,label){
 source.position=0;source.label=source.label||label;
 const panel=element('div','sample'),head=element('div','sample-head');
 head.append(element('span','version',source.label));source.counter=element('span','counter',source.missing?'Pending artwork':'');head.append(source.counter);
 const stage=element('div','canvas-stage');
 if(source.missing){stage.append(element('p','missing','Candidate artwork has not been generated yet. Rebuild this page when the PNG is ready.'));}
 else {source.canvas=element('canvas');source.canvas.setAttribute('role','img');stage.append(source.canvas);}
 const meta=element('div','meta');
 meta.append(element('span','',source.frames+' frames · '+source.columns+' × '+source.rows),element('span','',fmt(source.fps)+' fps · '+fmt(source.duration)+' s / loop'));
 if(!source.missing)meta.append(element('span','',source.cellWidth+' × '+source.cellHeight+' source cell'));
 meta.append(element('span','file',source.filename));panel.append(head,stage,meta);
 return panel;
}
for(const item of manifest.animations){
 const row={...item};rows.push(row);
 const section=element('section','review');row.section=section;section.setAttribute('aria-label',row.label+' comparison');
 const header=element('div','row-title'),title=element('div');title.append(element('h2','',row.label));if(row.context)title.append(element('p','context',row.context));header.append(title,element('span','size-note',row.displaySize+' px app box'));
 const pair=element('div','pair');pair.append(sample(row,row.before,'Original'),sample(row,row.after,'Candidate'));
 const ref=reference(row),scrubber=element('div','scrub'),previous=element('button','step','←'),next=element('button','step','→');
 previous.setAttribute('aria-label','Previous '+row.label+' frame');next.setAttribute('aria-label','Next '+row.label+' frame');
 row.scrubber=element('input');row.scrubber.type='range';row.scrubber.min=0;row.scrubber.max=ref.frames-1;row.scrubber.step=1;row.scrubber.value=0;row.scrubber.setAttribute('aria-label',row.label+' frame');
 row.frameOutput=element('output');row.scrubber.addEventListener('input',()=>scrub(row,Number(row.scrubber.value)));previous.addEventListener('click',()=>scrub(row,frameOf(ref)-1));next.addEventListener('click',()=>scrub(row,frameOf(ref)+1));scrubber.append(previous,row.scrubber,next,row.frameOutput);
 const details=element('details','sheet-toggle');details.append(element('summary','','Inspect complete sprite sheets'));const sheets=element('div','sheets');
 for(const source of [row.before,row.after]){if(source.missing)sheets.append(element('p','missing','Candidate sheet pending'));else{const img=element('img');img.src=source.data;img.alt=source.label+' '+row.label+' complete sprite sheet';img.loading='lazy';sheets.append(img);}}
 details.append(sheets);section.append(header,pair,scrubber,details);ui.reviews.append(section);
 const option=element('option','',row.label);option.value=row.id;ui.filter.append(option);
}
ui.play.addEventListener('click',()=>setPlaying(!playing));
ui.restart.addEventListener('click',()=>{for(const row of rows)for(const source of [row.before,row.after])source.position=0;lastTime=0;render(true);});
ui.speed.addEventListener('change',()=>{speed=Number(ui.speed.value);lastTime=0;});
ui.zoom.addEventListener('change',()=>{zoom=Number(ui.zoom.value);render(true);});
ui.sync.addEventListener('change',()=>{for(const row of rows){const ref=reference(row),phase=(ref.position%ref.duration)/ref.duration;for(const source of [row.before,row.after])source.position=phase*source.duration;}render(true);});
ui.filter.addEventListener('change',()=>{for(const row of rows)row.section.hidden=ui.filter.value!=='all'&&ui.filter.value!==row.id;});
document.addEventListener('visibilitychange',()=>{lastTime=0;});
Promise.all(rows.flatMap(row=>[row.before,row.after]).filter(source=>!source.missing).map(source=>new Promise((resolve,reject)=>{source.image=new Image();source.image.onload=resolve;source.image.onerror=()=>reject(new Error('Cannot decode '+source.filename));source.image.src=source.data;}))).then(()=>{
 ready=true;ui.play.disabled=false;ui.restart.disabled=false;ui.loading.hidden=true;render(true);setPlaying(!window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}).catch(error=>{ui.loading.textContent=error.message;ui.play.textContent='Unavailable';});
})();
</script></body></html>'''


def write_review(manifest, output):
    data = json.dumps(manifest, ensure_ascii=False).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
    document = DOCUMENT.replace("__TITLE__", html.escape(manifest["title"])).replace("__DATA__", data)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(document)


def decoded_image(source):
    return Image.open(io.BytesIO(base64.b64decode(source["data"].split(",", 1)[1]))).convert("RGBA")


def tile_at(image, source, frame, size):
    x, y = frame % source["columns"] * source["cellWidth"], frame // source["columns"] * source["cellHeight"]
    tile = image.crop((x, y, x + source["cellWidth"], y + source["cellHeight"]))
    aspect = source["aspect"]
    dimensions = (size, round(size / aspect)) if aspect >= 1 else (round(size * aspect), size)
    return tile.resize(dimensions, RESAMPLE)


def export_gifs(manifest, directory, seconds):
    directory.mkdir(parents=True, exist_ok=True)
    for animation in manifest["animations"]:
        if animation["after"]["missing"]:
            continue
        sources = [animation["before"], animation["after"]]
        images = [decoded_image(source) for source in sources]
        size = animation["displaySize"]
        pad, gap, header = 18, 22, 34
        width, height = size * 2 + pad * 2 + gap, size + pad * 2 + header
        # GIF timing uses 10 ms units. Prefer a shared sample rate and note the limitation in HTML.
        sample_fps = min(30, max(source["fps"] for source in sources) * 2)
        delay = max(20, round(1000 / sample_fps / 10) * 10)
        frames = []
        for number in range(math.ceil(seconds * 1000 / delay)):
            elapsed = number * delay / 1000
            canvas = Image.new("RGB", (width, height), CREAM)
            drawing = ImageDraw.Draw(canvas)
            for i, (image, source) in enumerate(zip(images, sources)):
                frame = int(elapsed * source["fps"]) % source["frames"]
                tile = tile_at(image, source, frame, size)
                left = pad + i * (size + gap)
                label = source["label"] or ("Original" if i == 0 else "Candidate")
                text = f"{label}: {source['frames']} frames / {source['fps']:g} fps"
                # Pillow's built-in font is portable; replace unsupported glyphs only in GIF labels.
                drawing.text((left, 12), text.encode("latin-1", "replace").decode("latin-1"), fill="#14284B")
                canvas.paste(tile, (left + (size - tile.width) // 2, header + pad + (size - tile.height) // 2), tile)
            frames.append(canvas)
        safe_id = "".join(c if c.isalnum() or c in "-_" else "-" for c in animation["id"])
        target = directory / f"{safe_id}-comparison.gif"
        frames[0].save(target, save_all=True, append_images=frames[1:], duration=delay, loop=0, disposal=2)
        print(f"GIF {target} ({len(frames)} frames, {delay} ms/frame)")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--output", type=Path, default=Path("reports/bilby-motion-v2/review.html"))
    parser.add_argument("--allow-missing", action="store_true", help="Allow missing candidate files and visibly label them pending")
    parser.add_argument("--gifs", type=Path, help="Optional directory for small side-by-side animated GIF previews")
    parser.add_argument("--gif-seconds", type=float, default=4, help="GIF sample duration, default 4 seconds")
    args = parser.parse_args()
    try:
        if not math.isfinite(args.gif_seconds) or not 0 < args.gif_seconds <= 20:
            raise ValueError("--gif-seconds must be between 0 and 20")
        manifest = load_manifest(args.manifest.resolve(), args.allow_missing)
        write_review(manifest, args.output)
        print(f"HTML {args.output} ({args.output.stat().st_size:,} bytes; {len(manifest['animations'])} comparisons)")
        if args.gifs:
            export_gifs(manifest, args.gifs, args.gif_seconds)
    except (ValueError, KeyError, OSError) as error:
        print(f"Motion review: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
