import { DISPLAY_PALETTE, SHOULDER_IDS, SHOULDER_NAMES } from './anatomical_palette.js';
import * as THREE from 'three';
import {PanelRenderer,ModelCache} from './render_runtime.js';
import { OrbitControls } from './vendor/OrbitControls.js';

const $=id=>document.getElementById(id);
const data=await fetch('./manifest.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('无法读取病例目录');return r.json()});
const palette=DISPLAY_PALETTE,cache=new ModelCache(),panels=[];
let current=0,activeLabel=0,busy=false,loadSerial=0,bounds=null;
const markKey='dental-0905-review-points-v1';
let marks=[];
try{const saved=JSON.parse(localStorage.getItem(markKey)||'[]');if(Array.isArray(saved))marks=saved.filter(m=>typeof m.caseId==='string'&&Array.isArray(m.point)&&m.point.length===3&&m.point.every(Number.isFinite));}catch(e){$('mark-status').textContent='本机标记读取失败；原保存内容未改动';}
const colorMemo=new Map();
function color(hex){if(!colorMemo.has(hex))colorMemo.set(hex,new THREE.Color(hex));return colorMemo.get(hex)}
window.addEventListener('error',event=>{$('fatal').textContent=event.message});
window.addEventListener('unhandledrejection',event=>{$('fatal').textContent=String(event.reason)});

function panel(id){
 const host=$(id),scene=new THREE.Scene();scene.background=new THREE.Color('#19222d');
 const camera=new THREE.PerspectiveCamera(36,1,.05,1000);camera.up.set(0,0,1);camera.position.set(0,-30,9);
 const renderer=new PanelRenderer();renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;host.appendChild(renderer.domElement);
 const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=false;controls.minDistance=.3;controls.maxDistance=250;
 const group=new THREE.Group();scene.add(group);scene.add(new THREE.AmbientLight(0xffffff,1.25));
 const light=new THREE.DirectionalLight(0xffffff,2);camera.add(light);light.position.set(2,1,3);scene.add(camera);
 const back=new THREE.DirectionalLight(0xa8c7f0,.8);back.position.set(-15,-8,8);scene.add(back);
 const p={host,scene,camera,renderer,controls,group};panels.push(p);
 const resize=()=>{const w=host.clientWidth,h=host.clientHeight;if(!w||!h)return;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();draw(p)};
 new ResizeObserver(resize).observe(host);
 controls.addEventListener('change',()=>{draw(p);if(busy)return;busy=true;for(const other of panels){if(other===p)continue;other.camera.position.copy(camera.position);other.camera.quaternion.copy(camera.quaternion);other.camera.up.copy(camera.up);other.controls.target.copy(controls.target);other.controls.update();draw(other)}busy=false});
 let down=null;
 renderer.domElement.addEventListener('pointerdown',e=>{down={x:e.clientX,y:e.clientY,mark:e.altKey};});
 renderer.domElement.addEventListener('pointerup',e=>{
  if(!down?.mark||Math.hypot(e.clientX-down.x,e.clientY-down.y)>4)return;
  down=null;
  const rect=renderer.domElement.getBoundingClientRect(),ray=new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1),camera);
  const hit=ray.intersectObjects(group.children.filter(m=>m.userData.pickable),false).find(h=>h.face&&h.face.normal.dot(ray.ray.direction)<0);
  if(!hit){$('mark-status').textContent='未点中朝向镜头的表面；破洞请标记洞边。';return;}
  const c=data.cases[current];
  marks.push({caseId:c.id,kind:$('mark-kind').value,point:hit.point.toArray(),coordinateSystem:'viewer_mm',frame:c.display_frame,
              inputSha256:c.comparison.original_target_sha256,version:data.revision,panel:id,displayMode:$('mode').value,comparison:$('compare-source').value,time:new Date().toISOString()});
  saveMarks();renderMarks();panels.forEach(draw);
 });
 return p;
}
function draw(p){p.renderer.render(p.scene,p.camera)}
const left=panel('left'),right=panel('right');
async function readMesh(info){
 if(cache.has(info.url))return cache.get(info.url);
 const response=await fetch(info.url);if(!response.ok)throw Error('模型载入失败: '+info.url);
 const raw=await response.arrayBuffer(),head=new DataView(raw),nv=head.getUint32(0,true),nf=head.getUint32(4,true);
 if(raw.byteLength!==8+nv*40+nf*12)throw Error('模型长度校验失败');
 const a=new Float32Array(raw,8,nv*10),index=new Uint32Array(raw,8+nv*40,nf*3);
 const pos=new Float32Array(nv*3),norm=new Float32Array(nv*3),rgb=new Float32Array(nv*3),labels=new Uint16Array(nv);
 for(let i=0;i<nv;i++){for(let j=0;j<3;j++){pos[3*i+j]=a[10*i+j];norm[3*i+j]=a[10*i+3+j];rgb[3*i+j]=a[10*i+6+j]}labels[i]=a[10*i+9]}
 const result={pos,norm,rgb,labels,index,nv,nf};cache.set(info.url,result);return result;
}
function geometry(m,mode,filter=0,context=true){
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(m.pos,3));g.setAttribute('normal',new THREE.BufferAttribute(m.norm,3));
 const cols=new Float32Array(m.nv*3);
 for(let i=0;i<m.nv;i++){
  let c;
  if(mode==='grey')c=color('#9aa6b4');
  else if(mode==='instance')c=m.labels[i]===0?color('#737e89'):new THREE.Color().setHSL((m.labels[i]*.618)%1,.58,.56);
  else if(mode==='label')c=color(palette[m.labels[i]]||palette[0]);
  else c=new THREE.Color(m.rgb[3*i],m.rgb[3*i+1],m.rgb[3*i+2]).convertSRGBToLinear();
  if(filter&&context){const l=m.labels[i],selected=filter===100?l>=6:filter===-1?l>=1&&l<=5:l===filter;if(!selected)c=color('#46525f')}
  c.toArray(cols,i*3);
 }
 g.setAttribute('color',new THREE.BufferAttribute(cols,3));
 if(filter&&!context){const kept=[];for(let j=0;j<m.index.length;j+=3){let count=0;for(let k=0;k<3;k++){const l=m.labels[m.index[j+k]];if(filter===100?l>=6:filter===-1?l>=1&&l<=5:l===filter)count++}if(count>=2)kept.push(m.index[j],m.index[j+1],m.index[j+2])}g.setIndex(kept)}else g.setIndex(new THREE.BufferAttribute(m.index,1));
 return g;
}
function clear(p){while(p.group.children.length){const m=p.group.children[0];p.group.remove(m);m.geometry.dispose();m.material.dispose()}}
function add(p,m,mode,filter=0,opacity=1,offset=false){
 const g=geometry(m,mode,filter,!offset);const mat=new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,roughness:.86,metalness:0,wireframe:$('wire').checked,transparent:opacity<1,opacity,depthWrite:opacity>=1,polygonOffset:offset,polygonOffsetFactor:-2,polygonOffsetUnits:-2});
 if(mode==='label'&&$('back-grey').checked){
  mat.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\nif (!gl_FrontFacing) diffuseColor.rgb = vec3(0.18, 0.22, 0.27);');};
  mat.customProgramCacheKey=()=> 'neutral-interior-v1';
 }
 const mesh=new THREE.Mesh(g,mat);mesh.userData.pickable=true;if(offset)mesh.renderOrder=2;p.group.add(mesh);return mesh;
}
function openEdges(p,m){
 if(!$('holes').checked)return;
 const ids=new Map(),weld=new Uint32Array(m.nv),edges=new Map();
 for(let i=0;i<m.nv;i++){const key=[0,1,2].map(k=>Math.round(m.pos[3*i+k]*1e5)).join(',');if(!ids.has(key))ids.set(key,i);weld[i]=ids.get(key)}
 for(let i=0;i<m.index.length;i+=3){const t=[weld[m.index[i]],weld[m.index[i+1]],weld[m.index[i+2]]];for(const [a,b]of[[t[0],t[1]],[t[1],t[2]],[t[2],t[0]]]){const key=Math.min(a,b)+','+Math.max(a,b);if(edges.has(key))edges.get(key).count++;else edges.set(key,{a,b,count:1})}}
 const points=[];for(const e of edges.values())if(e.count===1)for(const i of[e.a,e.b])points.push(m.pos[3*i],m.pos[3*i+1],m.pos[3*i+2]);
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(points,3));const line=new THREE.LineSegments(g,new THREE.LineBasicMaterial({color:0xff58dd,depthTest:false,transparent:true,opacity:.9}));line.renderOrder=3;p.group.add(line);
}
function saveMarks(){try{localStorage.setItem(markKey,JSON.stringify(marks));}catch(e){$('mark-status').textContent='本机保存失败，请导出标记文件。';}}
function renderMarks(){
 const currentCase=data.cases[current];
 const selected=marks.filter(m=>m.caseId===currentCase.id&&(!currentCase.target_corrected||m.inputSha256===currentCase.comparison.original_target_sha256));
 for(const p of panels){
  for(const m of [...p.group.children])if(m.userData.reviewMarker){p.group.remove(m);m.geometry.dispose();m.material.dispose();}
  if(selected.length){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(selected.flatMap(m=>m.point),3));const m=new THREE.Points(g,new THREE.PointsMaterial({color:0xffef8c,size:7,sizeAttenuation:false,depthTest:false}));m.userData.reviewMarker=true;m.renderOrder=5;p.group.add(m);}
 }
 $('mark-status').textContent=`本例 ${selected.length} 个标记 · 全部 ${marks.length} 个（仅保存在本机）`;
}
function view(name='front'){
 if(!bounds)return;
 const box=new THREE.Box3(new THREE.Vector3(...bounds[0]),new THREE.Vector3(...bounds[1]));const center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
 const dirs={front:[0,-1,.15],back:[0,1,.15],sideA:[1,0,.15],sideB:[-1,0,.15],top:[0,0,1],bottom:[0,0,-1]};const dir=new THREE.Vector3(...(dirs[name]||dirs.front)).normalize();
 const narrow=Math.max(.48,right.camera.aspect),d=Math.max(size.z,size.x/narrow,size.y/narrow)*1.85;
 busy=true;for(const p of panels){p.camera.up.set(0,name==='top'?1:name==='bottom'?-1:0,name==='top'||name==='bottom'?0:1);p.camera.position.copy(center).addScaledVector(dir,Math.max(d,8));p.controls.target.copy(center);p.controls.update();draw(p)}busy=false;
}
function legend(){
 $('legend').replaceChildren();
 const entries=[[0,'全部分区',null],[1,data.cases[current].fdi===46?'咬合面':'切端',palette[1]],[2,'唇/颊面*',palette[2]],[3,'舌面*',palette[3]],[4,'近中面*',palette[4]],[5,'远中面*',palette[5]],[100,'全部肩台',null],...SHOULDER_IDS.map(id=>[id,SHOULDER_NAMES[id],palette[id]])];
 for(const [id,name,hex]of entries){const b=document.createElement('button');b.type='button';b.setAttribute('aria-pressed',String(activeLabel===id));if(hex){const s=document.createElement('span');s.className='swatch';s.style.background=hex;b.append(s)}b.append(document.createTextNode(name));b.onclick=()=>{activeLabel=activeLabel===id?0:id;if(['original','target','instances','grey'].includes($('mode').value))$('mode').value='segmented';legend();show(false)};$('legend').append(b)}
}
function info(){
 const c=data.cases[current],q=c.geometry,t=c.comparison;
 $('case-title').textContent=c.case+' · '+(c.fdi===46?'磨牙':'前牙');$('case-subtitle').textContent=c.archive+(c.extraction_recovered?' · 提取恢复补测':'');
 for(const option of $('compare-source').options){option.disabled=(c.invalid_comparison_kinds||[]).includes(option.value)||(option.value==='selection'&&!c.selection_context);}
 if($('compare-source').selectedOptions[0].disabled)$('compare-source').value=c.default_comparison||'target';
 const revised=!!c.scan_supported;
 $('metrics').innerHTML=`<div class="metric">当前复核状态<strong>${c.review_status}</strong>${c.review_detail}</div><div class="metric">${c.fdi===46?'咬合面':'切端'}面积 · ${revised?(t.comparison_versions||'R3 → R4'):'R3 保留'}<strong>${revised?t.before_crown_area_mm2.toFixed(2)+' → ':''}${q.surfaces[0].area_mm2.toFixed(2)}</strong>mm²，面积变化不代表准确率</div><div class="metric">${revised?'估计补片面积':'本轮模型'}<strong>${revised?c.estimated_area_mm2.toFixed(3)+' mm²':'未改动'}</strong>${revised?'单独保存，未加入测量模型':'沿用上一轮结果'}</div><div class="metric">${revised?'含估计补片的审阅模型':'当前模型'}<strong>${t.after_topology.boundary_components} 个开放边界块</strong>含正常颈部开口</div>`;
 if(c.target_corrected)$('metrics').innerHTML=`<div class="metric">目标选择<strong>已按截图纠正</strong>实例 1 · 原实例 2 误选</div><div class="metric">原始牙体保留<strong>100%</strong>4,033 顶点 / 7,827 原面</div><div class="metric">估计补片<strong>未使用</strong>当前目标没有独立孔洞</div><div class="metric">分割状态<strong>待复核</strong>肩台边缘仍有锯齿</div>`;
 $('verdict').textContent=c.verdict||'逐例评价';$('notes').replaceChildren();for(const note of c.notes){const li=document.createElement('li');li.textContent=note;$('notes').append(li)}
 $('region-table').replaceChildren();for(const s of q.surfaces){const tr=document.createElement('tr');for(const v of[s.name,s.area_mm2.toFixed(2),(s.area_fraction*100).toFixed(2)+'%',s.components.count]){const td=document.createElement('td');td.textContent=v;tr.append(td)}$('region-table').append(tr)}
 document.querySelectorAll('.case').forEach((b,i)=>b.setAttribute('aria-pressed',String(i===current)));
}
async function show(fit=true){
 const serial=++loadSerial,c=data.cases[current],mode=$('mode').value;$('status').textContent='正在载入模型…';$('fatal').textContent='';
 try{
 const kind=mode==='original'?'original':mode==='instances'?'instances':mode==='target'?'target':'segmented';
 const comparisonKind=$('compare-source').value,previousCompare=comparisonKind==='previous',revision1Compare=comparisonKind==='revision1',revision2Compare=comparisonKind==='revision2',revision3Compare=comparisonKind==='revision3',revision4Compare=comparisonKind==='revision4',contextCompare=comparisonKind==='context',selectionCompare=comparisonKind==='selection';
 const beforeInfo=(selectionCompare?c.selection_context:contextCompare?(c.source_context||c.original):revision4Compare?(!$('include-estimates').checked&&c.revision4_scan_supported?c.revision4_scan_supported:c.revision4):previousCompare?c.previous:revision1Compare?c.revision1:revision2Compare?c.revision2:revision3Compare?c.revision3:c.baseline)||c.segmented;
 $('include-estimates').disabled=!c.scan_supported||!(c.estimated_area_mm2>0);$('highlight-estimates').disabled=!c.estimated_patch||!$('include-estimates').checked;
 const baseInfo=kind==='segmented'&&c.scan_supported&&!$('include-estimates').checked?c.scan_supported:c[kind];
 const [base,target,before]=await Promise.all([readMesh(baseInfo),readMesh(c.target),readMesh(beforeInfo)]);if(serial!==loadSerial)return;
 clear(left);clear(right);
 const sourceCompare=$('compare-source').value==='target';
 $('highlight-restored').disabled=!c.restored_margin;
 if(contextCompare||selectionCompare)add(left,before,'rgb');
 else if(sourceCompare)add(left,target,'rgb');
 else if(mode==='shoulder'){add(left,target,'grey',0,Number($('opacity').value)/100);add(left,before,'label',activeLabel||100,1,true)}
 else add(left,before,mode==='grey'?'grey':'label',activeLabel||(mode==='surface'?-1:0));
 $('left-label').textContent=selectionCompare?'选牙位置 · 绿：正确目标 / 红：旧误选':contextCompare?'原扫描邻域 · 包含牙龈':revision4Compare?'上一轮 R4 · 同角度':sourceCompare?(c.target_corrected?'正确单牙 · 原始颜色':'原始提取单牙 · 同角度'):previousCompare?'旧分支历史结果 · 74c7a63':revision1Compare?'R1 · 补洞与平滑':revision2Compare?'上一轮 R2':revision3Compare?'上一轮 R3':'新分支原版 · '+data.commit;
 if(mode==='shoulder'){add(right,target,'grey',0,Number($('opacity').value)/100);add(right,base,'label',activeLabel||100,1,true)}
 else add(right,base,kind==='instances'?'instance':kind==='segmented'?(mode==='grey'?'grey':'label'):'rgb',kind==='segmented'?(activeLabel||(mode==='surface'?-1:0)):0);
 bounds=selectionCompare?c.selection_context.bounds:c[kind].bounds;
 if(kind==='segmented'&&c.estimated_patch&&$('include-estimates').checked&&$('highlight-estimates').checked){
  const patch=await readMesh(c.estimated_patch);if(serial!==loadSerial)return;
  add(right,patch,'rgb',0,1,true);
 }
 if(kind==='segmented'&&c.restored_margin&&$('highlight-restored').checked){
  const restored=await readMesh(c.restored_margin);if(serial!==loadSerial)return;add(right,restored,'rgb',0,1,true);
 }
 $('right-label').textContent=(kind==='segmented'?c.result_version+' · ':'')+$('mode').selectedOptions[0].textContent+(kind==='segmented'&&c.scan_supported&&c.estimated_area_mm2>0?($('include-estimates').checked?'（含估计补片）':'（仅扫描表面）'):'');
 openEdges(left,sourceCompare?target:before);openEdges(right,base);
 $('viewports').classList.toggle('single',!$('compare').checked);if(fit)view(new URLSearchParams(location.search).get('view')||'front');renderMarks();panels.forEach(draw);
 $('status').textContent=`${c.case} · ${base.nv.toLocaleString()} 顶点 / ${base.nf.toLocaleString()} 面片`;
 // Visible state and a local event allow reproducible UI checks without external telemetry.
 document.body.dataset.loaded=c.id;document.body.dataset.mode=mode;
 }catch(e){$('status').textContent='载入失败';$('fatal').textContent=String(e)}
}
for(let i=0;i<data.cases.length;i++){
 const c=data.cases[i],b=document.createElement('button');b.className='case';b.type='button';b.setAttribute('aria-label',c.id);const span=document.createElement('span');span.append(document.createTextNode(c.case));const small=document.createElement('small');small.textContent=c.id.startsWith('pack1')?'第一包 · 牙医备牙后':'第二包 · 牙医备牙后2';span.append(small);const dot=document.createElement('span');dot.className='dot '+(c.quality||'');b.append(span,dot);b.onclick=()=>{current=i;activeLabel=0;history.replaceState(null,'','#'+c.id);info();legend();show()};$('cases').append(b);
}
const asideNote=document.createElement('p');asideNote.className='aside-note';asideNote.textContent='第一包 11_3 已纠正选牙。其余八例保留；46_3 肩台不连续仍待处理。';$('cases').append(asideNote);
const requested=location.hash.slice(1);if(requested)current=Math.max(0,data.cases.findIndex(c=>c.id===requested));
$('mode').onchange=()=>{activeLabel=0;legend();show()};$('compare').onchange=()=>{$('viewports').classList.toggle('single',!$('compare').checked);setTimeout(()=>view('front'),30)};
$('wire').onchange=()=>show(false);$('opacity').oninput=()=>{$('opacity-val').textContent=$('opacity').value+'%';if($('mode').value==='shoulder')show(false)};
$('holes').onchange=()=>show(false);$('compare-source').onchange=()=>show(true);
$('back-grey').onchange=()=>show(false);
$('highlight-restored').onchange=()=>show(false);
$('include-estimates').onchange=()=>show(false);$('highlight-estimates').onchange=()=>show(false);
$('undo-mark').onclick=()=>{const i=marks.findLastIndex(m=>m.caseId===data.cases[current].id);if(i>=0){marks.splice(i,1);saveMarks();renderMarks();panels.forEach(draw);}};
$('export-marks').onclick=()=>{const blob=new Blob([JSON.stringify({schema:'dental-review-points-v1',units:'mm',marks},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='0905-review-points.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
window.addEventListener('hashchange',()=>{const i=data.cases.findIndex(c=>c.id===location.hash.slice(1));if(i>=0){current=i;activeLabel=0;info();legend();show()}});
$('fit').onclick=()=>view('front');$('views').querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>view(b.dataset.view));
$('method').textContent=`用户指定基线 ${data.branch}（${data.commit}）。修复分支 ${data.optimization_branch||'未指定'}。${data.method}`;
info();legend();await show();
