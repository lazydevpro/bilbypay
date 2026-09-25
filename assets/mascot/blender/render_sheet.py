"""Render a contact sheet (tiled frames) for review.

    blender -b bilby.blend -P render_sheet.py -- <out.png> <spec> [<spec> ...]

spec = view:pose   view in front|q34|side|back|qback|face|faceside ; pose = rest | <Action>@<frame>
"""
import bpy, sys, os, math
import numpy as np
from mathutils import Vector, Euler

HERE = os.path.dirname(os.path.abspath(bpy.data.filepath))
argv = sys.argv[sys.argv.index("--") + 1:]
out_path, specs = argv[0], argv[1:]
scene = bpy.context.scene
rig = bpy.data.objects["BilbyRig"]
for eng in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
    try:
        scene.render.engine = eng; break
    except TypeError:
        pass
TW, TH = 520, 640
scene.render.resolution_x, scene.render.resolution_y = TW, TH
scene.render.resolution_percentage = 100
scene.view_settings.view_transform = "Standard"
try:
    scene.eevee.taa_render_samples = 16
except AttributeError:
    pass
world = scene.world or bpy.data.worlds.new("W"); scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get("Background") or world.node_tree.nodes.new("ShaderNodeBackground")
bg.inputs["Color"].default_value = (0.99, 0.99, 0.99, 1)
ld = bpy.data.lights.new("Key", "SUN"); ld.energy = 3.0
lo = bpy.data.objects.new("Key", ld); scene.collection.objects.link(lo)
lo.rotation_euler = Euler((math.radians(50), math.radians(-25), math.radians(-30)))
cd = bpy.data.cameras.new("Cam"); cd.type = "ORTHO"
cam = bpy.data.objects.new("Cam", cd); scene.collection.objects.link(cam); scene.camera = cam
VIEWS = {"front": (0, 4, 1.75, 0.66), "q34": (-38, 8, 1.75, 0.66), "side": (-90, 3, 1.75, 0.66),
         "back": (180, 6, 1.75, 0.66), "qback": (140, 8, 1.75, 0.66),
         "face": (0, 3, 0.72, 0.68), "faceq": (-30, 6, 0.72, 0.68), "faceside": (-90, 3, 0.9, 0.68), "arms": (0, 3, 1.0, 0.4), "armsq": (-35, 8, 1.0, 0.4), "hand": (0, 25, 0.3, 0.385, 0.385), "handq": (-40, 20, 0.4, 0.3, 0.3), "handside": (-90, 10, 0.4, 0.3, 0.3),
         "tail": (-90, 4, 0.75, 0.2, 0.0, 0.42), "tailq": (-130, 20, 0.75, 0.2, -0.1, 0.42), "tailtop": (-90, 70, 0.75, 0.2, -0.1, 0.42)}

def set_pose(pose):
    for t in rig.animation_data.nla_tracks:
        t.mute = True
    rig.animation_data.action = None
    for b in rig.pose.bones:
        b.location = (0, 0, 0); b.rotation_euler = (0, 0, 0); b.scale = (1, 1, 1)
    if pose == "rest":
        scene.frame_set(1); return
    name, _, fr = pose.partition("@")
    act = bpy.data.actions[name]
    rig.animation_data.action = act
    if act.slots:
        rig.animation_data.action_slot = act.slots[0]
    scene.frame_set(int(float(fr)) if fr else 1)

tiles = []
for spec in specs:
    view, _, pose = spec.partition(":")
    set_pose(pose or "rest")
    vw = VIEWS[view]
    yaw, pitch, scale, tz = vw[:4]
    tx = vw[4] if len(vw) > 4 else 0.0
    cd.ortho_scale = scale
    y, p = math.radians(yaw), math.radians(pitch)
    d = Vector((math.sin(y) * math.cos(p), -math.cos(y) * math.cos(p), math.sin(p)))
    ty = vw[5] if len(vw) > 5 else (-0.08 if view == "faceside" else 0.0)
    tgt = Vector((tx, ty, tz))
    cam.location = tgt + d * 6
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = "/tmp/bilby_tile.png"
    bpy.ops.render.render(write_still=True)
    im = bpy.data.images.load("/tmp/bilby_tile.png", check_existing=False)
    tiles.append(np.array(im.pixels[:], dtype=np.float32).reshape(TH, TW, 4))
    bpy.data.images.remove(im)
cols = min(len(tiles), 6)
rows = (len(tiles) + cols - 1) // cols
sheet = np.ones((rows * TH, cols * TW, 4), np.float32)
for i, t in enumerate(tiles):
    r, c = divmod(i, cols)
    sheet[(rows - 1 - r) * TH:(rows - r) * TH, c * TW:(c + 1) * TW] = t
o = bpy.data.images.new("sheet", cols * TW, rows * TH, alpha=True)
o.pixels.foreach_set(sheet.ravel()); o.filepath_raw = out_path; o.file_format = "PNG"; o.save()
print("SHEET", out_path)
