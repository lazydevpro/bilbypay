"""Bake Bilby's procedural colour regions to textures and export GLB files.

    blender -b bilby.blend -P export_glb.py

Writes ../3d/bilby.glb (full detail) and ../3d/bilby_lite.glb (decimated, mobile-friendly),
plus textures/*.png. Materials become standard PBR (base colour texture, rough, non-metal) so any
engine can load them; apply a toon/cel material at runtime for the flat 2D look.
"""
import bpy, os, math

HERE = os.path.dirname(os.path.abspath(bpy.data.filepath))
TEX = os.path.join(HERE, "textures")
OUT = os.path.join(HERE, "..", "3d")
os.makedirs(TEX, exist_ok=True)
os.makedirs(OUT, exist_ok=True)

scene = bpy.context.scene
rig = bpy.data.objects["BilbyRig"]

# rest pose while baking
rig.animation_data.action = None
for t in rig.animation_data.nla_tracks:
    t.mute = True
for b in rig.pose.bones:
    b.location = (0, 0, 0); b.rotation_euler = (0, 0, 0); b.scale = (1, 1, 1)
scene.frame_set(1)

if "GroundShadow" in bpy.data.objects:
    bpy.data.objects.remove(bpy.data.objects["GroundShadow"], do_unlink=True)

scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 16
scene.render.bake.margin = 6

def activate(ob):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)

def unwrap(ob, margin=0.004):
    activate(ob)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=margin)
    bpy.ops.object.mode_set(mode="OBJECT")

def pbr_from_image(name, img):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = img; tex.interpolation = "Linear"
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = 0.85
    bsdf.inputs["Metallic"].default_value = 0.0
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return m

def pbr_flat(name, color, metallic=0.0, rough=0.85):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metallic
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return m

def bake_albedo(ob, size, img_name):
    """Bake the procedural albedo (Toon=0 emission) of ob's material into an image."""
    src = ob.data.materials[0].copy()          # per-object copy so bakes don't collide
    ob.data.materials[0] = src
    nt = src.node_tree
    nt.nodes["Toon"].outputs[0].default_value = 0.0
    img = bpy.data.images.new(img_name, size, size, alpha=False)
    img.colorspace_settings.name = "sRGB"
    tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = img
    for n in nt.nodes:
        n.select = False
    tex.select = True
    nt.nodes.active = tex
    activate(ob)
    bpy.ops.object.bake(type="EMIT")
    img.filepath_raw = os.path.join(TEX, img_name + ".png")
    img.file_format = "PNG"
    img.save()
    ob.data.materials[0] = pbr_from_image(f"Bilby_{ob.name}", img)
    return img

# ---- bake textured parts
unwrap(bpy.data.objects["Body"], 0.002)
bake_albedo(bpy.data.objects["Body"], 4096, "bilby_body_albedo")
for e in ("Ear_L", "Ear_R", "Tail"):
    unwrap(bpy.data.objects[e])
    bake_albedo(bpy.data.objects[e], 1024, f"bilby_{e.lower()}_albedo")

# ---- flat-colour parts: convert toon materials to plain PBR with the palette colour
converted = {}
for ob in bpy.data.objects:
    if ob.type != "MESH" or ob.name in ("Body", "Ear_L", "Ear_R", "Tail"):
        continue
    m = ob.data.materials[0]
    if m.name in converted:
        ob.data.materials[0] = converted[m.name]
        continue
    if m.name == "M_Body":                          # tufts: plain fur colour
        col = tuple(((c / 255 + 0.055) / 1.055) ** 2.4 for c in (0x7D, 0xA9, 0xD4)) + (1.0,)
        new = pbr_flat("Bilby_Fur", col)
    else:
        rgb = next(n for n in m.node_tree.nodes if n.type == "RGB")
        col = tuple(rgb.outputs[0].default_value)
        key = m.name.replace("M_", "")
        metal = 0.0
        rough = 0.35 if key in ("eye", "pupil", "nose", "nose_hl") else 0.85
        new = pbr_flat(f"Bilby_{key}", col, metal, rough)
    converted[m.name] = new
    ob.data.materials[0] = new

# ---- export
for t in rig.animation_data.nla_tracks:
    t.mute = False

def export(path):
    kwargs = dict(
        filepath=path, export_format="GLB", use_selection=False,
        export_yup=True, export_apply=True, export_texcoords=True, export_normals=True,
        export_materials="EXPORT", export_image_format="AUTO",
        export_skins=True, export_animations=True, export_animation_mode="ACTIONS",
        export_force_sampling=True, export_frame_range=False,
    )
    try:
        bpy.ops.export_scene.gltf(**kwargs)
    except TypeError as e:
        print("export option fallback:", e)
        for k in ("export_frame_range", "export_force_sampling"):
            kwargs.pop(k, None)
        bpy.ops.export_scene.gltf(**kwargs)
    print("EXPORTED", path, os.path.getsize(path) // 1024, "KB")

export(os.path.join(OUT, "bilby.glb"))

# lite: decimate heavy meshes (weights are interpolated by the collapse)
for name, ratio in (("Body", 0.3), ("Ear_L", 0.35), ("Ear_R", 0.35), ("Tail", 0.5)):
    ob = bpy.data.objects[name]
    md = ob.modifiers.new("Decimate", "DECIMATE")
    md.ratio = ratio
    # decimate must run before the armature deform
    while ob.modifiers.find("Decimate") > 0:
        activate(ob)
        bpy.ops.object.modifier_move_up(modifier="Decimate")
export(os.path.join(OUT, "bilby_lite.glb"))

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "bilby_export.blend"), copy=True)
print("EXPORT DONE")
