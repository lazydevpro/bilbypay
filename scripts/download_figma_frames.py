#!/usr/bin/env python3
"""Download already-authorized Figma asset URLs from a temporary export manifest."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import subprocess
import xml.etree.ElementTree as ET


def download(item, destination):
    url = item["url"]
    if not url.startswith("https://www.figma.com/api/mcp/asset/"):
        raise ValueError("Unexpected asset host")
    name = item["key"]
    if not name.isalpha():
        raise ValueError("Invalid action name")
    target = destination / name / f"frame_{item['index']:03d}.svg"
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        raw = target.read_bytes()
    else:
        raw = subprocess.run(["curl", "--fail", "--location", "--silent", "--show-error", "--max-time", "60", url],
                             check=True, capture_output=True).stdout
        root = ET.fromstring(raw)
        if not root.tag.endswith("svg"):
            raise ValueError("Figma asset is not SVG")
        target.write_bytes(raw)
    root = ET.fromstring(raw)
    return {k: v for k, v in item.items() if k != "url"} | {
        "path": str(target), "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(),
        "svgWidth": root.get("width"), "svgHeight": root.get("height"), "viewBox": root.get("viewBox")}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--output", type=Path, default=Path("docs/design/figma-import/svg"))
    args = parser.parse_args()
    items = json.loads(args.manifest.read_text())
    with ThreadPoolExecutor(max_workers=6) as pool:
        saved = list(pool.map(lambda item: download(item, args.output), items))
    saved.sort(key=lambda item: (item["key"], item["index"]))
    (args.output.parent / "downloaded-frames.json").write_text(json.dumps(saved, indent=2) + "\n")
    print(json.dumps({"downloaded": len(saved), "bytes": sum(s["bytes"] for s in saved),
                      "actions": {key: sum(s["key"] == key for s in saved) for key in sorted({s["key"] for s in saved})}}))
