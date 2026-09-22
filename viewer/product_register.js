import * as THREE from "three";
import { OrbitControls } from "./vendor/OrbitControls.js";

const $ = (id) => document.getElementById(id);
window.addEventListener("error", (e) => { $("fatal").textContent = e.message; });
window.addEventListener("unhandledrejection", (e) => { $("fatal").textContent = String(e.reason); });

const SIZE = { double: 8, float: 4, int: 4, uint: 4, short: 2, ushort: 2, uchar: 1, char: 1 };

function readValue(view, offset, type) {
  switch (type) {
    case "double": return [view.getFloat64(offset, true), 8];
    case "float": return [view.getFloat32(offset, true), 4];
    case "int": return [view.getInt32(offset, true), 4];
    case "uint": return [view.getUint32(offset, true), 4];
    case "short": return [view.getInt16(offset, true), 2];
    case "ushort": return [view.getUint16(offset, true), 2];
    case "uchar": return [view.getUint8(offset), 1];
    case "char": return [view.getInt8(offset), 1];
    default: throw Error("不支持的 PLY 类型 " + type);
  }
}

async function loadPly(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw Error("无法读取 " + url);
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const needle = new TextEncoder().encode("end_header");
  let headerEnd = -1;
  for (let i = 0; i < bytes.length - needle.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle[j]) { ok = false; break; }
    if (ok) {
      let k = i + needle.length;
      if (bytes[k] === 13) k++;
      if (bytes[k] === 10) k++;
      headerEnd = k;
      break;
    }
  }
  if (headerEnd < 0) throw Error("PLY 没有 end_header: " + url);
  const header = new TextDecoder("ascii").decode(bytes.subarray(0, headerEnd));
  if (!header.includes("binary_little_endian")) throw Error("只支持 binary little endian PLY");
  const verts = { count: 0, props: [] };
  const faces = { count: 0, countType: "uchar", indexType: "int" };
  let section = null;
  for (const line of header.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === "element" && parts[1] === "vertex") { section = "v"; verts.count = Number(parts[2]); }
    else if (parts[0] === "element" && parts[1] === "face") { section = "f"; faces.count = Number(parts[2]); }
    else if (parts[0] === "property" && section === "v") verts.props.push({ type: parts[1], name: parts[2] });
    else if (parts[0] === "property" && parts[1] === "list" && section === "f") {
      faces.countType = parts[2];
      faces.indexType = parts[3];
    }
  }
  const view = new DataView(buf, headerEnd);
  let offset = 0;
  const pos = new Float32Array(verts.count * 3);
  const rgb = new Float32Array(verts.count * 3);
  const hasColor = verts.props.some((p) => p.name === "red");
  for (let i = 0; i < verts.count; i++) {
    const rec = {};
    for (const prop of verts.props) {
      const [value, size] = readValue(view, offset, prop.type);
      rec[prop.name] = value;
      offset += size;
    }
    pos[i * 3] = rec.x; pos[i * 3 + 1] = rec.y; pos[i * 3 + 2] = rec.z;
    if (hasColor) {
      rgb[i * 3] = rec.red / 255;
      rgb[i * 3 + 1] = rec.green / 255;
      rgb[i * 3 + 2] = rec.blue / 255;
    }
  }
  const idx = [];
  for (let i = 0; i < faces.count; i++) {
    const [n, nSize] = readValue(view, offset, faces.countType);
    offset += nSize;
    const ids = [];
    for (let k = 0; k < n; k++) {
      const [v, size] = readValue(view, offset, faces.indexType);
      ids.push(v);
      offset += size;
    }
    if (n === 3) idx.push(ids[0], ids[1], ids[2]);
    else if (n === 4) idx.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
  }
  return { pos, rgb, index: new Uint32Array(idx), hasColor, nv: verts.count };
}

async function loadLabels(url, count) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  const buf = await res.arrayBuffer();
  const labels = new Int32Array(buf);
  if (labels.length !== count) throw Error("标签数量与网格顶点不一致");
  return labels;
}

async function loadFloat32(url, count) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  const values = new Float32Array(await res.arrayBuffer());
  if (values.length !== count) throw Error("残差数量与网格顶点不一致");
  return values;
}

async function loadUint8(url, count) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  const values = new Uint8Array(await res.arrayBuffer());
  if (values.length !== count) throw Error("覆盖掩码数量与网格顶点不一致");
  return values;
}

function displayColors(ply) {
  const rgb = new Float32Array(ply.nv * 3);
  const c = new THREE.Color();
  if (ply.hasColor) {
    for (let i = 0; i < ply.nv; i++) {
      c.setRGB(ply.rgb[i * 3], ply.rgb[i * 3 + 1], ply.rgb[i * 3 + 2]).convertSRGBToLinear();
      c.toArray(rgb, i * 3);
    }
    return rgb;
  }
  c.set("#cfc4b4").convertSRGBToLinear();
  for (let i = 0; i < ply.nv; i++) c.toArray(rgb, i * 3);
  return rgb;
}

function residualColors(count, residual, covered, vmax) {
  const rgb = new Float32Array(count * 3);
  const c = new THREE.Color();
  const mid = 0.25;
  const scale = Math.max(Number(vmax) || 1, 1e-6);
  for (let i = 0; i < count; i++) {
    if (covered && !covered[i]) {
      c.setRGB(0.62, 0.64, 0.67).convertSRGBToLinear();
      c.toArray(rgb, i * 3);
      continue;
    }
    const t = Math.min(Math.max((residual[i] || 0) / scale, 0), 1);
    let r;
    let g;
    let b;
    if (t <= mid) {
      const s = t / mid;
      r = 0.18 + 0.77 * s;
      g = 0.72 - 0.05 * s;
      b = 0.22 * (1.0 - s);
    } else {
      const s = (t - mid) / (1.0 - mid);
      r = 0.95;
      g = 0.67 * (1.0 - s);
      b = 0.10 * (1.0 - s);
    }
    c.setRGB(r, g, b).convertSRGBToLinear();
    c.toArray(rgb, i * 3);
  }
  return rgb;
}

function applyRowMajor(T, p) {
  return [
    T[0][0] * p[0] + T[0][1] * p[1] + T[0][2] * p[2] + T[0][3],
    T[1][0] * p[0] + T[1][1] * p[1] + T[1][2] * p[2] + T[1][3],
    T[2][0] * p[0] + T[2][1] * p[1] + T[2][2] * p[2] + T[2][3],
  ];
}

function invertRowMajor(T, p) {
  const r = [
    [T[0][0], T[0][1], T[0][2]],
    [T[1][0], T[1][1], T[1][2]],
    [T[2][0], T[2][1], T[2][2]],
  ];
  const t = [T[0][3], T[1][3], T[2][3]];
  const q = [p[0] - t[0], p[1] - t[1], p[2] - t[2]];
  return [
    r[0][0] * q[0] + r[1][0] * q[1] + r[2][0] * q[2],
    r[0][1] * q[0] + r[1][1] * q[1] + r[2][1] * q[2],
    r[0][2] * q[0] + r[1][2] * q[1] + r[2][2] * q[2],
  ];
}

function panel(hostId) {
  const host = $(hostId);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#19222d");
  const camera = new THREE.PerspectiveCamera(36, 1, 0.05, 2000);
  camera.up.set(0, 0, 1);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.appendChild(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  const group = new THREE.Group();
  const marks = new THREE.Group();
  scene.add(group, marks);
  scene.add(new THREE.AmbientLight(0xffffff, 0.95));
  const key = new THREE.DirectionalLight(0xffffff, 1.05);
  key.position.set(4, -6, 8);
  camera.add(key);
  scene.add(camera);
  const draw = () => renderer.render(scene, camera);
  new ResizeObserver(() => {
    renderer.setSize(host.clientWidth, host.clientHeight, false);
    camera.aspect = host.clientWidth / host.clientHeight || 1;
    camera.updateProjectionMatrix();
    draw();
  }).observe(host);
  controls.addEventListener("change", draw);
  return { host, scene, camera, renderer, controls, group, marks, draw };
}

function visibleTriangleIndex(ply, labels, wanted) {
  if (!labels || !wanted || wanted.size === 0) return ply.index;
  const selected = [];
  for (let i = 0; i < ply.index.length; i += 3) {
    const a = ply.index[i];
    const b = ply.index[i + 1];
    const c = ply.index[i + 2];
    // 任一顶点属于备牙/邻牙即保留。三顶点都要在集合里会挖掉龈缘和邻接混合面。
    if (wanted.has(Number(labels[a])) ||
        wanted.has(Number(labels[b])) ||
        wanted.has(Number(labels[c]))) {
      selected.push(a, b, c);
    }
  }
  return new Uint32Array(selected);
}

function meshFrom(ply, rgb, labels = null, wanted = null) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(ply.pos, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(rgb, 3));
  geometry.setIndex(new THREE.BufferAttribute(visibleTriangleIndex(ply, labels, wanted), 1));
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.92, metalness: 0, side: THREE.DoubleSide,
  });
  return new THREE.Mesh(geometry, material);
}

function setVisibleLabels(mesh, ply, labels, wanted) {
  mesh.geometry.setIndex(
    new THREE.BufferAttribute(visibleTriangleIndex(ply, labels, wanted), 1),
  );
  mesh.geometry.computeVertexNormals();
}

function addBall(group, xyz, color, scale = 0.22, userData = {}) {
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(scale, 14, 10),
    new THREE.MeshBasicMaterial({ color }),
  );
  ball.position.set(xyz[0], xyz[1], xyz[2]);
  Object.assign(ball.userData, userData);
  group.add(ball);
  return ball;
}

function numberSprite(n, color, scale = 1.35) {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#" + Number(color).toString(16).padStart(6, "0");
  ctx.beginPath();
  ctx.arc(32, 32, 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#10151c";
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = "#10151c";
  ctx.font = "bold 32px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(n), 32, 34);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sprite.renderOrder = 10;
  sprite.scale.set(scale, scale, 1);
  sprite.userData.dispose = () => {
    tex.dispose();
    sprite.material.dispose();
  };
  return sprite;
}

function addNumberedMark(group, xyz, n, color, scale, userData = {}) {
  const hit = addBall(group, xyz, color, scale, userData);
  hit.material.transparent = true;
  hit.material.opacity = 0.18;
  const sprite = numberSprite(n, color, Math.max(scale * 5.5, 1.2));
  sprite.position.set(xyz[0], xyz[1], xyz[2]);
  Object.assign(sprite.userData, userData);
  group.add(sprite);
  return hit;
}

function fitBox(p, box, distanceScale = 1.6) {
  const size = box.getSize(new THREE.Vector3());
  const dist = Math.max(size.x, size.y, size.z) * distanceScale;
  if (applySessionCamera(p, box.getCenter(new THREE.Vector3()), dist)) return;
  const center = box.getCenter(new THREE.Vector3());
  p.camera.position.set(center.x, center.y - dist, center.z + dist * 0.28);
  p.controls.target.copy(center);
  p.camera.near = 0.05;
  p.camera.far = dist * 20;
  p.camera.updateProjectionMatrix();
  p.controls.update();
  p.draw();
}

function applySessionCamera(p, lookatFallback, dist) {
  const cam = session.camera;
  if (!cam || !cam.front || !cam.lookat || !cam.up) return false;
  const lookat = new THREE.Vector3(cam.lookat[0], cam.lookat[1], cam.lookat[2]);
  const front = new THREE.Vector3(cam.front[0], cam.front[1], cam.front[2]);
  if (front.lengthSq() < 1e-8) return false;
  front.normalize();
  const up = new THREE.Vector3(cam.up[0], cam.up[1], cam.up[2]);
  if (up.lengthSq() < 1e-8) return false;
  up.normalize();
  if (lookatFallback && lookatFallback.lengthSq() > 0) {
    lookat.copy(lookatFallback);
  }
  p.camera.up.copy(up);
  p.camera.position.copy(lookat).addScaledVector(front, dist);
  p.controls.target.copy(lookat);
  p.camera.near = 0.05;
  p.camera.far = dist * 20;
  p.camera.updateProjectionMatrix();
  p.controls.update();
  p.draw();
  return true;
}

function fit(p, object) {
  fitBox(p, new THREE.Box3().setFromObject(object));
}

function fitToLabels(p, ply, labels, wanted, fallbackObject) {
  if (!labels || !wanted.size) {
    fit(p, fallbackObject);
    return;
  }
  const box = new THREE.Box3();
  const point = new THREE.Vector3();
  for (let i = 0; i < ply.nv; i++) {
    if (!wanted.has(Number(labels[i]))) continue;
    point.set(ply.pos[i * 3], ply.pos[i * 3 + 1], ply.pos[i * 3 + 2]);
    box.expandByPoint(point);
  }
  if (box.isEmpty()) fit(p, fallbackObject);
  else fitBox(p, box, 1.35);
}

function fdiText(label, fdi) {
  return fdi ? `标签 ${label}（FDI ${fdi}）` : `标签 ${label}`;
}

const session = await fetch("/session/session.json", { cache: "no-store" }).then((r) => {
  if (!r.ok) throw Error("找不到选点会话，请从评分流水线打开本页");
  return r.json();
});

$("reason").textContent = session.reason || "左 PRE / 右 POST：点牙面看误差，或在 POST 上点对应位置";
$("summary").textContent = (session.summary_lines || []).join("  ·  ");
if (session.allow_accept) {
  $("page-title").textContent = "配准告警 WARN · 左 PRE / 右 POST";
}
let prepLabel = Number(session.prep_label);
// 自动配准已知道备牙标签；打开页面后直接展示 PRE 邻牙特征点。
// 如自动识别的备牙有误，用户仍可点“改选备牙”回到 PRE 选择。
let phase = "points";
const matches = new Map();
const skipped = new Set();
let activeId = null;
const history = [];
const SNAP_MM = 1.6;

const left = panel("left");
const right = panel("right");
const [prePly, postPly] = await Promise.all([loadPly("/session/pre.ply"), loadPly("/session/post.ply")]);
const preLabels = await loadLabels("/session/pre_labels.bin", prePly.nv);
const postLabels = await loadLabels("/session/post_labels.bin", postPly.nv);
const residual = session.has_residual
  ? await loadFloat32("/session/post_residual_mm.bin", postPly.nv)
  : null;
const residualCovered = session.has_residual
  ? await loadUint8("/session/post_residual_covered.bin", postPly.nv)
  : null;
const T = session.coarse_transform;

const postPos = new Float32Array(postPly.pos.length);
for (let i = 0; i < postPly.nv; i++) {
  const moved = applyRowMajor(T, [postPly.pos[i * 3], postPly.pos[i * 3 + 1], postPly.pos[i * 3 + 2]]);
  postPos[i * 3] = moved[0];
  postPos[i * 3 + 1] = moved[1];
  postPos[i * 3 + 2] = moved[2];
}
postPly.pos = postPos;

const initialWorkingTeeth = new Set([
  prepLabel,
  ...(session.neighbor_labels || []).map(Number),
]);
const preMesh = meshFrom(
  prePly,
  displayColors(prePly),
  preLabels,
  initialWorkingTeeth,
);
const postMesh = meshFrom(
  postPly,
  residual
    ? residualColors(postPly.nv, residual, residualCovered, session.residual_vmax_mm || 1)
    : displayColors(postPly),
  postLabels,
  initialWorkingTeeth,
);
left.group.add(preMesh);
right.group.add(postMesh);
if (residual) {
  $("right-label").textContent = "POST · 误差着色 · 左键看 mm · Shift + 右键选对应点";
}

function refitWorkingTeeth() {
  const focusLabels = phase === "points"
    ? new Set([prepLabel, ...neighborLabelsFor(prepLabel)])
    : null;
  setVisibleLabels(preMesh, prePly, preLabels, focusLabels);
  setVisibleLabels(postMesh, postPly, postLabels, focusLabels);
  if (!focusLabels) {
    fit(left, preMesh);
    fit(right, postMesh);
    return;
  }
  fitToLabels(left, prePly, preLabels, focusLabels, preMesh);
  fitToLabels(right, postPly, postLabels, focusLabels, postMesh);
}

refitWorkingTeeth();

function nearestVertex(ply, point) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < ply.nv; i++) {
    const dx = ply.pos[i * 3] - point.x;
    const dy = ply.pos[i * 3 + 1] - point.y;
    const dz = ply.pos[i * 3 + 2] - point.z;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

function refreshPrepLabel() {
  const fdiMap = session.label_to_fdi || {};
  $("prep").textContent = fdiText(prepLabel, Number(fdiMap[String(prepLabel)] || 0));
}

function catalogTeeth() {
  return session.catalog_teeth || session.teeth || [];
}

function neighborLabelsFor(prep) {
  const all = catalogTeeth().map((t) => Number(t.label));
  const present = new Set(all);
  const sessionNeighbors = (session.neighbor_labels || [])
    .map(Number)
    .filter((lb) => lb > 0 && lb !== Number(prep) && present.has(lb));
  if (sessionNeighbors.length >= 2 && Number(prep) === Number(session.prep_label)) {
    return sessionNeighbors;
  }
  const archLike = all.length > 0 && all.every((lb) => lb >= 1 && lb <= 14);
  if (archLike) {
    return [Number(prep) - 1, Number(prep) + 1].filter((lb) => lb >= 1 && lb <= 14 && present.has(lb));
  }
  if (sessionNeighbors.length) return sessionNeighbors;
  return all.filter((lb) => lb !== Number(prep));
}

function fdiArchKey(fdi, label) {
  const tooth = Number(fdi) || 0;
  if (tooth <= 0) return [2, 0, Number(label)];
  const quad = Math.floor(tooth / 10);
  const number = tooth % 10;
  if (quad === 1 || quad === 4) return [0, -number, Number(label)];
  if (quad === 2 || quad === 3) return [1, number, Number(label)];
  return [2, tooth, Number(label)];
}

function cmpTuple(a, b) {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function toothCentroid(feats) {
  const sum = [0, 0, 0];
  for (const feat of feats) {
    sum[0] += feat.xyz[0];
    sum[1] += feat.xyz[1];
    sum[2] += feat.xyz[2];
  }
  const n = feats.length || 1;
  return [sum[0] / n, sum[1] / n, sum[2] / n];
}

function visibleTargets() {
  const nbs = new Set(neighborLabelsFor(prepLabel));
  const groups = [];
  for (const tooth of catalogTeeth()) {
    const label = Number(tooth.label);
    if (!nbs.has(label) || label === Number(prepLabel)) continue;
    const feats = (tooth.features || []).map((feat) => ({
      ...feat,
      label,
      fdi: tooth.fdi,
      id: String(feat.id),
      xyz: feat.xyz,
    }));
    if (!feats.length) continue;
    groups.push({
      label,
      fdi: Number(tooth.fdi) || 0,
      feats,
      centroid: toothCentroid(feats),
      key: fdiArchKey(tooth.fdi, label),
    });
  }
  groups.sort((a, b) => cmpTuple(a.key, b.key));
  let dir = [1, 0, 0];
  if (groups.length >= 2) {
    const a = groups[0].centroid;
    const b = groups[groups.length - 1].centroid;
    dir = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const length = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    dir = dir.map((value) => value / length);
  }
  const out = [];
  for (const group of groups) {
    group.feats.sort((a, b) => {
      const da = a.xyz[0] * dir[0] + a.xyz[1] * dir[1] + a.xyz[2] * dir[2];
      const db = b.xyz[0] * dir[0] + b.xyz[1] * dir[1] + b.xyz[2] * dir[2];
      return da - db || Number(a.priority || 0) - Number(b.priority || 0);
    });
    out.push(...group.feats);
  }
  out.forEach((feat, i) => {
    feat.index = i + 1;
  });
  return out;
}

function targetById(id) {
  return visibleTargets().find((f) => f.id === String(id));
}

function nextUnmatchedId() {
  for (const feat of visibleTargets()) {
    if (!matches.has(feat.id) && !skipped.has(feat.id)) return feat.id;
  }
  return null;
}

function resetPairs() {
  matches.clear();
  skipped.clear();
  history.length = 0;
  activeId = nextUnmatchedId();
}

function setActive(id) {
  if (id && skipped.has(id)) skipped.delete(id);
  activeId = id || nextUnmatchedId();
}

function markColor(feat) {
  if (matches.has(feat.id)) return 0x69db7c;
  if (skipped.has(feat.id)) return 0x596573;
  if (feat.id === activeId) return 0xff4d4d;
  return 0xf3bd45;
}

function clearMarks(panel) {
  for (const child of [...panel.marks.children]) {
    child.userData?.dispose?.();
    child.geometry?.dispose();
    child.material?.map?.dispose?.();
    child.material?.dispose();
    panel.marks.remove(child);
  }
}

function redrawMarks() {
  clearMarks(left);
  clearMarks(right);
  if (phase !== "points") {
    left.draw();
    right.draw();
    return;
  }
  for (const feat of visibleTargets()) {
    const current = feat.id === activeId;
    addNumberedMark(
      left.marks,
      feat.xyz,
      feat.index,
      markColor(feat),
      current ? 0.42 : 0.28,
      { featureId: feat.id },
    );
  }
  for (const pair of matches.values()) {
    const feat = targetById(pair.feature_id);
    addNumberedMark(
      right.marks,
      applyRowMajor(T, pair.post),
      feat?.index || 0,
      0x69db7c,
      0.28,
      { featureId: pair.feature_id },
    );
  }
  left.draw();
  right.draw();
}

function renderChips() {
  $("chips").replaceChildren();
  for (const feat of visibleTargets()) {
    const span = document.createElement("span");
    span.className = "chip";
    if (matches.has(feat.id)) span.classList.add("done");
    else if (skipped.has(feat.id)) span.classList.add("skipped");
    else if (feat.id === activeId) span.classList.add("current");
    const fdi = feat.fdi ? ` FDI${feat.fdi}` : "";
    const landmark = feat.name ? ` ${feat.name}` : "";
    span.textContent = matches.has(feat.id)
      ? `${feat.index}✓${fdi}${landmark}`
      : skipped.has(feat.id)
        ? `${feat.index}跳过${fdi}${landmark}`
        : feat.id === activeId
          ? `${feat.index}当前${fdi}${landmark}`
          : `${feat.index}${fdi}${landmark}`;
    span.title = `${feat.name || "地标点"} · ${feat.id}`;
    span.addEventListener("click", () => {
      setActive(feat.id);
      updateChrome();
    });
    $("chips").append(span);
  }
}

function updateChrome() {
  const picking = phase === "points";
  const nPairs = matches.size;
  const minPairs = Number(session.min_pairs || 4);
  const current = targetById(activeId);
  $("phase").textContent = picking ? "在 POST 上点对应位置" : "改选备牙";
  $("hint").textContent = picking
    ? (current
      ? `当前目标 ${current.index}：FDI ${current.fdi || current.label} ${current.name || "舌窝转折"}。左键看误差；右侧 POST 按 Shift + 右键点同一位置。`
      : nPairs >= minPairs
        ? "已够 4 对，可提交；也可继续补点。左键仍可看误差。"
        : "没有未匹配的 PRE 特征点了，请改选或撤销后继续。")
        : "左侧 PRE 上按 Shift + 右键点正确备牙；网格保持扫描原色。";
  $("confirm-prep").hidden = picking;
  $("back-prep").hidden = !picking;
  $("feature-row").hidden = !picking;
  $("submit").disabled = nPairs < minPairs;
  $("accept").hidden = !session.allow_accept || !picking;
  $("status").textContent = picking
    ? (session.allow_accept
      ? `可接受当前配准，或已配 ${nPairs} 对；Shift + 右键选点，至少 ${minPairs} 对后再提交。`
      : `已配 ${nPairs} 对；按住 Shift + 右键选点，至少 ${minPairs} 对。提交后再邻牙 ICP。`)
    : "先确认备牙";
  if (picking) renderChips();
  redrawMarks();
}

function pickPrep(point) {
  const idx = nearestVertex(prePly, point);
  const label = preLabels ? preLabels[idx] : 0;
  if (label <= 0) return;
  prepLabel = label;
  const fdiMap = session.label_to_fdi || {};
  session.prep_fdi = Number(fdiMap[String(prepLabel)] || 0);
  refreshPrepLabel();
}

function nearestTarget(point) {
  let best = null;
  let bestD = SNAP_MM * SNAP_MM * 4;
  for (const feat of visibleTargets()) {
    const dx = feat.xyz[0] - point.x;
    const dy = feat.xyz[1] - point.y;
    const dz = feat.xyz[2] - point.z;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = feat;
    }
  }
  return best;
}

function pickPreTarget(point, featureId) {
  const feat = featureId ? targetById(featureId) : nearestTarget(point);
  if (!feat) return;
  setActive(feat.id);
  updateChrome();
}

function pickPostPoint(point) {
  if (!activeId) {
    $("status").textContent = "请先在上方选择一个 PRE 地标作为当前目标";
    return;
  }
  const feat = targetById(activeId);
  if (!feat) return;
  const idx = nearestVertex(postPly, point);
  if (postLabels && Number(postLabels[idx]) === Number(prepLabel)) {
    $("status").textContent = "请点邻牙，不要点备牙";
    return;
  }
  const world = [postPly.pos[idx * 3], postPly.pos[idx * 3 + 1], postPly.pos[idx * 3 + 2]];
  const pair = { feature_id: feat.id, pre: feat.xyz, post: invertRowMajor(T, world) };
  const prev = matches.has(feat.id) ? matches.get(feat.id) : null;
  const wasSkipped = skipped.has(feat.id);
  matches.set(feat.id, pair);
  skipped.delete(feat.id);
  history.push({ type: "match", id: feat.id, prev, wasSkipped });
  activeId = nextUnmatchedId();
  updateChrome();
}

function residualAtPoint(point) {
  if (!residual) return null;
  const idx = nearestVertex(postPly, point);
  const mm = residual[idx];
  if (!Number.isFinite(mm)) return null;
  return {
    idx,
    mm,
    covered: residualCovered ? Boolean(residualCovered[idx]) : true,
  };
}

function removeProbeMarks() {
  for (const view of [left, right]) {
    for (const child of [...view.marks.children]) {
      if (!child.userData?.probe) continue;
      child.userData?.dispose?.();
      child.geometry?.dispose();
      child.material?.dispose();
      view.marks.remove(child);
    }
  }
}

function showProbe(point, panel) {
  const hit = residualAtPoint(point);
  if (!hit) {
    $("probe").textContent = "该点没有误差数据";
    return;
  }
  const text = hit.covered
    ? `误差 ${hit.mm.toFixed(3)} mm`
    : `误差 ${hit.mm.toFixed(3)} mm（对侧覆盖不足）`;
  $("probe").textContent = text;
  removeProbeMarks();
  addBall(panel.marks, [point.x, point.y, point.z], 0xffffff, 0.16, { probe: true });
  panel.draw();
}

function bindProbe(panel) {
  let down = null;
  panel.host.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.shiftKey) return;
    down = { x: event.clientX, y: event.clientY };
  });
  panel.host.addEventListener("pointerup", (event) => {
    if (!down || event.button !== 0) return;
    const dx = event.clientX - down.x;
    const dy = event.clientY - down.y;
    down = null;
    if (dx * dx + dy * dy > 16) return;
    const box = panel.host.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - box.left) / box.width) * 2 - 1,
      -((event.clientY - box.top) / box.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, panel.camera);
    const hit = raycaster.intersectObjects(panel.group.children, false)[0];
    if (hit) showProbe(hit.point, panel);
  });
}

function bindPick(panel, onHit) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  panel.host.addEventListener("contextmenu", (event) => {
    if (event.shiftKey) event.preventDefault();
  });
  panel.host.addEventListener("pointerdown", (event) => {
    if (event.button !== 2 || !event.shiftKey) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const box = panel.host.getBoundingClientRect();
    pointer.x = ((event.clientX - box.left) / box.width) * 2 - 1;
    pointer.y = -((event.clientY - box.top) / box.height) * 2 + 1;
    raycaster.setFromCamera(pointer, panel.camera);
    const markHits = raycaster.intersectObjects(panel.marks.children, false);
    const meshHits = raycaster.intersectObjects(panel.group.children, false);
    const mark = markHits.find((h) => h.object.userData?.featureId);
    const hit = mark || meshHits[0];
    if (!hit) return;
    onHit(hit.point, hit.object.userData?.featureId || null);
  }, { capture: true });
}

bindPick(left, (point, featureId) => {
  if (phase === "prep") pickPrep(point);
  else if (phase === "points") pickPreTarget(point, featureId);
});
bindPick(right, (point) => {
  if (phase === "points") pickPostPoint(point);
});
bindProbe(left);
bindProbe(right);

$("confirm-prep").addEventListener("click", () => {
  phase = "points";
  refitWorkingTeeth();
  resetPairs();
  updateChrome();
});
$("back-prep").addEventListener("click", () => {
  phase = "prep";
  refitWorkingTeeth();
  resetPairs();
  updateChrome();
});
$("undo").addEventListener("click", () => {
  const last = history.pop();
  if (!last) {
    updateChrome();
    return;
  }
  if (last.type === "match") {
    if (last.prev) matches.set(last.id, last.prev);
    else matches.delete(last.id);
    if (last.wasSkipped) skipped.add(last.id);
    activeId = last.id;
  } else if (last.type === "skip") {
    skipped.delete(last.id);
    activeId = last.id;
  }
  updateChrome();
});
$("skip").addEventListener("click", () => {
  if (!activeId) {
    updateChrome();
    return;
  }
  skipped.add(activeId);
  history.push({ type: "skip", id: activeId });
  activeId = nextUnmatchedId();
  updateChrome();
});

async function postApi(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw Error("提交失败");
}

$("submit").addEventListener("click", async () => {
  $("submit").disabled = true;
  $("accept").disabled = true;
  $("status").textContent = "已提交，流水线继续…";
  await postApi("/api/submit", {
    prep_label: prepLabel,
    pairs: [...matches.values()],
  });
});
$("accept").addEventListener("click", async () => {
  $("accept").disabled = true;
  $("submit").disabled = true;
  $("status").textContent = "已接受当前配准，流水线继续…";
  await postApi("/api/submit", {
    prep_label: prepLabel,
    accepted: true,
    accept_registration: true,
  });
});
$("cancel").addEventListener("click", async () => {
  await postApi("/api/cancel", { cancelled: true });
  $("status").textContent = "已取消";
});

refreshPrepLabel();
resetPairs();
updateChrome();
