import { DISPLAY_PALETTE, SHOULDER_IDS, SHOULDER_NAMES } from './anatomical_palette.js';
import * as THREE from 'three';
import {PanelRenderer, ModelCache} from './render_runtime.js';
import {OrbitControls} from './vendor/OrbitControls.js';

// 独立平台查看器：最终结果、同次平台原色和真实候选各自使用对应产物。
const $ = id => document.getElementById(id);
const header = document.querySelector('header');
new ResizeObserver(() => document.documentElement.style.setProperty('--review-header-height',`${Math.ceil(header.getBoundingClientRect().height)}px`)).observe(header);
const cache = new ModelCache(8), panels = [];
const directions = {front:[0,-1,.12],back:[0,1,.12],sideA:[1,0,.12],sideB:[-1,0,.12],top:[0,0,1],bottom:[0,0,-1]};
const fallbackPalette = DISPLAY_PALETTE;
const modeNames = {segmentation:'最终牙面与肩台',grey:'最终灰色牙体',shoulder:'最终肩台高亮',color:'平台阶段原色',candidate:'平台试验候选'};
const query = new URLSearchParams(location.search);
let data, current, serial = 0, syncing = false, filter = ['11','46'].includes(query.get('fdi')) ? query.get('fdi') : 'all';
let view = Object.hasOwn(directions,query.get('view')) ? query.get('view') : 'front';
if (Object.hasOwn(modeNames,query.get('mode'))) $('display-mode').value = query.get('mode');
$('removed').checked = query.get('removed') === '1';

function showError(error) {
  $('fatal').hidden = false;
  $('fatal').textContent = String(error?.message || error);
}
window.addEventListener('error',event => showError(event.error || event.message));
window.addEventListener('unhandledrejection',event => showError(event.reason));
function draw(panel) { panel.renderer.render(panel.scene,panel.camera); }
function makePanel(id) {
  const host = $(id), scene = new THREE.Scene();
  scene.background = new THREE.Color('#19222d');
  const camera = new THREE.PerspectiveCamera(36,1,.03,2000);
  camera.up.set(0,0,1); camera.position.set(0,-35,5);
  const renderer = new PanelRenderer();
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.hidden = true;
  renderer.domElement.setAttribute('aria-label',id === 'left' ? '左侧三维模型' : '右侧三维模型');
  host.appendChild(renderer.domElement);
  const controls = new OrbitControls(camera,renderer.domElement);
  controls.enableDamping = false; controls.minDistance = .1; controls.maxDistance = 1000;
  const group = new THREE.Group();
  scene.add(group,new THREE.AmbientLight(0xffffff,1.5));
  const light = new THREE.DirectionalLight(0xffffff,2);
  light.position.set(2,2,4); camera.add(light); scene.add(camera);
  const panel = {id,host,scene,camera,renderer,controls,group};
  panels.push(panel);
  const resize = () => {
    const width = host.clientWidth, height = host.clientHeight;
    renderer.setSize(width,height,false);
    camera.aspect = width / Math.max(1,height); camera.updateProjectionMatrix(); draw(panel);
  };
  new ResizeObserver(resize).observe(host); resize();
  controls.addEventListener('change',() => {
    draw(panel);
    if (syncing) return;
    syncing = true;
    for (const other of panels) {
      if (other === panel) continue;
      other.camera.position.copy(camera.position); other.camera.quaternion.copy(camera.quaternion);
      other.camera.up.copy(camera.up); other.camera.zoom = camera.zoom;
      other.camera.updateProjectionMatrix(); other.controls.target.copy(controls.target);
      other.controls.update(); draw(other);
    }
    syncing = false;
  });
  return panel;
}
const left = makePanel('left'), right = makePanel('right');

function clear(panel,message = '') {
  for (const object of [...panel.group.children]) {
    object.geometry?.dispose(); object.material?.dispose(); panel.group.remove(object);
  }
  panel.renderer.domElement.hidden = true;
  panel.renderer.domElement.dataset.modelKey = '';
  panel.host.dataset.modelKey = '';
  $(`${panel.id}-empty`).textContent = message;
  $(`${panel.id}-empty`).hidden = !message;
  $(`${panel.id}-detail`).textContent = '';
  draw(panel);
}
function available(descriptor) { return !!descriptor && typeof descriptor.url === 'string' && !!descriptor.url; }
function versionName(key) {
  const value = data?.[key === 'before' ? 'baseline_name' : 'candidate_name'];
  return typeof value === 'string' && value.trim() ? value.trim() : key === 'before' ? '基线' : '本轮';
}
function modelName(key) {
  if (key === 'candidate') return '平台试验候选';
  if (key === 'input') return '本轮平台输入原色';
  if (key === 'refined') return '本轮平台输出原色';
  return `${versionName(key)} 最终分割`;
}
function removedKey() { return $('display-mode').value === 'candidate' ? null : 'removed'; }
function removedName() { return '平台实际删除片'; }
function updateRemovedControl() {
  const trial = $('display-mode').value === 'candidate', present = available(current.models?.removed);
  $('removed').disabled = trial || !present;
  if ($('removed').disabled) $('removed').checked = false;
  $('removed-label').textContent = trial ? '试验模式不叠加正式删除片' : '叠加平台实际删除片';
  $('removed-note').textContent = trial ? '试验模式只显示真实候选，正式处理的删除片不叠加到候选上。' : present ? '橙色叠加来自本轮平台阶段实际删除片，只显示在右侧，不属于保留牙体。' : '本例未提供实际删除片网格，无法叠加；这不等同于已知删除面积为零。';
}
function modelUrl(url) {
  const resolved = new URL(url,location.href);
  if (!['http:','https:'].includes(resolved.protocol)) throw Error('模型地址不是可读取的网页资源');
  return resolved.href;
}
async function readModel(info) {
  const url = modelUrl(info.url);
  if (cache.has(url)) return cache.get(url);
  const pending = (async () => {
    const response = await fetch(url);
    if (!response.ok) throw Error(`模型读取失败（HTTP ${response.status}）：${info.url}`);
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength < 8) throw Error(`模型头不完整：${info.url}`);
    const header = new DataView(buffer), nv = header.getUint32(0,true), nf = header.getUint32(4,true);
    if (!nv || !nf || buffer.byteLength !== 8 + nv * 40 + nf * 12) throw Error(`模型长度或面数无效：${info.url}`);
    if ((info.vertices != null && Number(info.vertices) !== nv) || (info.faces != null && Number(info.faces) !== nf)) throw Error(`模型计数与清单不一致：${info.url}`);
    const packed = new Float32Array(buffer,8,nv * 10), faces = new Uint32Array(buffer,8 + nv * 40,nf * 3);
    const positions = new Float32Array(nv * 3), normals = new Float32Array(nv * 3), rgb = new Float32Array(nv * 3), labels = new Float32Array(nv);
    for (let i = 0; i < nv; i++) {
      for (let axis = 0; axis < 3; axis++) {
        const p = packed[i * 10 + axis], n = packed[i * 10 + 3 + axis], color = packed[i * 10 + 6 + axis];
        if (![p,n,color].every(Number.isFinite)) throw Error(`模型存在非有限数值：${info.url}`);
        positions[i * 3 + axis] = p; normals[i * 3 + axis] = n; rgb[i * 3 + axis] = color;
      }
      labels[i] = packed[i * 10 + 9];
    }
    for (const index of faces) if (index >= nv) throw Error(`模型三角面索引越界：${info.url}`);
    return {positions,normals,rgb,labels,faces,nv,nf};
  })();
  cache.set(url,pending);
  return pending;
}
function paletteColor(label) {
  const color = DISPLAY_PALETTE[label] ?? data.palette?.[label] ?? fallbackPalette[0];
  return typeof color === 'object' && color !== null && !Array.isArray(color) ? color.color || fallbackPalette[label] : color;
}
function setColor(color,value) {
  if (Array.isArray(value)) {
    const divisor = value.some(component => component > 1) ? 255 : 1;
    color.setRGB(value[0] / divisor,value[1] / divisor,value[2] / divisor).convertSRGBToLinear();
  } else color.set(value);
}
function addModel(panel,model,key,mode,removed = false) {
  if (!removed && mode !== 'color') {
    for (const label of model.labels) if (!Number.isInteger(label) || label < 0 || label > 10) throw Error('最终模型的牙面标签超出 0–10 范围');
  }
  const colors = new Float32Array(model.nv * 3), color = new THREE.Color();
  for (let i = 0; i < model.nv; i++) {
    const label = model.labels[i];
    if (removed) color.set('#ffa326');
    else if (mode === 'color') color.setRGB(model.rgb[i * 3],model.rgb[i * 3 + 1],model.rgb[i * 3 + 2]).convertSRGBToLinear();
    else if (mode === 'grey') color.set('#b2becb');
    else if (mode === 'shoulder') setColor(color,SHOULDER_IDS.includes(label) ? paletteColor(label) : '#758698');
    else setColor(color,paletteColor(label));
    color.toArray(colors,i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(model.positions,3));
  geometry.setAttribute('normal',new THREE.BufferAttribute(model.normals,3));
  geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
  geometry.setIndex(new THREE.BufferAttribute(model.faces,1));
  const material = new THREE.MeshStandardMaterial({vertexColors:true,roughness:.85,metalness:0,side:THREE.DoubleSide,wireframe:$('wire').checked});
  const mesh = new THREE.Mesh(geometry,material); mesh.name = key; panel.group.add(mesh);
  if (!removed) {
    panel.host.dataset.modelKey = key;
    panel.renderer.domElement.dataset.modelKey = key;
    $(`${panel.id}-detail`).textContent = `${model.nv.toLocaleString()} 顶点 · ${model.nf.toLocaleString()} 三角面`;
  }
  panel.renderer.domElement.hidden = false;
  $(`${panel.id}-empty`).hidden = true;
}
function validBounds(bounds) {
  return Array.isArray(bounds) && bounds.length === 2 && bounds.every(row => Array.isArray(row) && row.length === 3 && row.every(Number.isFinite)) && bounds[0].every((value,i) => value <= bounds[1][i]);
}
function fit() {
  if (!current) return;
  const bounds = new THREE.Box3();
  if (validBounds(current.bounds)) bounds.union(new THREE.Box3(new THREE.Vector3(...current.bounds[0]),new THREE.Vector3(...current.bounds[1])));
  for (const panel of panels) bounds.expandByObject(panel.group);
  if (bounds.isEmpty()) return;
  const center = bounds.getCenter(new THREE.Vector3()), radius = Math.max(.1,bounds.getSize(new THREE.Vector3()).length() / 2);
  const halfAngle = Math.min(...panels.map(panel => {
    const vertical = THREE.MathUtils.degToRad(panel.camera.fov) / 2;
    return Math.min(vertical,Math.atan(Math.tan(vertical) * panel.camera.aspect));
  }));
  const distance = radius / Math.sin(halfAngle) * 1.08, direction = new THREE.Vector3(...directions[view]).normalize();
  syncing = true;
  for (const panel of panels) {
    panel.controls.target.copy(center); panel.camera.position.copy(center).addScaledVector(direction,distance);
    panel.camera.up.set(0,['top','bottom'].includes(view) ? 1 : 0,['top','bottom'].includes(view) ? 0 : 1);
    panel.camera.near = Math.max(.005,distance / 1000); panel.camera.far = Math.max(1000,distance + radius * 10);
    panel.camera.updateProjectionMatrix(); panel.camera.lookAt(center); panel.controls.update(); draw(panel);
  }
  syncing = false;
  for (const button of $('views').querySelectorAll('[data-view]')) button.setAttribute('aria-pressed',String(button.dataset.view === view));
}
function updateUrl() {
  if (!current) return;
  const url = new URL(location.href);
  url.searchParams.set('mode',$('display-mode').value); url.searchParams.set('view',view);
  if (filter === 'all') url.searchParams.delete('fdi'); else url.searchParams.set('fdi',filter);
  if ($('removed').checked) url.searchParams.set('removed','1'); else url.searchParams.delete('removed');
  url.hash = current.id; history.replaceState(null,'',url);
}
function makeLegend() {
  $('legend').replaceChildren();
  const mode = $('display-mode').value;
  let items = mode === 'color' ? [['扫描原色','#bbd6d7']] : mode === 'grey' ? [['最终牙体','#b2becb']] : mode === 'shoulder' ? [['牙体','#758698'],...SHOULDER_IDS.map(id=>[SHOULDER_NAMES[id],paletteColor(id)])] : [[Number(current.prep_fdi) === 11 ? '切端' : '咬合面',paletteColor(1)],['唇 / 颊侧',paletteColor(2)],['舌侧',paletteColor(3)],['近中',paletteColor(4)],['远中',paletteColor(5)],...SHOULDER_IDS.map(id=>[SHOULDER_NAMES[id],paletteColor(id)])];
  if ($('removed').checked && available(current.models?.[removedKey()])) items.push([removedName(),'#ffa326']);
  for (const [name,color] of items) {
    const item = document.createElement('span'), swatch = document.createElement('i'), resolved = new THREE.Color();
    swatch.className = 'swatch'; setColor(resolved,color); swatch.style.backgroundColor = `#${resolved.getHexString()}`;
    item.append(swatch,document.createTextNode(name)); $('legend').append(item);
  }
}
async function render(doFit = false) {
  const ticket = ++serial, selected = current, mode = $('display-mode').value;
  const colorMode = mode === 'color', trial = mode === 'candidate', accepted = selected.platform_report?.candidate_accepted;
  updateRemovedControl();
  const overlayKey = removedKey(), leftKey = colorMode ? 'input' : 'before', rightKey = trial ? 'candidate' : colorMode ? 'refined' : 'after';
  $('platform-policy').dataset.state = trial && !available(selected.models?.candidate) ? 'missing' : accepted === true ? 'accepted' : accepted === false ? 'rejected' : 'unavailable';
  $('platform-policy').style.borderLeftColor = accepted === false ? '#ffbf69' : '';
  $('platform-policy').textContent = trial && !available(selected.models?.candidate) ? '本例没有平台试验候选产物，右侧不可用；不会以正式结果或基线替代。' : accepted === false ? trial ? '未采用的试验结果；正式结果请切换最终分割。右侧仅显示实际生成的平台候选。' : '本轮平台候选未采用。正式产物与阶段输出按其真实文件显示，不据此推断与基线完全一致。' : accepted === true ? trial ? '该平台候选已采用；当前显示真实候选，正式最终产物请切换最终分割。' : '本轮平台候选已采用，具体删除、重标和细分状态分别记录在下方。' : '平台候选采用状态不可用；不能据此判断是否修改或是否保留基线。';
  $('fatal').hidden = true; $('status').textContent = '正在载入真实模型…';
  $('left-label').textContent = modelName(leftKey); $('right-label').textContent = modelName(rightKey);
  $('mode-note').textContent = trial ? `左侧为 ${versionName('before')} 真实最终分割，右侧为本轮实际平台候选。下方与基线的比较仍指正式产物，不代表候选比较。` : colorMode ? '同次运行的平台阶段原色对照：左侧为实际平台输入，右侧为实际平台输出；它不是两个版本的最终原色恢复。' : `最终分割模式：左侧读取 ${versionName('before')} 的真实最终牙体与标签，右侧读取 ${versionName('after')} 实际采用的最终产物。`;
  const pair = [[left,leftKey],[right,rightKey]];
  for (const [panel,key] of pair) clear(panel,available(selected.models?.[key]) ? '模型加载中…' : `本例无${modelName(key)}产物`);
  makeLegend();
  const results = await Promise.allSettled(pair.map(async ([,key]) => available(selected.models?.[key]) ? readModel(selected.models[key]) : null));
  if (ticket !== serial) return;
  let loaded = 0; const errors = [];
  for (let i = 0; i < pair.length; i++) {
    const [panel,key] = pair[i], result = results[i];
    if (result.status === 'rejected') { clear(panel,'模型读取失败，未显示替代结果'); errors.push(result.reason); continue; }
    if (!result.value) continue;
    try { addModel(panel,result.value,key,mode); loaded++; }
    catch (error) { clear(panel,'模型标签无效，未显示替代结果'); errors.push(error); }
  }
  if ($('removed').checked && available(selected.models?.[overlayKey]) && right.host.dataset.modelKey) {
    try {
      const removed = await readModel(selected.models[overlayKey]);
      if (ticket !== serial) return;
      addModel(right,removed,overlayKey,mode,true);
    } catch (error) { errors.push(error); }
  }
  if (ticket !== serial) return;
  if (doFit) fit(); else for (const panel of panels) draw(panel);
  if (errors.length) showError(errors.map(error => error.message || String(error)).join('；'));
  $('status').textContent = `${loaded === 2 && !errors.length ? '已加载' : '部分结果不可用'} · ${modeNames[mode]} · ${loaded}/2 幅模型`;
}
function duplicatesOf(item) {
  return Array.isArray(item.duplicate_ids) ? item.duplicate_ids.map(value => typeof value === 'string' ? value : value?.id).filter(Boolean).filter(id => id !== item.id) : [];
}
function displayText(value) {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : value == null ? '' : JSON.stringify(value);
}
function appendLink(parent,url,label) {
  if (typeof url !== 'string' || !url) return;
  const resolved = new URL(url,location.href);
  if (!['http:','https:'].includes(resolved.protocol)) return;
  const link = document.createElement('a'); link.href = resolved.href; link.textContent = label;
  link.setAttribute('download',''); parent.append(link);
}
function statusRow(parent,key,label,value,kind = 'modified',unavailable = '不可用（未提供）') {
  const row = document.createElement('div'), term = document.createElement('dt'), definition = document.createElement('dd');
  term.textContent = label;
  definition.dataset.field = key;
  definition.dataset.state = typeof value === 'boolean' ? String(value) : 'unavailable';
  const captions = {equal:['不同','一致'],modified:['未修改','已修改'],changed:['未变化','已变化'],removed:['无裁除','有裁除'],tessellated:['未细分','已细分']};
  definition.textContent = typeof value !== 'boolean' ? unavailable : (captions[kind] || captions.modified)[Number(value)];
  row.append(term,definition); parent.append(row);
}
function quantityRow(parent,key,label,value) {
  const row = document.createElement('div'), term = document.createElement('dt'), definition = document.createElement('dd');
  term.textContent = label; definition.dataset.field = key;
  const known = typeof value === 'number' && Number.isFinite(value) && value >= 0;
  definition.dataset.state = known ? 'available' : 'unavailable';
  definition.textContent = known ? `${value.toFixed(3)} mm²` : '不可用（未提供）';
  row.append(term,definition); parent.append(row);
}
function updateComparisons() {
  const report = current.platform_report;
  $('stage-status').replaceChildren(); $('final-comparison').replaceChildren();
  statusRow($('stage-status'),'geometry_modified','平台实体裁除',report?.geometry_modified,'removed');
  statusRow($('stage-status'),'labels_modified','平台标签调整',report?.labels_modified);
  statusRow($('stage-status'),'tessellation_modified','无损细分',report?.tessellation_modified,'tessellated');
  quantityRow($('stage-status'),'removed_area_mm2','实际删除面积',report?.removed_area_mm2);
  $('final-comparison-details').hidden = !current.final_comparison;
  $('final-comparison-title').textContent = `${versionName('before')} → ${versionName('after')} 正式产物比较`;
  if (!current.final_comparison) return;
  const complete = available(current.models?.before) && available(current.models?.after), comparison = complete ? current.final_comparison : {};
  const noMapping = comparison.labels_directly_comparable === false || comparison.topology_equal === false;
  statusRow($('final-comparison'),'final_mesh_representation_changed','网格表示 / 细分',comparison.mesh_representation_changed,'changed',complete ? '不可用（未提供）' : '不可用（最终产物不齐全）');
  statusRow($('final-comparison'),'final_labels_modified','最终标签',noMapping ? null : comparison.labels_modified,'modified',!complete ? '不可用（最终产物不齐全）' : noMapping ? '不可直接比较（网格表示或索引不同）' : '不可用（未提供）');
}
function updateMetadata() {
  $('title').textContent = current.name || current.id;
  $('case-meta').textContent = `${current.prep_fdi} 牙位 · ${displayText(current.cohort_name || current.cohort) || '未标明来源组'} · 执行状态：${displayText(current.execution_status) || '清单未提供'}`;
  const duplicates = duplicatesOf(current);
  $('duplicates').hidden = !duplicates.length;
  $('duplicates').textContent = `相同输入扫描：${duplicates.join('、')}。各记录保留各自的处理结果，不计为独立扫描。`;
  const models = current.models || {};
  for (const option of $('display-mode').options) option.disabled = option.value === 'candidate' ? !available(models.candidate) : option.value === 'color' ? !available(models.input) && !available(models.refined) : !available(models.before) && !available(models.after);
  // 缺产物的深链保留原模式与缺失说明，绝不切换到替代结果。
  updateRemovedControl(); updateComparisons();
  $('notes').replaceChildren();
  const notes = Array.isArray(current.notes) ? current.notes : current.notes ? [current.notes] : [];
  if (current.execution_reason) { const li = document.createElement('li'); li.textContent = `执行说明：${displayText(current.execution_reason)}`; $('notes').append(li); }
  for (const note of notes) { const li = document.createElement('li'); li.textContent = displayText(note); $('notes').append(li); }
  $('platform-report').textContent = current.platform_report == null ? '本例未提供平台处理记录，采用与修改状态不可用。' : typeof current.platform_report === 'string' ? current.platform_report : JSON.stringify(current.platform_report,null,2);
  $('downloads').replaceChildren();
  const downloads = current.downloads || {};
  for (const [key,label,model] of [['before_ply_url',`${versionName('before')} 最终 PLY`,'before'],['before_labels_url',`${versionName('before')} 最终标签`,'before'],['after_ply_url',`${versionName('after')} 最终 PLY`,'after'],['after_labels_url',`${versionName('after')} 最终标签`,'after'],['input_ply_url','平台输入原色 PLY','input'],['refined_ply_url','平台输出原色 PLY','refined'],['removed_ply_url','平台实际删除片 PLY','removed'],['candidate_ply_url','平台试验候选 PLY','candidate'],['candidate_labels_url','平台试验候选标签 JSON','candidate']]) {
    if (available(models[model])) appendLink($('downloads'),downloads[key],label);
  }
  appendLink($('downloads'),downloads.platform_report_json_url,'平台处理记录 JSON');
  appendLink($('downloads'),downloads.platform_fields_npz_url,'平台输入诊断数组 NPZ');
  for (const [key,label] of [['input','平台输入'],['refined','平台输出'],['removed','平台实际删除片'],['candidate','平台试验候选'],['after','最终产物']]) {
    if (available(models[key])) appendLink($('downloads'),downloads[key+'_source_provenance_npz_url'],label+'源面追溯 NPZ');
  }
  if (!$('downloads').children.length) $('downloads').textContent = '本例没有可下载的产物链接。';
}
function applyFilter() {
  let count = 0;
  for (const button of $('cases').querySelectorAll('[data-case]')) {
    button.hidden = filter !== 'all' && button.dataset.fdi !== filter;
    if (!button.hidden) count++;
    button.setAttribute('aria-pressed',String(button.dataset.case === current?.id));
  }
  for (const button of $('filters').querySelectorAll('[data-fdi]')) button.setAttribute('aria-pressed',String(button.dataset.fdi === filter));
  $('case-count').textContent = `${count} 条记录`;
}
function choose(id) {
  const selected = data.cases.find(item => item.id === id);
  if (!selected) { showError(`清单中没有样本 ${id}`); return; }
  current = selected;
  if (filter !== 'all' && String(current.prep_fdi) !== filter) filter = 'all';
  updateMetadata(); applyFilter(); updateUrl(); render(true).catch(showError);
}
function countUnique() {
  const parents = new Map(data.cases.map(item => [item.id,item.id]));
  const find = id => { while (parents.get(id) !== id) id = parents.get(id); return id; };
  for (const item of data.cases) for (const duplicate of duplicatesOf(item)) if (parents.has(duplicate)) parents.set(find(duplicate),find(item.id));
  return new Set(data.cases.map(item => find(item.id))).size;
}
function firstCount(object,keys,fallback) {
  for (const key of keys) if (Number.isInteger(object?.[key]) && object[key] >= 0) return object[key];
  return fallback;
}
function hashId() { try { return decodeURIComponent(location.hash.slice(1)); } catch { return location.hash.slice(1); } }
async function start() {
  const response = await fetch('./platform_refinement_manifest.json',{cache:'no-store'});
  if (!response.ok) throw Error(`无法读取平台对照清单（HTTP ${response.status}）`);
  data = await response.json();
  $('comparison-subtitle').textContent = `最终结果 ${versionName('before')} → ${versionName('after')} · 平台原色与试验候选另有独立模式`;
  if (typeof data.review_title === 'string' && data.review_title.trim()) {
    document.title = data.review_title.trim(); $('review-title').textContent = document.title;
  }
  if (data.review_note) { $('review-note').textContent = displayText(data.review_note); $('review-note').hidden = false; }
  if (data.visual_review_html_url) {
    const url = new URL(data.visual_review_html_url,location.href);
    if (['http:','https:'].includes(url.protocol)) { $('visual-review-link').href = url.href; $('visual-review-link').hidden = false; }
  }
  if (data.methodology_url) { const url = new URL(data.methodology_url,location.href); if (['http:','https:'].includes(url.protocol)) { $('methodology-link').href = url.href; $('methodology-link').hidden = false; } }
  if (!Array.isArray(data.cases) || !data.cases.length) throw Error('平台对照清单没有可展示的记录');
  if (new Set(data.cases.map(item => item.id)).size !== data.cases.length || data.cases.some(item => typeof item.id !== 'string' || !item.id)) throw Error('平台对照清单含重复或无效记录编号');
  const records = firstCount(data.summary,['records','record_count','total_records'],data.cases.length);
  const unique = firstCount(data.summary,['unique_post_inputs','unique_scans','unique_scan_count'],countUnique());
  const incisors = data.cases.filter(item => Number(item.prep_fdi) === 11).length, molars = data.cases.filter(item => Number(item.prep_fdi) === 46).length;
  $('summary').textContent = `${records} 条记录 · ${unique} 个独立输入扫描 · 11 切牙 ${incisors} 条 / 46 磨牙 ${molars} 条。相同扫描的不同运行保留为独立对照记录。`;
  if (typeof data.report_url === 'string' && data.report_url) {
    const url = new URL(data.report_url,location.href);
    if (['http:','https:'].includes(url.protocol)) { $('report-link').href = url.href; $('report-link').hidden = false; }
  }
  for (const item of data.cases) {
    const button = document.createElement('button'), name = document.createElement('span'), state = document.createElement('small');
    button.className = 'case'; button.dataset.case = item.id; button.dataset.fdi = String(item.prep_fdi);
    name.textContent = item.name || item.id;
    const complete = available(item.models?.before) && available(item.models?.after);
    state.textContent = `${item.prep_fdi} · ${complete ? `${versionName('before')} / ${versionName('after')} 最终可对照` : '最终产物不齐全'}${duplicatesOf(item).length ? ' · 重复输入' : ''}`;
    if (!complete) state.className = 'unavailable';
    button.append(name,state);
    button.onclick = event => {
      choose(item.id);
      // 仅窄屏下的实际点击/键盘选择移动页面；初始化与 hash 导航保留滚动位置。
      if (event.isTrusted && matchMedia('(max-width:1000px)').matches) {
        $('title').scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
      }
    };
    $('cases').append(button);
  }
  const excluded = Array.isArray(data.excluded) ? data.excluded : [];
  $('excluded-details').hidden = !excluded.length; $('excluded-count').textContent = `（${excluded.length}）`;
  for (const item of excluded) {
    const li = document.createElement('li');
    li.textContent = typeof item === 'string' ? item : `${item.name || item.id || '未命名记录'}：${displayText(item.reason || item.notes || item.execution_status) || '未生成本轮可对照产物'}`;
    $('excluded').append(li);
  }
  for (const button of $('filters').querySelectorAll('[data-fdi]')) button.onclick = () => {
    filter = button.dataset.fdi; applyFilter();
    if (filter !== 'all' && String(current.prep_fdi) !== filter) {
      const first = data.cases.find(item => String(item.prep_fdi) === filter);
      if (first) choose(first.id);
    }
    updateUrl();
  };
  for (const button of $('views').querySelectorAll('[data-view]')) button.onclick = () => { view = button.dataset.view; fit(); updateUrl(); };
  $('fit').onclick = fit;
  for (const id of ['display-mode','removed','wire']) $(id).onchange = () => { updateUrl(); render(false).catch(showError); };
  window.addEventListener('hashchange',() => choose(hashId()));
  const initial = hashId() || data.cases.find(item => filter === 'all' || String(item.prep_fdi) === filter)?.id || data.cases[0].id;
  choose(initial);
}
start().catch(error => { $('status').textContent = '清单不可用'; showError(error); });
