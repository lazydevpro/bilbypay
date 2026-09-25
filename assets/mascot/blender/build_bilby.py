"""Build the Bilby mascot (v2, turnaround-sheet design) in Blender, headless.

    blender -b --factory-startup -P build_bilby.py

Rest pose is a T-pose. Produces bilby.blend: one smooth body (signed-distance shapes joined with a smooth
union and meshed through OpenVDB, so every part flows into the next), upright ears, cute face parts
(+ hidden expression parts that animations slide into view), tail, feet, a deforming rig and actions.
Blender coords: Z up, character faces -Y, character's left = +X (suffix _L).
"""
import bpy, bmesh, math, os
import numpy as np
import openvdb
from mathutils import Vector, Matrix, Euler, Quaternion
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_BLEND = os.path.join(HERE, "bilby.blend")

# ---------------------------------------------------------------- palette (turnaround sheet)
def _lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def hexcol(h):
    h = h.lstrip("#")
    return tuple(_lin(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)) + (1.0,)

PAL_HEX = dict(
    fur="7DA9D4", fur_dark="6892C0", cream="F4EDE4", pink="F2AB93", pink_light="F5BBA6",
    nose="EF967C", nose_hl="F8C2B2", navy="3E4A66", pupil="252D44", eye="FFFFFF",
    mouth_in="5A2D3A", tongue="EE8A8A", ground="ECEBEA",
)
PAL = {k: hexcol(v) for k, v in PAL_HEX.items()}

# ---------------------------------------------------------------- scene helpers
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
COLL = scene.collection
S = (1, -1)
SIDE = {1: "L", -1: "R"}

def link(ob):
    COLL.objects.link(ob)
    return ob

def activate(ob):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)

def apply_modifier(ob, mtype, **props):
    activate(ob)
    m = ob.modifiers.new("tmp", mtype)
    for k, v in props.items():
        setattr(m, k, v)
    bpy.ops.object.modifier_apply(modifier=m.name)

def shade_smooth(ob):
    for p in ob.data.polygons:
        p.use_smooth = True

def ellipsoid(bm, center, radii, rot=(0, 0, 0), seg=56, rings=28, frame=None):
    R = frame if frame is not None else Euler(rot).to_matrix()
    M = Matrix.Translation(center) @ R.to_4x4() @ Matrix.Diagonal((*radii, 1.0))
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=1.0, matrix=M)

def catmull(ctrl, vals, n=10):
    P = [Vector(p) for p in ctrl]
    P = [P[0] + (P[0] - P[1])] + P + [P[-1] + (P[-1] - P[-2])]
    V = [vals[0]] + list(vals) + [vals[-1]]
    pts, out = [], []
    for i in range(1, len(P) - 2):
        for k in range(n):
            t = k / n
            p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
            pts.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
            out.append(V[i] + (V[i + 1] - V[i]) * (t * t * (3 - 2 * t)))
    pts.append(P[-2]); out.append(V[-2])
    return pts, out

def tube(bm, pts, radii, seg=36, closed=False, up=None, radii_b=None, caps=True):
    """Swept tube; radii_b gives elliptical sections (second axis ~ up)."""
    pts = [Vector(p) for p in pts]
    n = len(pts)
    rings, prev = [], None
    for i, p in enumerate(pts):
        if closed:
            t = (pts[(i + 1) % n] - pts[i - 1]).normalized()
        elif i == 0:
            t = (pts[1] - pts[0]).normalized()
        elif i == n - 1:
            t = (pts[-1] - pts[-2]).normalized()
        else:
            t = (pts[i + 1] - pts[i - 1]).normalized()
        if up is not None:
            b = (Vector(up) - t * Vector(up).dot(t)).normalized()
            nrm = b.cross(t).normalized()
        else:
            if prev is None:
                a = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
                nrm = t.cross(a).normalized()
            else:
                nrm = (prev - t * prev.dot(t)).normalized()
            b = t.cross(nrm).normalized()
        prev = nrm
        ra = radii[i]
        rb = radii_b[i] if radii_b is not None else ra
        rings.append([bm.verts.new(p + nrm * (math.cos(2 * math.pi * k / seg) * ra) + b * (math.sin(2 * math.pi * k / seg) * rb))
                      for k in range(seg)])
    for i in range(n if closed else n - 1):
        r0, r1 = rings[i], rings[(i + 1) % n]
        for k in range(seg):
            bm.faces.new((r0[k], r0[(k + 1) % seg], r1[(k + 1) % seg], r1[k]))
    if caps and not closed:
        for ring, rev in ((rings[0], True), (rings[-1], False)):
            c = bm.verts.new(sum((v.co for v in ring), Vector()) / seg)
            for k in range(seg):
                f = (ring[k], ring[(k + 1) % seg], c)
                bm.faces.new(f[::-1] if rev else f)
    return rings

def mesh_from_bm(name, bm):
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    return link(bpy.data.objects.new(name, me))

def store_rest(ob):
    me = ob.data
    if "rest_co" in me.attributes:
        me.attributes.remove(me.attributes["rest_co"])
    a = me.attributes.new("rest_co", "FLOAT_VECTOR", "POINT")
    a.data.foreach_set("vector", [c for v in me.vertices for c in v.co])

# ---------------------------------------------------------------- SDF modelling (smooth blends, meshed via OpenVDB)
class SDF:
    """Signed distance field on a grid. Shapes join with a smooth union, so they flow into each other
    instead of meeting at creases."""
    def __init__(self, lo, hi, vs):
        self.vs, self.lo = vs, np.array(lo, float)
        n = np.ceil((np.array(hi, float) - self.lo) / vs).astype(int) + 1
        self.ax = [(self.lo[i] + np.arange(n[i]) * vs).astype(np.float32) for i in range(3)]
        self.F = np.full(tuple(n), 1.0, np.float32)

    def add(self, prims, k=0.0):
        """prims: [(fn, bmin, bmax)], hard-unioned together (a chain), then smooth-unioned into the field with radius k."""
        m = k + 4 * self.vs
        bmin = np.min([p[1] for p in prims], axis=0) - m
        bmax = np.max([p[2] for p in prims], axis=0) + m
        sl = tuple(slice(max(0, int((bmin[i] - self.lo[i]) / self.vs)),
                         min(len(self.ax[i]), int(math.ceil((bmax[i] - self.lo[i]) / self.vs)) + 1)) for i in range(3))
        P = np.stack(np.meshgrid(self.ax[0][sl[0]], self.ax[1][sl[1]], self.ax[2][sl[2]], indexing="ij"), -1)
        d = prims[0][0](P)
        for fn, _, _ in prims[1:]:
            d = np.minimum(d, fn(P))
        a = self.F[sl]
        if k <= 0:
            self.F[sl] = np.minimum(a, d)
        else:
            h = np.clip(0.5 + 0.5 * (d - a) / k, 0.0, 1.0)
            self.F[sl] = d * (1 - h) + a * h - k * h * (1 - h)

    def mesh(self, name):
        path = os.path.join(bpy.app.tempdir or "/tmp", f"bilby_{name}.vdb")
        g = openvdb.FloatGrid(-0.05)
        g.copyFromArray(np.clip(-self.F, -0.05, 0.05).astype(np.float32))
        g.transform = openvdb.createLinearTransform(voxelSize=self.vs)
        g.name = "density"
        openvdb.write(path, grids=[g])
        bpy.ops.object.volume_import(filepath=path)
        vol = bpy.context.active_object
        ob = link(bpy.data.objects.new(name, bpy.data.meshes.new(name)))
        apply_modifier(ob, "VOLUME_TO_MESH", object=vol, resolution_mode="GRID", threshold=0.0, adaptivity=0.0)
        bpy.data.objects.remove(vol, do_unlink=True)
        bpy.context.view_layer.update()
        ob.data.transform(Matrix.Translation(Vector(self.lo)))
        return ob

def ell(c, r, rot=(0, 0, 0)):
    """Ellipsoid (distance bound)."""
    c, r = np.array(c, np.float32), np.array(r, np.float32)
    Rm = np.array(Euler(rot).to_matrix(), np.float32)
    def fn(P):
        q = (P - c) @ Rm
        k0 = np.linalg.norm(q / r, axis=-1)
        k1 = np.linalg.norm(q / (r * r), axis=-1)
        return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)
    e = float(r.max())
    return fn, c - e, c + e

def rcone(a, b, r1, r2, sc=(1, 1, 1)):
    """Round cone: a capsule whose radius goes r1 -> r2 (exact distance; sc squashes the cross-section)."""
    sc = np.array(sc, np.float32)
    a, b = np.array(a, np.float32) / sc, np.array(b, np.float32) / sc
    ba = b - a
    l2 = float(ba @ ba); rr = r1 - r2; a2 = l2 - rr * rr; il2 = 1.0 / l2
    def fn(P):
        pa = P - a
        y = pa @ ba
        z = y - l2
        w = pa * l2 - y[..., None] * ba
        x2 = np.einsum("...i,...i", w, w)
        y2, z2 = y * y * l2, z * z * l2
        k = math.copysign(rr * rr, rr) * x2
        d_b = np.sqrt(x2 + z2) * il2 - r2
        d_a = np.sqrt(x2 + y2) * il2 - r1
        d_m = (np.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1
        return np.where(np.sign(z) * a2 * z2 > k, d_b, np.where(np.sign(y) * a2 * y2 < k, d_a, d_m))
    mn = float(sc.min())
    return (lambda P: fn(P / sc) * mn), np.minimum(a - r1, b - r2) * sc, np.maximum(a + r1, b + r2) * sc

def chain(pts, radii, sc=(1, 1, 1)):
    """Round cones joined end to end (a smooth limb / tuft / tail)."""
    out = []
    for i in range(len(pts) - 1):
        if (Vector(pts[i + 1]) - Vector(pts[i])).length > abs(radii[i] - radii[i + 1]) + 1e-4:
            out.append(rcone(pts[i], pts[i + 1], radii[i], radii[i + 1], sc))
    return out

def smin_np(ds, k):
    out = ds[0]
    for d in ds[1:]:
        h = np.clip(0.5 + 0.5 * (d - out) / k, 0.0, 1.0)
        out = d * (1 - h) + out * h - k * h * (1 - h)
    return out

def mesh_co(ob):
    co = np.zeros(len(ob.data.vertices) * 3, np.float32)
    ob.data.vertices.foreach_get("co", co)
    return co.reshape(-1, 3)

# ---------------------------------------------------------------- proportions (from the turnaround; head top ~ 0.95 m)
HEAD_C = Vector((0, 0.0, 0.70))
HEAD_R = (0.235, 0.215, 0.235)
SHOULDER_Z = 0.385
ARM = {s: [(0.11 * s, 0.0, SHOULDER_Z + 0.005), (0.235 * s, 0.0, SHOULDER_Z), (0.345 * s, 0.0, SHOULDER_Z - 0.003)] for s in S}
HAND = {s: (0.385 * s, 0.0, SHOULDER_Z - 0.004) for s in S}
HIP = {s: (0.095 * s, 0.01, 0.2) for s in S}
FOOT = {s: (0.105 * s, -0.035, 0.032) for s in S}
SNOUT = [(0, -0.07, 0.585), (0, -0.2, 0.556), (0, -0.305, 0.534)]
NOSE_POS = Vector((0, -0.33, 0.533))

# ---------------------------------------------------------------- BODY (one smooth surface: every shape blends into the next)
PAW = {s: (0.385 * s, -0.002, SHOULDER_Z - 0.006) for s in S}
sdf = SDF((-0.47, -0.42, -0.02), (0.47, 0.3, 1.0), 0.003)
# torso: one soft pear (big blend radii so there are no lumps down the back or the belly)
sdf.add([ell((0, 0.0, 0.17), (0.155, 0.152, 0.16))])
sdf.add([ell((0, -0.01, 0.3), (0.128, 0.126, 0.13))], 0.09)
sdf.add([ell((0, -0.05, 0.22), (0.12, 0.11, 0.14))], 0.08)          # soft belly
sdf.add([ell((0, 0.0, 0.41), (0.1, 0.097, 0.09))], 0.08)           # chest / neck
for s in S:
    sdf.add([ell(HIP[s], (0.085, 0.095, 0.105))], 0.06)            # haunches
    sdf.add([ell((0.1 * s, -0.01, 0.075), (0.06, 0.065, 0.07))], 0.045)   # short legs
    # arm: one tapering limb from inside the chest to the wrist
    sdf.add(chain([(0.07 * s, 0.0, SHOULDER_Z + 0.008), ARM[s][1], ARM[s][2], (0.36 * s, -0.001, SHOULDER_Z - 0.005)],
                  [0.05, 0.04, 0.034, 0.031]), 0.045)
    # cat paw: a soft rounded bean, a little wider than the wrist, flat underneath
    sdf.add([ell(PAW[s], (0.05, 0.047, 0.034))], 0.02)
sdf.add([ell(HEAD_C, HEAD_R)], 0.045)                            # round cranium, soft neck blend
for s in S:
    sdf.add([ell((0.11 * s, -0.07, 0.6), (0.125, 0.115, 0.105))], 0.045)   # soft cheeks
sdf.add([ell((0, -0.09, 0.535), (0.115, 0.105, 0.07))], 0.04)      # jaw / chin
# pointed bilby snout: starts below the eyes and tapers to the nose, blended wide into the face
sdf.add(chain([(0, -0.07, 0.565), (0, -0.2, 0.548), (0, -0.305, 0.535)], [0.095, 0.068, 0.044], sc=(0.78, 1, 1)), 0.055)
# hair tuft on top: three soft flame-shaped locks with rounded tips
for x0, lean, h, r0 in ((-0.04, -0.45, 0.06, 0.026), (0.0, -0.05, 0.08, 0.03), (0.04, 0.4, 0.065, 0.026)):
    b = HEAD_C + Vector((x0, -0.01, HEAD_R[2] - 0.03))
    tip = b + Vector((math.sin(lean) * h, -0.008, math.cos(lean) * h))
    mid = b.lerp(tip, 0.55) + Vector((math.sin(lean) * -0.008, 0, 0.004))
    sdf.add(chain([b - Vector((0, 0, 0.02)), b, mid, tip], [r0, r0 * 0.92, r0 * 0.62, 0.011]), 0.022)
# cheek fluff: two soft rounded lobes per side
for s in S:
    for dz, ln, r0 in ((0.02, 0.05, 0.026), (-0.03, 0.04, 0.022)):
        b = Vector((0.195 * s, -0.06, 0.6 + dz))
        tip = b + Vector((ln * s, -0.008, -0.018 - 0.1 * ln))
        sdf.add(chain([b - Vector((0.025 * s, 0, 0)), b, tip], [r0, r0 * 0.9, 0.012]), 0.02)

body = sdf.mesh("Body")
del sdf
apply_modifier(body, "SMOOTH", factor=0.5, iterations=3)
apply_modifier(body, "DECIMATE", ratio=min(1.0, 90000 / len(body.data.polygons)))
shade_smooth(body)
store_rest(body)

# cream patch: one clean shape from under the snout, down the throat, into the belly (smooth union of
# soft ovals, stored as a distance so the shader cuts a crisp edge anywhere across a triangle)
CREAM = [((0, -0.2, 0.235), (0.098, 0.2, 0.185)), ((0, -0.2, 0.4), (0.055, 0.2, 0.11)),
         ((0, -0.16, 0.49), (0.085, 0.18, 0.05)), ((0, -0.27, 0.518), (0.042, 0.1, 0.022))]
_co = mesh_co(body)
_d = smin_np([ell(c, r)[0](_co) for c, r in CREAM], 0.05)
_a = body.data.attributes.new("cream_d", "FLOAT", "POINT")
_a.data.foreach_set("value", _d.astype(np.float32))

dg = bpy.context.evaluated_depsgraph_get()
BVH = BVHTree.FromObject(body, dg)

def surf(x, z, y0=-1.0):
    loc, nrm, _, _ = BVH.ray_cast(Vector((x, y0, z)), Vector((0, 1, 0)))
    return loc, nrm

def frame_from_normal(n, roll=0.0):
    z = n.normalized()
    x = Vector((1, 0, 0))
    x = (x - z * x.dot(z)).normalized()
    y = z.cross(x)
    return Matrix((x, y, z)).transposed() @ Matrix.Rotation(roll, 3, "Z")

parts = {}  # name -> (object, bone, material key)

def part(name, bm, bone, mat):
    ob = mesh_from_bm(name, bm)
    shade_smooth(ob)
    store_rest(ob)
    parts[name] = (ob, bone, mat)
    return ob

# ---------------------------------------------------------------- EARS (tall upright leaves, pink inside)
EAR = dict(L=0.54, W=0.27, T=0.022, cup=0.045, nu=32, nv=72)
ear_bone_pts = {}

def build_ear(side):
    L, W, T, cup, nu, nv = EAR["L"], EAR["W"], EAR["T"], EAR["cup"], EAR["nu"], EAR["nv"]
    base = Vector((0.1 * side, 0.03, 0.855))
    a0, a1 = math.radians(14), math.radians(24)      # lean outward, a bit more toward the tip
    YAW = Matrix.Rotation(math.radians(30) * side, 3, "Z")   # turn the pink face outward so ears read from the side
    C, A = [base.copy()], []
    for j in range(nv + 1):
        v = j / nv
        a = a0 + (a1 - a0) * v
        A.append(a)
        if j:
            d = Vector((side * math.sin(a), 0.035, math.cos(a))).normalized()
            C.append(C[-1] + d * (L / nv))
    def width(v):
        f = (max(0.0, 1 - v) ** 0.55) * (0.5 + 1.5 * v) / 0.854
        return W * f + 0.001
    bm = bmesh.new()
    vals, grid = [], {}
    for si, sgn in ((0, -1), (1, 1)):              # 0 = front (pink), 1 = back
        for j in range(nv + 1):
            v = j / nv
            a = A[j]
            wdir = Vector((side * math.cos(a), 0.0, -math.sin(a)))
            for i in range(nu + 1):
                u = -1 + 2 * i / nu
                thick = T * (1 - 0.6 * u * u) * (1 - 0.6 * v)
                y = -cup * (u * u) * math.sin(math.pi * min(1.0, v * 1.1)) + sgn * thick / 2
                p = C[j] + wdir * (u * width(v) / 2) + Vector((0, y, 0))
                p = base + YAW @ (p - base)
                grid[(si, j, i)] = bm.verts.new(p)
                vals.append((grid[(si, j, i)], (u, v, 1.0 - si)))
    for j in range(nv):
        for i in range(nu):
            f = [grid[(0, j, i)], grid[(0, j, i + 1)], grid[(0, j + 1, i + 1)], grid[(0, j + 1, i)]]
            bm.faces.new(f if side > 0 else f[::-1])
            b = [grid[(1, j, i)], grid[(1, j + 1, i)], grid[(1, j + 1, i + 1)], grid[(1, j, i + 1)]]
            bm.faces.new(b if side > 0 else b[::-1])
    def rim(a0_, a1_, b0_, b1_):
        try:
            bm.faces.new((a0_, a1_, b1_, b0_))
        except ValueError:
            pass
    for j in range(nv):
        for i in (0, nu):
            rim(grid[(0, j, i)], grid[(0, j + 1, i)], grid[(1, j, i)], grid[(1, j + 1, i)])
    for i in range(nu):
        for j in (0, nv):
            rim(grid[(0, j, i)], grid[(0, j, i + 1)], grid[(1, j, i)], grid[(1, j, i + 1)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    idx = {v: k for k, v in enumerate(bm.verts)}
    out = [None] * len(bm.verts)
    for vert, val in vals:
        out[idx[vert]] = val
    ob = mesh_from_bm(f"Ear_{SIDE[side]}", bm)
    a = ob.data.attributes.new("ear_uv", "FLOAT_VECTOR", "POINT")
    a.data.foreach_set("vector", [c for val in out for c in val])
    apply_modifier(ob, "SUBSURF", levels=1)
    shade_smooth(ob)
    store_rest(ob)
    ear_bone_pts[side] = [base + YAW @ (C[k] - base) for k in (0, nv // 3, 2 * nv // 3, nv)]
    return ob

ears = [build_ear(s) for s in S]

# ---------------------------------------------------------------- FACE (big glossy eyes, small nose, tiny smile)
EYE_X, EYE_Z = 0.121, 0.61
SCLERA = (0.072, 0.086)
PUPIL = (0.061, 0.075)

def decal(bvh, start, R, radii, dome, lift, back=0.006, rings=14, seg=48):
    """A shallow dome that hugs a surface. Seen along its axis (R.col[2]) the outline is an exact ellipse,
    however the surface underneath curves, so eyes stay clean and symmetric next to the snout."""
    ex, ey, ez = R.col[0], R.col[1], R.col[2]
    d = -ez
    bm = bmesh.new()
    top, bot = [], []
    for i in range(rings + 1):
        r = i / rings
        rt, rb = [], []
        for j in range(seg if i else 1):
            th = 2 * math.pi * j / seg
            q = start + ex * (radii[0] * r * math.cos(th)) + ey * (radii[1] * r * math.sin(th))
            h = bvh.ray_cast(q, d)[0]
            if h is None:                       # off the edge of the surface: stay on the start plane
                h = q + d * (0.5 - 0.02)
            hgt = lift + dome * math.sqrt(max(0.0, 1 - r * r))
            rt.append(bm.verts.new(h + ez * hgt))
            rb.append(bm.verts.new(h - ez * back))
        top.append(rt); bot.append(rb)
    for layer, flip in ((top, False), (bot, True)):
        for j in range(seg):
            f = (layer[0][0], layer[1][j], layer[1][(j + 1) % seg])
            bm.faces.new(f[::-1] if flip else f)
        for i in range(1, rings):
            for j in range(seg):
                f = (layer[i][j], layer[i + 1][j], layer[i + 1][(j + 1) % seg], layer[i][(j + 1) % seg])
                bm.faces.new(f[::-1] if flip else f)
    for j in range(seg):
        bm.faces.new((top[-1][j], bot[-1][j], bot[-1][(j + 1) % seg], top[-1][(j + 1) % seg]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update()
    return bm, top[0][0].co.copy()

eye_frames, BROW_C = {}, {}
for s in S:
    sd = SIDE[s]
    R = frame_from_normal(Vector((0.2 * s, -1.0, 0.04)))      # cartoon eyes look forward, turned out a touch
    ex, ey, ez = R.col[0], R.col[1], R.col[2]
    start = Vector((EYE_X * s, 0.0, EYE_Z)) + ez * 0.5
    bm, top_c = decal(BVH, start, R, SCLERA, dome=0.012, lift=0.0015)
    c = BVH.ray_cast(start, -ez)[0]
    eye_frames[sd] = (c, R)
    sclera_bvh = BVHTree.FromBMesh(bm)
    part(f"EyeWhite_{sd}", bm, f"eye_{sd}", "eye")
    ps = start - ex * (0.007 * s) - ey * 0.004                   # pupil a touch inward -> white rim shows outside
    bm, _ = decal(sclera_bvh, ps, R, PUPIL, dome=0.004, lift=0.0008, back=0.004)
    pupil_bvh = BVHTree.FromBMesh(bm)
    part(f"Pupil_{sd}", bm, f"pupil_{sd}", "pupil")
    bm = bmesh.new()
    for off, rad in (((0.02 * s, 0.03), 0.017), ((-0.018 * s, -0.028), 0.007)):
        g_bm, _ = decal(pupil_bvh, ps + ex * off[0] + ey * off[1], R, (rad, rad), dome=0.0015, lift=0.0006,
                        back=0.002, rings=5, seg=24)
        me_ = bpy.data.meshes.new("tmp"); g_bm.to_mesh(me_); g_bm.free()
        bm.from_mesh(me_); bpy.data.meshes.remove(me_)
    part(f"EyeGlint_{sd}", bm, f"pupil_{sd}", "eye")
    # happy closed eyes (^ ^): hidden inside the head until an animation slides them out along the bone
    hp = []
    for k in range(17):
        t = k / 16
        x = (t - 0.5) * 0.11
        yv = 0.028 - 0.11 * (t - 0.5) ** 2 * 3.2
        hp.append(c + ex * x + ey * yv + ez * (0.012 - 0.075))   # buried deep enough that the arc ends never poke through the cheek
    bm = bmesh.new(); tube(bm, hp, [0.0075 + 0.004 * math.sin(math.pi * k / 16) for k in range(17)], seg=12)
    part(f"EyeHappy_{sd}", bm, f"eyehappy_{sd}", "navy")
    # brows: thin arcs
    bpts, brr = [], []
    for k in range(13):
        t = k / 12
        x = (0.075 + 0.07 * t) * s
        z = 0.745 + 0.016 * math.sin(math.pi * t) - 0.004 * t
        q, qn = surf(x, z)
        bpts.append(q + qn * 0.003); brr.append(0.004 + 0.003 * math.sin(math.pi * t))
    bm = bmesh.new(); tube(bm, bpts, brr, seg=12)
    part(f"Brow_{sd}", bm, f"brow_{sd}", "navy")
    BROW_C[sd] = sum(bpts, Vector()) / len(bpts)

# nose: small round peach ball at the snout tip, with a highlight
bm = bmesh.new(); ellipsoid(bm, NOSE_POS, (0.042, 0.036, 0.036))
part("Nose", bm, "nose", "nose")
bm = bmesh.new(); ellipsoid(bm, NOSE_POS + Vector((-0.013, -0.028, 0.018)), (0.012, 0.007, 0.008), seg=20, rings=10)
part("NoseHighlight", bm, "nose", "nose_hl")

# smile: tiny centred curve under the snout
spts, srr = [], []
for k in range(15):
    t = k / 14
    x = -0.03 + 0.06 * t
    z = 0.488 - 0.012 * math.sin(math.pi * t)
    q, qn = surf(x, z)
    spts.append(q + qn * 0.0025); srr.append(0.0028 + 0.0028 * math.sin(math.pi * t))
bm = bmesh.new(); tube(bm, spts, srr, seg=12)
part("Smile", bm, "mouth", "navy")
MOUTH_C = sum(spts, Vector()) / len(spts)
_, MOUTH_N = surf(0.0, 0.482)

# open mouth (hidden inside the head; the mouth_open bone slides it out)
mo_c = MOUTH_C - MOUTH_N * 0.048 + Vector((0, 0, -0.012))     # buried well inside so it never pokes through
Rm = frame_from_normal(MOUTH_N)
bm = bmesh.new(); ellipsoid(bm, mo_c, (0.038, 0.028, 0.012), frame=Rm)
part("MouthOpen", bm, "mouth_open", "mouth_in")
bm = bmesh.new(); ellipsoid(bm, mo_c + Rm.col[2] * 0.006 - Rm.col[1] * 0.009, (0.028, 0.014, 0.009), frame=Rm, seg=24, rings=12)
part("Tongue", bm, "mouth_open", "tongue")

# paw lines: two short strokes on each paw, like the claw lines in the 2D art
for s in S:
    bm = bmesh.new()
    hx, hy, hz = PAW[s]
    for y0 in (-0.015, 0.015):
        pts, rr = [], []
        for k in range(11):
            t = k / 10
            q = BVH.ray_cast(Vector((hx + (0.014 + 0.028 * t) * s, hy + y0, hz + 0.3)), Vector((0, 0, -1)))
            pts.append(q[0] + q[1] * 0.0018)
            rr.append(0.0008 + 0.0024 * math.sin(math.pi * (0.1 + 0.8 * t)))
        tube(bm, pts, rr, seg=10)
    part(f"PawLines_{SIDE[s]}", bm, f"hand_{SIDE[s]}", "fur_dark")

# ---------------------------------------------------------------- FEET (navy) + TAIL (blue stem, cream band, bushy navy tip)
for s in S:
    bm = bmesh.new(); ellipsoid(bm, FOOT[s], (0.062, 0.1, 0.034), (0, 0, 0.15 * s))
    part(f"Foot_{SIDE[s]}", bm, f"foot_{SIDE[s]}", "navy")

TAIL_CTRL = [(-0.01, 0.12, 0.13), (-0.04, 0.24, 0.1), (-0.09, 0.36, 0.09), (-0.14, 0.47, 0.11), (-0.18, 0.57, 0.16), (-0.2, 0.65, 0.22)]
tp, _ = catmull(TAIL_CTRL, [0.0] * len(TAIL_CTRL), 14)
tlen = [0.0]
for a_, b_ in zip(tp[:-1], tp[1:]):
    tlen.append(tlen[-1] + (b_ - a_).length)
TT = [x / tlen[-1] for x in tlen]

def tail_r(t):
    """Stem tapers from a thick root, then the navy tip swells into a soft bushy plume."""
    return 0.028 + 0.018 * max(0.0, 1 - t / 0.35) ** 2 + 0.046 * math.exp(-((t - 0.7) / 0.22) ** 2)

sdf = SDF(np.min(tp, axis=0) - 0.16, np.max(tp, axis=0) + 0.16, 0.0025)
sdf.add(chain(tp, [tail_r(t) for t in TT]))
# the plume ends in three soft rounded tufts, fanned in the vertical plane so they read from the side
k9 = min(range(len(tp)), key=lambda i: abs(TT[i] - 0.84))
T_ = (tp[-1] - tp[k9]).normalized()
N_ = (Vector((0, 0, 1)) - T_ * T_.z).normalized()
B_ = T_.cross(N_)
for ang, ln, sd_ in ((0.5, 0.115, 0.01), (0.05, 0.14, -0.008), (-0.42, 0.105, 0.006)):
    dv = (T_ * math.cos(ang) + N_ * math.sin(ang) + B_ * sd_ * 4).normalized()
    b0 = tp[k9]
    mid = b0 + dv * (ln * 0.5) + N_ * 0.008          # each lock curls up a little, like a brush flick
    tipp = b0 + dv * ln + T_ * 0.015 + N_ * 0.012
    sdf.add(chain([b0, mid, tipp], [0.046, 0.032, 0.013]), 0.03)
tail = sdf.mesh("Tail")
del sdf
apply_modifier(tail, "SMOOTH", factor=0.5, iterations=2)
apply_modifier(tail, "DECIMATE", ratio=min(1.0, 16000 / len(tail.data.polygons)))
# tail_t: arc-length position along the centreline (continuous, so colour bands are clean rings)
kd = KDTree(len(tp))
for i, p_ in enumerate(tp):
    kd.insert(p_, i)
kd.balance()
tv = []
for v in tail.data.vertices:
    _, k, _ = kd.find(v.co)
    best = (1e9, TT[k])
    for i0 in (k - 1, k):
        if 0 <= i0 < len(tp) - 1:
            a_, b_ = tp[i0], tp[i0 + 1]
            seg_ = b_ - a_
            u = max(0.0, min(1.0, (v.co - a_).dot(seg_) / seg_.length_squared))
            dist = (a_ + seg_ * u - v.co).length
            if dist < best[0]:
                best = (dist, TT[i0] + (TT[i0 + 1] - TT[i0]) * u)
    tv.append(best[1])
a = tail.data.attributes.new("tail_t", "FLOAT", "POINT")
a.data.foreach_set("value", tv)
shade_smooth(tail)
store_rest(tail)

# ---------------------------------------------------------------- MATERIALS (crisp procedural regions + toon switch)
class G:
    def __init__(self, mat):
        self.nt = mat.node_tree
        self.nt.nodes.clear()
    def n(self, typ, **props):
        node = self.nt.nodes.new(typ)
        for k, v in props.items():
            setattr(node, k, v)
        return node
    def l(self, a, b):
        self.nt.links.new(a, b)
    def attr(self, name, kind="Vector"):
        return self.n("ShaderNodeAttribute", attribute_name=name).outputs[kind]
    def vmath(self, op, a, b=None):
        nd = self.n("ShaderNodeVectorMath", operation=op)
        for i, s_ in enumerate((a, b)):
            if s_ is None:
                continue
            if isinstance(s_, (tuple, list, Vector)):
                nd.inputs[i].default_value = s_
            else:
                self.l(s_, nd.inputs[i])
        return nd.outputs["Value"] if op in ("LENGTH", "DOT_PRODUCT", "DISTANCE") else nd.outputs["Vector"]
    def math(self, op, a, b=None):
        nd = self.n("ShaderNodeMath", operation=op)
        for i, s_ in enumerate((a, b)):
            if s_ is None:
                continue
            if isinstance(s_, (int, float)):
                nd.inputs[i].default_value = s_
            else:
                self.l(s_, nd.inputs[i])
        return nd.outputs[0]
    def sep(self, v):
        nd = self.n("ShaderNodeSeparateXYZ"); self.l(v, nd.inputs[0]); return nd.outputs
    def mix(self, fac, a, b):
        nd = self.n("ShaderNodeMix", data_type="RGBA", clamp_factor=True)
        ins = [s_ for s_ in nd.inputs if s_.enabled]
        rg = [s_ for s_ in ins if s_.type == "RGBA"]
        for sock, val in ((ins[0], fac), (rg[0], a), (rg[1], b)):
            if isinstance(val, (int, float, tuple)):
                sock.default_value = val
            else:
                self.l(val, sock)
        return [s_ for s_ in nd.outputs if s_.enabled and s_.type == "RGBA"][0]
    def ellip(self, p, center, radii, rot=(0, 0, 0)):
        d = self.vmath("SUBTRACT", p, tuple(center))
        if any(rot):
            nd = self.n("ShaderNodeVectorRotate", rotation_type="EULER_XYZ", invert=True)
            self.l(d, nd.inputs["Vector"]); nd.inputs["Rotation"].default_value = rot
            d = nd.outputs["Vector"]
        return self.math("LESS_THAN", self.vmath("LENGTH", self.vmath("DIVIDE", d, tuple(radii))), 1.0)
    def union(self, *m):
        out = m[0]
        for x in m[1:]:
            out = self.math("MAXIMUM", out, x)
        return out
    def finish(self, color):
        diff = self.n("ShaderNodeBsdfDiffuse")
        s2r = self.n("ShaderNodeShaderToRGB"); self.l(diff.outputs[0], s2r.inputs[0])
        bw = self.n("ShaderNodeRGBToBW"); self.l(s2r.outputs["Color"], bw.inputs[0])
        ramp = self.n("ShaderNodeValToRGB")
        cr = ramp.color_ramp; cr.interpolation = "CONSTANT"
        cr.elements[0].position = 0.0; cr.elements[0].color = (0.9, 0.9, 0.92, 1)
        cr.elements[1].position = 0.12; cr.elements[1].color = (1, 1, 1, 1)
        self.l(bw.outputs[0], ramp.inputs[0])
        sh = self.n("ShaderNodeMix", data_type="RGBA", blend_type="MULTIPLY", clamp_factor=True)
        ins = [s_ for s_ in sh.inputs if s_.enabled]; ins[0].default_value = 1.0
        rg = [s_ for s_ in ins if s_.type == "RGBA"]
        self.l(color, rg[0]); self.l(ramp.outputs["Color"], rg[1])
        sh_out = [s_ for s_ in sh.outputs if s_.enabled and s_.type == "RGBA"][0]
        toon = self.n("ShaderNodeValue", name="Toon", label="Toon"); toon.outputs[0].default_value = 1.0
        final = self.mix(toon.outputs[0], color, sh_out)
        emit = self.n("ShaderNodeEmission"); self.l(final, emit.inputs["Color"])
        out = self.n("ShaderNodeOutputMaterial"); self.l(emit.outputs[0], out.inputs["Surface"])

def new_mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    return m

def flat_mat(key):
    m = new_mat(f"M_{key}")
    g = G(m)
    rgb = g.n("ShaderNodeRGB"); rgb.outputs[0].default_value = PAL[key]
    g.finish(rgb.outputs[0])
    return m

def body_mat():
    m = new_mat("M_Body")
    g = G(m)
    fur = g.n("ShaderNodeRGB"); fur.outputs[0].default_value = PAL["fur"]
    # cream: one clean patch (distance stored per vertex by the build; < 0 is inside)
    cream = g.math("LESS_THAN", g.attr("cream_d", "Fac"), 0.0)
    col = g.mix(cream, fur.outputs[0], PAL["cream"])
    g.finish(col)
    return m

def ear_mat():
    m = new_mat("M_Ear")
    g = G(m)
    uv = g.sep(g.attr("ear_uv"))
    u, v, front = uv[0], uv[1], uv[2]
    a = g.math("POWER", g.math("DIVIDE", u, 0.8), 2.0)
    b = g.math("POWER", g.math("ABSOLUTE", g.math("DIVIDE", g.math("SUBTRACT", v, 0.47), 0.47)), 3.0)
    inner = g.math("LESS_THAN", g.math("ADD", a, b), 1.0)
    pink_mask = g.math("MULTIPLY", inner, g.math("GREATER_THAN", front, 0.5))
    pink = g.mix(g.math("POWER", v, 1.3), PAL["pink"], PAL["pink_light"])
    g.finish(g.mix(pink_mask, PAL["fur"], pink))
    return m

def tail_mat():
    m = new_mat("M_Tail")
    g = G(m)
    t = g.attr("tail_t", "Fac")
    cream = g.math("MULTIPLY", g.math("GREATER_THAN", t, 0.3), g.math("LESS_THAN", t, 0.42))
    navy = g.math("GREATER_THAN", t, 0.42)
    col = g.mix(cream, PAL["fur"], PAL["cream"])
    g.finish(g.mix(navy, col, PAL["navy"]))
    return m

MATS = {k: flat_mat(k) for k in ("eye", "pupil", "navy", "fur_dark", "nose", "nose_hl", "mouth_in", "tongue", "ground")}
BODY_MAT = body_mat()
body.data.materials.append(BODY_MAT)
EAR_MAT = ear_mat()
for e in ears:
    e.data.materials.append(EAR_MAT)
tail.data.materials.append(tail_mat())
for name, (ob, bname, mk) in parts.items():
    ob.data.materials.append(BODY_MAT if mk == "body" else MATS[mk])

# ---------------------------------------------------------------- ARMATURE (T-pose rest)
arm_data = bpy.data.armatures.new("BilbyRig")
rig = link(bpy.data.objects.new("BilbyRig", arm_data))
activate(rig)
bpy.ops.object.mode_set(mode="EDIT")
EB = arm_data.edit_bones

def bone(name, head, tail_, parent=None, deform=True, roll=0.0):
    b = EB.new(name)
    b.head, b.tail = Vector(head), Vector(tail_)
    b.roll = roll
    b.use_deform = deform
    if parent:
        b.parent = EB[parent]
    return b

bone("root", (0, 0, 0), (0, 0.15, 0), deform=False)
bone("hips", (0, 0.0, 0.12), (0, 0.0, 0.27), "root")
bone("spine", (0, 0.0, 0.27), (0, 0.0, 0.38), "hips")
bone("chest", (0, 0.0, 0.38), (0, 0.0, 0.46), "spine")
bone("head", (0, 0.0, 0.46), (0, 0.0, 0.93), "chest")
for s in S:
    sd = SIDE[s]
    a_ = ARM[s]
    bone(f"upper_arm_{sd}", a_[0], a_[1], "chest")
    bone(f"forearm_{sd}", a_[1], a_[2], f"upper_arm_{sd}")
    bone(f"hand_{sd}", a_[2], (HAND[s][0] + 0.045 * s, 0.0, HAND[s][2]), f"forearm_{sd}")
    hx_, hy_, hz_ = HIP[s]
    bone(f"thigh_{sd}", (hx_, hy_, hz_ + 0.05), (0.102 * s, -0.01, 0.07), "hips")
    bone(f"foot_{sd}", (0.102 * s, -0.01, 0.07), (FOOT[s][0], FOOT[s][1] - 0.1, 0.03), f"thigh_{sd}")
    ep = ear_bone_pts[s]
    bone(f"ear_{sd}.1", ep[0], ep[1], "head")
    bone(f"ear_{sd}.2", ep[1], ep[2], f"ear_{sd}.1")
    bone(f"ear_{sd}.3", ep[2], ep[3], f"ear_{sd}.2")
    c, R = eye_frames[sd]
    fwd = R.col[2]
    bone(f"eye_{sd}", c, c + R.col[1] * 0.04, "head")          # points up: scale Y = blink about the eye centre
    bone(f"pupil_{sd}", c - fwd * 0.06, c + fwd * 0.03, f"eye_{sd}")
    bone(f"eyehappy_{sd}", c - fwd * 0.03, c + fwd * 0.03, "head")
    bc = BROW_C[sd]
    bone(f"brow_{sd}", bc + Vector((0, 0.03, 0)), bc + Vector((0, -0.03, 0)), "head")
bone("nose", NOSE_POS + Vector((0, 0.05, 0)), NOSE_POS + Vector((0, -0.02, 0)), "head")
bone("mouth", MOUTH_C - MOUTH_N * 0.04, MOUTH_C + MOUTH_N * 0.02, "head")
bone("mouth_open", MOUTH_C - MOUTH_N * 0.04, MOUTH_C + MOUTH_N * 0.02, "head")
tidx = [0, len(tp) // 5, 2 * len(tp) // 5, 3 * len(tp) // 5, 4 * len(tp) // 5, len(tp) - 1]
prev = "hips"
for i in range(5):
    bone(f"tail.{i + 1}", tp[tidx[i]], tp[tidx[i + 1]], prev)
    prev = f"tail.{i + 1}"
bpy.ops.object.mode_set(mode="OBJECT")

# body: automatic weights from the body bones only
NON_BODY = ("ear_", "eye", "pupil", "brow", "nose", "mouth", "tail.")
for b in arm_data.bones:
    b.use_deform = not b.name.startswith(NON_BODY) and b.name != "root"
activate(body); rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type="ARMATURE_AUTO")
for b in arm_data.bones:
    b.use_deform = b.name != "root"

def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)

def fix_body_weights(ob):
    """Keep the automatic weights for arms and legs (limited to the limbs), and give the trunk smooth
    height bands hips -> spine -> chest -> head, so a head tilt bends only the neck, not the whole chest."""
    co = mesh_co(ob)
    names = ["hips", "spine", "chest", "head"] + [f"{b}_{SIDE[s]}" for s in S for b in ("upper_arm", "forearm", "hand", "thigh", "foot")]
    for n in names:
        if n not in ob.vertex_groups:
            ob.vertex_groups.new(name=n)
    gi = {vg.index: vg.name for vg in ob.vertex_groups}
    col = {n: i for i, n in enumerate(names)}
    W = np.zeros((len(co), len(names)), np.float32)
    for v in ob.data.vertices:
        for g in v.groups:
            if gi[g.group] in col:
                W[v.index, col[gi[g.group]]] = g.weight
    ax, z = np.abs(co[:, 0]), co[:, 2]
    arm = [col[n] for n in names if n.startswith(("upper_arm", "forearm", "hand"))]
    leg = [col[n] for n in names if n.startswith(("thigh", "foot"))]
    W[:, arm] *= (smoothstep(0.085, 0.145, ax) * (1 - smoothstep(0.46, 0.5, z)))[:, None]
    W[:, leg] *= (1 - smoothstep(0.24, 0.32, z))[:, None]
    limb = W[:, arm + leg].sum(1)
    W[:, arm + leg] /= np.maximum(limb, 1.0)[:, None]
    rest = np.clip(1 - W[:, arm + leg].sum(1), 0, 1)
    s1, s2, s3 = smoothstep(0.2, 0.32, z), smoothstep(0.33, 0.43, z), smoothstep(0.455, 0.54, z)
    for n, w in (("hips", 1 - s1), ("spine", s1 * (1 - s2)), ("chest", s1 * s2 * (1 - s3)), ("head", s1 * s2 * s3)):
        W[:, col[n]] = rest * w
    for n in names:
        ob.vertex_groups.remove(ob.vertex_groups[n])
    for n in names:
        vg = ob.vertex_groups.new(name=n)
        w = W[:, col[n]]
        for i in np.nonzero(w > 1e-3)[0]:
            vg.add([int(i)], float(w[i]), "REPLACE")

fix_body_weights(body)

def rigid_skin(ob, bone_name):
    vg = ob.vertex_groups.new(name=bone_name)
    vg.add(list(range(len(ob.data.vertices))), 1.0, "REPLACE")
    ob.parent = rig
    md = ob.modifiers.new("Armature", "ARMATURE"); md.object = rig

for name, (ob, bname, _) in parts.items():
    rigid_skin(ob, bname)

def chain_skin(ob, values, bone_names):
    """Blend weights along a bone chain from a 0..1 parameter per vertex."""
    groups = [ob.vertex_groups.new(name=b) for b in bone_names]
    n = len(bone_names)
    for vi, t in enumerate(values):
        x = t * n
        w = [max(0.0, 1 - abs(x - (i + 0.5))) for i in range(n)]
        if x < 0.5:
            w = [1.0] + [0.0] * (n - 1)
        if x > n - 0.5:
            w = [0.0] * (n - 1) + [1.0]
        tot = sum(w) or 1.0
        for g_, wi in zip(groups, w):
            if wi > 0:
                g_.add([vi], wi / tot, "REPLACE")
    ob.parent = rig
    md = ob.modifiers.new("Armature", "ARMATURE"); md.object = rig

for s, ob in zip(S, ears):
    vals = [0.0] * (len(ob.data.vertices) * 3)
    ob.data.attributes["ear_uv"].data.foreach_get("vector", vals)
    chain_skin(ob, vals[1::3], [f"ear_{SIDE[s]}.{i}" for i in (1, 2, 3)])
tvals = [0.0] * len(tail.data.vertices)
tail.data.attributes["tail_t"].data.foreach_get("value", tvals)
chain_skin(tail, tvals, [f"tail.{i}" for i in range(1, 6)])

# ---------------------------------------------------------------- ANIMATION
FPS = 24
scene.render.fps = FPS
rig.animation_data_create()
PB = rig.pose.bones
for b in PB:
    b.rotation_mode = "XYZ"
REST_Q = {b.name: b.matrix_local.to_quaternion() for b in arm_data.bones}

def wrot(bname, *axis_angles):
    """Rotation in armature (world) axes -> Euler in the bone's local rest frame. Applied in order."""
    q = Quaternion()
    for axis, ang in axis_angles:
        q = Quaternion(axis, ang) @ q
    R = REST_Q[bname]
    return tuple((R.inverted() @ q @ R).to_euler("XYZ"))

def wloc(bname, v):
    """Translation in world axes -> bone-local location."""
    return tuple(REST_Q[bname].inverted() @ Vector(v))

X, Y, Z = (1, 0, 0), (0, 1, 0), (0, 0, 1)

def IDLE_ARMS(extra=None):
    """Relaxed idle: arms down by the sides, a little forward, elbows soft."""
    extra = extra or {}
    out = {}
    for s in S:
        sd = SIDE[s]
        out[f"upper_arm_{sd}"] = [(Y, 1.02 * s), (Z, -0.22 * s)] + extra.get(f"upper_arm_{sd}", [])
        out[f"forearm_{sd}"] = [(Z, -0.55 * s), (Y, 0.12 * s)] + extra.get(f"forearm_{sd}", [])
        out[f"hand_{sd}"] = [(Z, -0.35 * s), (Y, 0.38 * s)] + extra.get(f"hand_{sd}", [])   # relaxed wrist droop
    return out

def pose_keys(frame, rots=None, locs=None, scales=None):
    return (frame, rots or {}, locs or {}, scales or {})

def iter_fcurves(act):
    try:
        return list(act.fcurves)
    except Exception:
        pass
    out = []
    for layer in getattr(act, "layers", []):
        for strip in layer.strips:
            for cb in strip.channelbags:
                out += list(cb.fcurves)
    return out

def make_action(name, frames, keys, cyclic=False):
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    rig.animation_data.action = act
    for f, rots, locs, scales in keys:
        for b in PB:
            b.rotation_euler = wrot(b.name, *rots[b.name]) if b.name in rots else (0, 0, 0)
            b.location = wloc(b.name, locs[b.name]) if b.name in locs else (0, 0, 0)
            sc = scales.get(b.name, 1.0)
            b.scale = (sc, sc, sc) if isinstance(sc, (int, float)) else sc
            b.keyframe_insert("rotation_euler", frame=f)
            b.keyframe_insert("location", frame=f)
            b.keyframe_insert("scale", frame=f)
    act.frame_range = (1, frames)
    if cyclic:
        for fc in iter_fcurves(act):
            fc.modifiers.new("CYCLES")
    tr = rig.animation_data.nla_tracks.new(); tr.name = name
    tr.strips.new(name, 1, act); tr.mute = True
    rig.animation_data.action = None
    for b in PB:
        b.location = (0, 0, 0); b.rotation_euler = (0, 0, 0); b.scale = (1, 1, 1)
    return act

def merge(*dicts):
    out = {}
    for d in dicts:
        for k, v in d.items():
            out[k] = out.get(k, []) + list(v)
    return out

# ---- Idle (loop, 2 s): breathing, soft sway, ear twitch, tail sway
IDLE = []
for f in (1, 13, 25, 37, 49):
    ph = (f - 1) / 48 * 2 * math.pi
    rots = merge(IDLE_ARMS({f"upper_arm_{SIDE[s]}": [(Y, -0.04 * s * math.sin(ph))] for s in S}),
                 {"head": [(Y, 0.035 * math.sin(ph)), (X, 0.02 * math.cos(ph))],
                  "ear_L.2": [(Y, -0.05 * math.sin(ph + 0.8))], "ear_R.2": [(Y, 0.05 * math.sin(ph + 0.8))],
                  "tail.2": [(Z, 0.12 * math.sin(ph))], "tail.4": [(Z, 0.2 * math.sin(ph - 0.7))]})
    IDLE.append(pose_keys(f, rots, {"spine": (0, 0, 0.004 * math.sin(ph))}, {"chest": 1 + 0.012 * math.sin(ph)}))
make_action("Idle", 49, IDLE, cyclic=True)

# ---- Hello (4.5 s): idle -> notices you -> gets happy -> waves -> says "Hello!" (^^) -> settles
def hello_pose(f, notice=0.0, happy=0.0, wave=None, closed=0.0):
    arm_extra = {}
    base = IDLE_ARMS()
    if wave is not None:
        up, swing = wave
        # left arm: shoulder raised ~30 deg up-and-forward, forearm upright, waving from the elbow
        base["upper_arm_L"] = [(Y, 1.02 * (1 - up) - 0.25 * up), (Z, -0.22 * (1 - up) - 0.2 * up)]
        base["forearm_L"] = [(Z, -0.55 * (1 - up) - 0.25 * up), (Y, 0.12 * (1 - up) - 0.55 * up + swing)]
        base["hand_L"] = [(Z, -0.3 * (1 - up)), (Y, 0.1 * (1 - up) + 0.5 * swing), (X, -0.9 * up)]   # palm to camera
    rots = merge(base, {
        "head": [(Y, 0.16 * notice - 0.1 * closed), (Z, 0.12 * notice), (X, -0.06 * happy)],
        "ear_L.1": [(Y, 0.12 * notice), (X, -0.1 * happy)], "ear_R.1": [(Y, -0.12 * notice), (X, -0.1 * happy)],
        "ear_L.3": [(Y, -0.08 * happy)], "ear_R.3": [(Y, 0.08 * happy)],
        "tail.2": [(Z, 0.3 * happy * math.sin(f * 0.8))], "tail.4": [(Z, 0.4 * happy * math.sin(f * 0.8 - 1))],
        "chest": [(X, -0.05 * happy)],
    })
    locs = {
        "brow_L": (0, 0, 0.012 * notice + 0.006 * happy), "brow_R": (0, 0, 0.012 * notice + 0.006 * happy),
        "mouth_open": tuple(MOUTH_N * (0.049 * happy)),
        "mouth": tuple(-MOUTH_N * (0.02 * happy)),
        "eye_L": tuple(-eye_frames["L"][1].col[2] * (0.055 * closed)),
        "eye_R": tuple(-eye_frames["R"][1].col[2] * (0.055 * closed)),
        "eyehappy_L": tuple(eye_frames["L"][1].col[2] * (0.077 * closed)),
        "eyehappy_R": tuple(eye_frames["R"][1].col[2] * (0.077 * closed)),
        "hips": (0, 0, 0.018 * happy * max(0.0, math.sin(f * 0.5))),
    }
    return pose_keys(f, rots, locs, {"eye_L": 1 + 0.1 * notice, "eye_R": 1 + 0.1 * notice})

HELLO = [hello_pose(1), hello_pose(12),                                   # 1 idle
         hello_pose(18, notice=1.0), hello_pose(26, notice=1.0),          # 2 notices you
         hello_pose(32, notice=0.8, happy=1.0), hello_pose(38, notice=0.6, happy=1.0)]  # 3 gets happy
wf = 44
HELLO.append(hello_pose(wf, 0.5, 1.0, wave=(1.0, 0.0)))                  # 4 waves
for i in range(7):
    f = wf + 5 + i * 5
    closed = 1.0 if 58 <= f <= 76 else 0.0                                 # 5 says "Hello!" (^^)
    HELLO.append(hello_pose(f, 0.4, 1.0, wave=(1.0, 0.0 if i % 2 == 0 else 0.4), closed=closed))
HELLO += [hello_pose(86, 0.2, 0.7, wave=(0.6, 0.0)), hello_pose(94, 0.0, 0.3), hello_pose(108)]  # 6 settle
make_action("Hello", 108, HELLO)

# ---- Run (very fast loop: 8 frames = 1/3 s): big strides, arm pumping, ears + tail streaming back
RUN = []
for k in range(9):
    f = 1 + k
    ph = k / 8 * 2 * math.pi
    legL = math.sin(ph)
    bounce = abs(math.cos(ph))                       # high at mid-stride, low at the passing positions
    rots = {
        "root": [(X, 0.42)],                         # lean hard into the sprint
        "head": [(X, -0.28 + 0.05 * math.cos(2 * ph)), (Z, 0.06 * legL)],
        "hips": [(Z, 0.14 * legL)],
        "chest": [(Z, -0.2 * legL), (X, 0.04 * math.cos(2 * ph))],
        "thigh_L": [(X, -1.25 * legL)], "thigh_R": [(X, 1.25 * legL)],
        "foot_L": [(X, 0.9 * max(0.0, math.sin(ph + 1.0)) - 0.25)],
        "foot_R": [(X, 0.9 * max(0.0, math.sin(ph + 1.0 + math.pi)) - 0.25)],
        "ear_L.1": [(X, 0.7), (Y, 0.1)], "ear_R.1": [(X, 0.7), (Y, -0.1)],
        "ear_L.2": [(X, 0.3 + 0.18 * math.sin(2 * ph - 1.0))], "ear_R.2": [(X, 0.3 + 0.18 * math.sin(2 * ph - 1.3))],
        "ear_L.3": [(X, 0.25 + 0.25 * math.sin(2 * ph - 2.0))], "ear_R.3": [(X, 0.25 + 0.25 * math.sin(2 * ph - 2.3))],
        "tail.1": [(X, -0.45)], "tail.2": [(Z, 0.28 * math.sin(2 * ph - 0.8)), (X, -0.2)],
        "tail.3": [(Z, 0.34 * math.sin(2 * ph - 1.6))], "tail.4": [(Z, 0.4 * math.sin(2 * ph - 2.4))],
        "tail.5": [(Z, 0.4 * math.sin(2 * ph - 3.2))],
    }
    for s_ in S:
        sd = SIDE[s_]
        swing = -legL * s_                              # opposite arm to leg
        rots[f"upper_arm_{sd}"] = [(Y, 1.05 * s_), (X, 1.0 * swing)]
        rots[f"forearm_{sd}"] = [(Z, -1.45 * s_)]      # elbows bent forward
        rots[f"hand_{sd}"] = [(Z, -0.3 * s_)]
    k_ = 1.0 + 0.06 * (bounce - 0.5)
    RUN.append(pose_keys(f, rots, {"hips": (0, 0, 0.07 * bounce - 0.02)}, {"chest": (1 / math.sqrt(k_), 1 / math.sqrt(k_), k_)}))
make_action("Run", 9, RUN, cyclic=True)

# ---- Hop, TailWag, Blink (from the idle arms)
HOP = []
for f, z, sq, arm in ((1, 0, 1.0, 0.0), (5, -0.02, 0.9, -0.2), (11, 0.28, 1.06, 0.6), (17, 0.0, 1.0, 0.1), (19, 0.0, 0.9, 0.0), (22, 0, 1.0, 0.0)):
    rots = merge(IDLE_ARMS({f"upper_arm_{SIDE[s]}": [(Y, -0.9 * arm * s)] for s in S}),
                 {"ear_L.2": [(Y, -0.3 * arm)], "ear_R.2": [(Y, 0.3 * arm)], "tail.2": [(X, -0.3 * arm)]})
    k = 1 / math.sqrt(sq)
    HOP.append(pose_keys(f, rots, {"root": (0, 0, z)}, {"root": (k, k, sq)}))
make_action("Hop", 22, HOP)

WAG = [pose_keys(1 + k * 2, merge(IDLE_ARMS(), {f"tail.{i}": [(Z, (0.25 + 0.08 * i) * math.sin(k / 8 * 2 * math.pi - 0.6 * i))] for i in range(1, 6)}))
       for k in range(9)]
make_action("TailWag", 17, WAG, cyclic=True)

# Blink: quick close, a beat shut, softer open; brows dip a touch with the lids
BLINK = [pose_keys(f, IDLE_ARMS(), {"brow_L": (0, 0, -0.006 * (1 - sc)), "brow_R": (0, 0, -0.006 * (1 - sc))},
                   {"eye_L": (1 + 0.04 * (1 - sc), sc, 1), "eye_R": (1 + 0.04 * (1 - sc), sc, 1)})
         for f, sc in ((1, 1.0), (3, 0.5), (4, 0.1), (5, 0.08), (7, 0.55), (9, 0.95), (10, 1.0))]
make_action("Blink", 10, BLINK)

# ground shadow (flat, like the art)
bm = bmesh.new(); ellipsoid(bm, (0.0, -0.01, 0.0005), (0.26, 0.17, 0.0005), seg=64, rings=8)
g_ob = mesh_from_bm("GroundShadow", bm)
g_ob.data.materials.append(MATS["ground"])

bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
print("BILBY BUILD OK:", OUT_BLEND, "body faces", len(body.data.polygons))
