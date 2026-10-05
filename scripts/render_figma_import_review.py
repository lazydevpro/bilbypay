#!/usr/bin/env python3
"""Build a self-contained review of imported Figma animation atlases.

Run from any directory:
  python3 scripts/render_figma_import_review.py

The manifest supplies playback settings; atlas metadata supplies exact source
frames, provenance and dimensions. No frames are drawn, blended or interpolated.
An optional inclusive, zero-based frameRange limits playback while the scrubber
continues to expose every imported frame. Pillow only validates atlas dimensions.
"""
from __future__ import annotations

import argparse
import base64
import html
import json
import math
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]


def build_data(manifest_path: Path) -> dict:
    manifest = json.loads(manifest_path.read_text())
    result = {"title": manifest.get("title", "Bilby · imported animations"),
              "pending": manifest["pending"], "actions": []}
    ids = set()
    for settings in manifest["actions"]:
        key = settings["key"]
        if key in ids:
            raise ValueError(f"Duplicate action: {key}")
        ids.add(key)
        meta_path = (manifest_path.parent / settings["metadata"]).resolve()
        meta = json.loads(meta_path.read_text())
        count, columns, rows = (int(meta[k]) for k in ("frames", "columns", "rows"))
        if min(count, columns, rows) < 1 or count > columns * rows:
            raise ValueError(f"Invalid atlas grid for {key}")
        path = meta_path.parent / meta["atlas"]
        with Image.open(path) as image:
            if image.format != "PNG" or image.mode != "RGBA":
                raise ValueError(f"{path}: expected an RGBA PNG")
            width, height = image.size
        if width % columns or height % rows:
            raise ValueError(f"{path}: image dimensions do not match grid")
        fps = float(settings.get("fps", meta["fps"]))
        if not math.isfinite(fps) or not 0 < fps <= 60:
            raise ValueError(f"Invalid frame rate for {key}")
        mode = settings["playback"]
        if mode not in ("once", "loop", "ping-pong"):
            raise ValueError(f"Unknown playback mode: {mode}")
        frame_range = settings.get("frameRange", [0, count - 1])
        if (len(frame_range) != 2 or any(type(n) is not int for n in frame_range)
                or not 0 <= frame_range[0] <= frame_range[1] < count):
            raise ValueError(f"Invalid inclusive frameRange for {key}")
        intro_range = settings.get("introRange")
        if intro_range is not None and (mode != "loop" or len(intro_range) != 2
                or any(type(n) is not int for n in intro_range)
                or not 0 <= intro_range[0] <= intro_range[1] < frame_range[0]):
            raise ValueError(f"Invalid inclusive introRange for {key}")
        repeat = settings.get("repeatDelayMs")
        if repeat is not None and (not isinstance(repeat, (int, float)) or repeat < 0):
            raise ValueError(f"Invalid rest duration for {key}")
        display_size = int(settings["displaySize"])
        if not 40 <= display_size <= 400:
            raise ValueError(f"Invalid app display size for {key}")
        provenance = meta.get("registration", {}).get("frames", [])
        has_png = any("png" in frame for frame in provenance)
        has_svg = any("svg" in frame for frame in provenance)
        source_label = "PNG export" if has_png else "SVG render" if has_svg else meta["source"]
        result["actions"].append({
            "key": key, "label": settings["label"], "context": settings["context"],
            "displaySize": display_size, "columns": columns, "rows": rows,
            "frames": count, "fps": fps, "playback": mode,
            "repeatDelayMs": repeat, "frameRange": frame_range, "introRange": intro_range,
            "cellWidth": width // columns, "cellHeight": height // rows,
            "sourceLabel": source_label, "sourceDescription": meta["source"],
            "sourcePixels": meta.get("registration", {}).get("sourcePixelRange"),
            "note": settings.get("note", ""),
            "data": "data:image/png;base64," + base64.b64encode(path.read_bytes()).decode("ascii"),
        })
    return result


DOCUMENT = r'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>__TITLE__</title>
<style>
:root{font:15px/1.5 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1d304a;background:#f4f2ed}
*{box-sizing:border-box}body{margin:0}main{max-width:1180px;margin:auto;padding:32px 24px 48px}h1{font-size:28px;line-height:1.2;letter-spacing:-.6px;margin:0 0 8px}h2{font-size:20px;margin:0}p{margin:0}.intro{max-width:820px;color:#566477}.toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:24px 0 20px}button,select{font:inherit;color:inherit;background:#fff;border:1px solid #cbd0d7;border-radius:8px;min-height:42px;padding:8px 12px}button{cursor:pointer}button:hover{background:#edf2fb}button:disabled{opacity:.5;cursor:default}button.primary{background:#285bdb;border-color:#285bdb;color:white}button:focus-visible,select:focus-visible,input:focus-visible{outline:3px solid #3e73ed;outline-offset:3px}label{display:flex;align-items:center;gap:8px;font-size:13px}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.card{background:#fff;border:1px solid #dfe1e3;border-radius:12px;overflow:hidden;min-width:0}.heading{padding:17px 18px 14px}.sub{font-size:13px;color:#5a687a;margin-top:2px}.badge{font-size:11px;font-weight:700;letter-spacing:.02em;padding:3px 7px;background:#edf1f7;border-radius:5px;display:inline-block;margin-top:10px}.stage{height:290px;background:#fff9ed;display:flex;align-items:center;justify-content:center;overflow:hidden;border-top:1px solid #eee9df;border-bottom:1px solid #eee9df}.stage.dark{background:#263757}canvas{display:block;flex:none}.controls{padding:14px 18px 18px}.readout{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:#5a687a;font-variant-numeric:tabular-nums;min-height:20px}.scrub{display:flex;gap:8px;align-items:center;margin:8px 0 12px}.scrub input{width:100%;min-width:40px;accent-color:#285bdb;min-height:35px}.scrub button{padding:4px 10px;min-width:38px}.play-row{display:flex;gap:8px}.play-row button{font-size:13px;flex:1}.timing{font-size:12px;color:#5a687a;margin-top:12px;min-height:36px}.note{font-size:12px;color:#5a687a;margin-top:8px}.status{font-size:13px;color:#526377;min-height:22px;margin-bottom:12px}.pending{margin-top:24px;padding-top:18px;border-top:1px solid #d9dde2}.pending strong{font-size:14px}.pending p{font-size:13px;color:#5a687a;margin-top:4px}.fineprint{margin-top:18px;font-size:12px;color:#5a687a;max-width:920px}[hidden]{display:none!important}
@media(max-width:960px){.cards{grid-template-columns:1fr}.card{display:grid;grid-template-columns:1fr 1fr}.heading{grid-column:1/-1}.stage{height:280px;border-bottom:0}.controls{display:flex;flex-direction:column;justify-content:center}.timing{min-height:0}}
@media(max-width:560px){main{padding:22px 14px 36px}h1{font-size:24px}.card{display:block}.stage{height:280px;border-bottom:1px solid #eee9df}.toolbar{gap:8px}label{flex-wrap:wrap}.toolbar button,.toolbar select{font-size:13px}}
</style></head><body><main>
<h1 id="title"></h1>
<p class="intro">Three imported Figma actions at their app sizes. Play the configured timing, or pause and inspect any authored frame.</p>
<div class="toolbar" aria-label="Review controls"><button class="primary" id="play-all" disabled>Loading…</button><button id="restart-all" disabled>Restart all</button><label>Speed <select id="speed"><option value="0.25">¼×</option><option value="0.5">½×</option><option value="1" selected>1× actual</option></select></label><label>Background <select id="background"><option value="light">Light</option><option value="dark">Dark</option></select></label></div>
<p id="status" class="status" role="status">Loading embedded artwork…</p>
<div class="cards" id="cards"></div>
<section class="pending"><strong id="pending-title"></strong><p id="pending-actions"></p></section>
<p class="fineprint">Every preview uses the exact atlas tiles. No frame blending, extra bobbing, or character redrawing is added. Scrubbing shows all imported frames, including frames outside a configured running cycle. PNG exports may look softer when enlarged; SVG renders retain their source curves.</p>
<p class="fineprint">Artwork is embedded: this file opens offline and sends no requests. Reduced-motion preferences start playback paused. Playback pauses while the page is hidden.</p>
</main><script type="application/json" id="data">__DATA__</script><script>
(()=>{
'use strict';
const data=JSON.parse(document.getElementById('data').textContent);
document.getElementById('title').textContent=data.title;
document.getElementById('pending-title').textContent=`${data.actions.length} of ${data.actions.length+data.pending.length} actions imported`;
document.getElementById('pending-actions').textContent=`Still pending: ${data.pending.join(', ')}.`;
const host=document.getElementById('cards'),status=document.getElementById('status');
const playAll=document.getElementById('play-all'),restartAll=document.getElementById('restart-all');
let speed=1,lastTime=0,ready=false;
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
function el(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
function fmt(value){return Number(value.toFixed(2)).toString();}
const rows=data.actions.map(action=>{
 const card=el('article','card');card.id=action.key;
 const heading=el('div','heading');heading.append(el('h2','',action.label),el('p','sub',action.context),el('span','badge',action.sourceLabel));
 const stage=el('div','stage'),canvas=el('canvas');canvas.setAttribute('role','img');canvas.setAttribute('aria-label',`${action.label} animation preview`);stage.append(canvas);
 const controls=el('div','controls'),readout=el('div','readout'),frameLabel=el('span','','Frame 1'),stateLabel=el('span','','Ready');readout.append(frameLabel,stateLabel);
 const scrub=el('div','scrub'),prev=el('button','','‹'),range=el('input'),next=el('button','','›');
 prev.setAttribute('aria-label',`Previous ${action.label} frame`);next.setAttribute('aria-label',`Next ${action.label} frame`);range.type='range';range.min=0;range.max=action.frames-1;range.step=1;range.value=0;range.setAttribute('aria-label',`${action.label} frame`);scrub.append(prev,range,next);
 const playRow=el('div','play-row'),play=el('button','','Play'),restart=el('button','','Restart');play.disabled=true;restart.disabled=true;play.setAttribute('aria-label',`Play ${action.label}`);playRow.append(play,restart);
 const rangeLabel=action.frameRange[0]===0&&action.frameRange[1]===action.frames-1?'':` · frames ${action.frameRange[0]+1}–${action.frameRange[1]+1}`;
 const mode=action.playback==='ping-pong'?'Forward and back':action.playback==='loop'?'Forward loop':'Play once';
 const introLabel=action.introRange?`Intro ${action.introRange[0]+1}–${action.introRange[1]+1}, then `:'';
 const timing=el('p','timing',`${action.frames} frames · ${fmt(action.fps)} fps · ${action.displaySize}px\n${introLabel}${mode}${rangeLabel}${action.repeatDelayMs?` · ${fmt(action.repeatDelayMs/1000)}s rest`:''}`);timing.style.whiteSpace='pre-line';
 controls.append(readout,scrub,playRow,timing);if(action.note)controls.append(el('p','note',action.note));card.append(heading,stage,controls);host.append(card);
 const image=new Image();const row={...action,image,canvas,stage,range,frameLabel,stateLabel,play,restart,playing:false,elapsed:0,override:null,rendered:-1};
 const dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(action.displaySize*dpr);canvas.height=Math.round(action.displaySize*dpr);canvas.style.width=canvas.style.height=`${action.displaySize}px`;
 const scrubTo=frame=>{row.playing=false;row.override=Math.max(0,Math.min(action.frames-1,frame));row.elapsed=(row.override-action.frameRange[0])/action.fps*1000;draw(row,true);buttons();};
 range.addEventListener('input',()=>scrubTo(Number(range.value)));prev.addEventListener('click',()=>scrubTo(Number(range.value)-1));next.addEventListener('click',()=>scrubTo(Number(range.value)+1));
 play.addEventListener('click',()=>{if(!row.playing)resume(row);else row.playing=false;buttons();});restart.addEventListener('click',()=>{row.elapsed=0;row.override=null;row.playing=true;draw(row,true);buttons();});
 return row;
});
function sample(row){
 if(row.override!==null)return {frame:row.override,state:'Inspecting'};
 const [first,last]=row.frameRange,count=last-first+1;
 if(row.introRange){
  const [introFirst,introLast]=row.introRange,introCount=introLast-introFirst+1;
  const step=Math.round(Math.max(0,row.elapsed)/1000*row.fps);
  return {frame:step<introCount?introFirst+step:first+(step-introCount)%count,state:row.playing?(step<introCount?'Intro':'Loop'):'Paused'};
 }
 const steps=row.playback==='ping-pong'?Math.max(1,count*2-2):count;
 const duration=steps/row.fps*1000;
 const repeats=row.playback==='loop'||row.repeatDelayMs!==null;
 const total=duration+(row.repeatDelayMs||0);
 const elapsed=repeats?((row.elapsed%total)+total)%total:Math.max(0,row.elapsed);
 if(elapsed>=duration){return {frame:row.playback==='once'?last:first,state:repeats?`Rest ${fmt((total-elapsed)/1000)}s`:'Complete'};}
 const phase=elapsed/1000*row.fps;
 const step=row.playback==='once'?Math.floor(phase):Math.round(phase);
 let local=step;
 if(row.playback==='ping-pong')local=step<count?step:steps-step;
 else if(row.playback==='loop')local=step%count;
 return {frame:first+Math.max(0,Math.min(count-1,local)),state:row.playing?'Playing':'Paused'};
}
function draw(row,force=false){
 if(!row.image.complete||!row.image.naturalWidth)return;
 const current=sample(row);row.stateLabel.textContent=current.state;
 if(!force&&current.frame===row.rendered)return;
 row.rendered=current.frame;const ctx=row.canvas.getContext('2d');ctx.clearRect(0,0,row.canvas.width,row.canvas.height);
 ctx.drawImage(row.image,current.frame%row.columns*row.cellWidth,Math.floor(current.frame/row.columns)*row.cellHeight,row.cellWidth,row.cellHeight,0,0,row.canvas.width,row.canvas.height);
 row.frameLabel.textContent=`Frame ${current.frame+1} / ${row.frames}`;row.range.value=current.frame;
}
function resume(row){
 if(row.override!==null){
  const [start,end]=row.frameRange,introCount=row.introRange?row.introRange[1]-row.introRange[0]+1:0;
  if(row.override>=start&&row.override<=end)row.elapsed=(introCount+row.override-start)/row.fps*1000;
  else if(row.introRange&&row.override>=row.introRange[0]&&row.override<=row.introRange[1])row.elapsed=(row.override-row.introRange[0])/row.fps*1000;
  else row.elapsed=0;
  row.override=null;
 }
 if(sample(row).state==='Complete')row.elapsed=0;row.playing=true;
}
function buttons(){for(const row of rows){row.play.textContent=row.playing?'Pause':'Play';row.play.setAttribute('aria-label',`${row.playing?'Pause':'Play'} ${row.label}`);}playAll.textContent=rows.some(r=>r.playing)?'Pause all':'Play all';}
playAll.addEventListener('click',()=>{const pause=rows.some(r=>r.playing);for(const row of rows){if(pause)row.playing=false;else resume(row);}buttons();});
restartAll.addEventListener('click',()=>{for(const row of rows){row.elapsed=0;row.override=null;row.playing=true;draw(row,true);}buttons();});
document.getElementById('speed').addEventListener('change',event=>{speed=Number(event.target.value);});
document.getElementById('background').addEventListener('change',event=>{for(const row of rows)row.stage.classList.toggle('dark',event.target.value==='dark');});
document.addEventListener('visibilitychange',()=>{lastTime=0;});
function tick(now){const delta=lastTime?now-lastTime:0;lastTime=now;if(ready&&!document.hidden){for(const row of rows){if(row.playing)row.elapsed+=delta*speed;draw(row);}}requestAnimationFrame(tick);}
Promise.all(rows.map(row=>new Promise((resolve,reject)=>{row.image.onload=resolve;row.image.onerror=()=>reject(new Error(`${row.label} artwork could not load.`));row.image.src=row.data;}))).then(()=>{
 ready=true;for(const row of rows){row.play.disabled=false;row.restart.disabled=false;row.playing=!reduced;draw(row,true);}playAll.disabled=restartAll.disabled=false;buttons();status.textContent=reduced?'Reduced motion: paused. Use Play to inspect.':'Ready · exact app playback timing';
}).catch(error=>{status.textContent=error.message;playAll.textContent='Unable to load';});
requestAnimationFrame(tick);
})();
</script></body></html>'''


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, default=ROOT / 'reports/figma-import/review-manifest.json')
    parser.add_argument('--output', type=Path, default=ROOT / 'reports/figma-import/review.html')
    args = parser.parse_args()
    data = build_data(args.manifest.resolve())
    encoded = json.dumps(data, separators=(',', ':'), ensure_ascii=False).replace('<', '\\u003c')
    document = DOCUMENT.replace('__TITLE__', html.escape(data['title'])).replace('__DATA__', encoded)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(document)
    print(f'{args.output}: {len(data["actions"])} actions, {len(document):,} characters, offline assets embedded')


if __name__ == '__main__':
    main()
