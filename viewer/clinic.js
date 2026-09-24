import {PanelRenderer} from './render_runtime.js';
import * as THREE from 'three';
import {OrbitControls} from './vendor/OrbitControls.js';

const $=id=>document.getElementById(id);
window.addEventListener('error',e=>{$('fatal').textContent=e.message});
window.addEventListener('unhandledrejection',e=>{$('fatal').textContent=String(e.reason&&e.reason.message||e.reason)});

const stages=await fetch('./stages_manifest.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('无法读取阶段清单');return r.json()});
const clinic=await fetch('./clinic_manifest.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('无法读取临床对照清单');return r.json()});
const byId=new Map(stages.cases.map(c=>[c.id,c]));
const cases=clinic.cases.filter(c=>byId.has(c.id));
let current=0,serial=0,sync=false,measureMode='line';
const picks=new Map(),sectionStates=[];

function stage(id){return byId.get(cases[current].id).stages.find(s=>s.id===id)}
function model(key){return byId.get(cases[current].id).models[key]}

const cache=new Map();
async function readInfo(info){
 if(cache.has(info.url))return cache.get(info.url);
 const promise=(async()=>{
  const res=await fetch(info.url);if(!res.ok)throw Error('无法读取模型 '+info.url);
  const raw=await res.arrayBuffer(),h=new DataView(raw),nv=h.getUint32(0,true),nf=h.getUint32(4,true);
  if(raw.byteLength!==8+nv*40+nf*12)throw Error('模型不完整');
  const a=new Float32Array(raw,8,nv*10),f=new Uint32Array(raw,8+nv*40,nf*3);
  const pos=new Float32Array(nv*3),norm=new Float32Array(nv*3),rgb=new Float32Array(nv*3),labels=new Uint16Array(nv);
  for(let i=0;i<nv;i++)for(let j=0;j<3;j++){pos[i*3+j]=a[i*10+j];norm[i*3+j]=a[i*10+3+j];rgb[i*3+j]=a[i*10+6+j]}
  for(let i=0;i<nv;i++)labels[i]=a[i*10+9];
  return {pos,norm,rgb,f,nv,labels,mode:info.mode};
 })();
 cache.set(info.url,promise);return promise;
}

const panels=[];
function panel(id){
 const host=$(id),scene=new THREE.Scene();scene.background=new THREE.Color('#19222d');
 const camera=new THREE.PerspectiveCamera(36,1,.03,1000);camera.up.set(0,0,1);camera.position.set(0,-35,5);
 const renderer=new PanelRenderer();renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;host.appendChild(renderer.domElement);
 const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=false;controls.minDistance=.1;controls.maxDistance=400;
 const group=new THREE.Group();scene.add(group,new THREE.AmbientLight(0xffffff,1.5));
 const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(2,2,4);camera.add(light);scene.add(camera);
 const p={host,scene,camera,renderer,controls,group};panels.push(p);
 new ResizeObserver(()=>{renderer.setSize(host.clientWidth,host.clientHeight,false);camera.aspect=host.clientWidth/Math.max(host.clientHeight,1);camera.updateProjectionMatrix();renderer.render(scene,camera)}).observe(host);
 controls.addEventListener('change',()=>{renderer.render(scene,camera);if(sync)return;sync=true;for(const q of panels){if(q===p)continue;q.camera.position.copy(camera.position);q.camera.quaternion.copy(camera.quaternion);q.camera.up.copy(camera.up);q.controls.target.copy(controls.target);q.controls.update();q.renderer.render(q.scene,q.camera)}sync=false});
 return p;
}
const overlay=panel('overlay');
const dirs={front:[0,-1,.12],sideA:[1,0,.12],top:[0,0,1]};
let view='front';

function clear(group){for(const o of [...group.children]){o.geometry?.dispose();o.material?.dispose();group.remove(o)}}
function addColored(p,m,hex,opacity){
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(m.pos,3));g.setAttribute('normal',new THREE.BufferAttribute(m.norm,3));g.setIndex(new THREE.BufferAttribute(m.f,1));
 const material=new THREE.MeshStandardMaterial({color:hex,roughness:.5,metalness:0,side:THREE.DoubleSide,transparent:opacity<1,opacity,depthWrite:opacity>=.8});
 const mesh=new THREE.Mesh(g,material);mesh.renderOrder=opacity<.8?1:2;p.group.add(mesh);
}
function fit(){
 const box=new THREE.Box3();
 for(const p of panels)box.expandByObject(p.group);
 if(box.isEmpty())return;
 const center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3()),dist=Math.max(size.length(),1)*1.15;
 const dir=new THREE.Vector3(...dirs[view]).normalize();
 for(const p of panels){p.controls.target.copy(center);p.camera.position.copy(center).addScaledVector(dir,dist);p.camera.up.set(0,0,1);p.camera.near=.03;p.camera.far=dist*8;p.camera.updateProjectionMatrix();p.controls.update();p.renderer.render(p.scene,p.camera)}
}

function fillTable(){
 const body=$('rows');body.replaceChildren();
 for(const group of cases[current].groups){
  const head=document.createElement('tr');head.className='group';
  const cell=document.createElement('td');cell.colSpan=3;cell.textContent=group.name;head.append(cell);body.append(head);
  for(const row of group.rows){
   const tr=document.createElement('tr');
   for(const text of [row.item,row.standard,row.value]){const td=document.createElement('td');td.textContent=text;if(text===row.value)td.className='value';tr.append(td)}
   body.append(tr);
  }
 }
}

function sectionHost(){
 const root=$('sections');root.replaceChildren();sectionStates.length=0;
 cases[current].sections.forEach(sec=>{
  const card=document.createElement('section');card.className='section-card';
  const title=document.createElement('h2');title.textContent=sec.name;
  const legend=document.createElement('div');legend.className='legend';
  legend.innerHTML='<span><i class="swatch" style="background:#2f6fdb"></i>备牙前</span><span><i class="swatch" style="background:#d23b3b"></i>备牙后</span><span class="readout"></span>';
  const canvas=document.createElement('canvas');
  card.append(title,legend,canvas);root.append(card);
  const state={sec,canvas,readout:legend.querySelector('.readout'),map:null};
  sectionStates.push(state);
  canvas.addEventListener('click',event=>measure(state,event));
  new ResizeObserver(()=>drawSection(state)).observe(canvas);
  drawSection(state);
 });
}

function bounds(sec){
 let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
 for(const line of [sec.pre,sec.post])for(const p of line){minX=Math.min(minX,p[0]);minY=Math.min(minY,p[1]);maxX=Math.max(maxX,p[0]);maxY=Math.max(maxY,p[1])}
 if(!Number.isFinite(minX)){minX=-5;maxX=5;minY=-5;maxY=5}
 const pad=Math.max(maxX-minX,maxY-minY,1)*.08;
 return {minX:minX-pad,minY:minY-pad,maxX:maxX+pad,maxY:maxY+pad};
}
function drawSection(state){
 const canvas=state.canvas,box=bounds(state.sec),ratio=Math.min(devicePixelRatio,2);
 const w=canvas.clientWidth||300,h=canvas.clientHeight||200;canvas.width=w*ratio;canvas.height=h*ratio;
 const ctx=canvas.getContext('2d');ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,w,h);
 const pad=28,spanX=box.maxX-box.minX,spanY=box.maxY-box.minY,scale=Math.min((w-pad*2)/spanX,(h-pad*2)/spanY);
 const ox=pad+(w-pad*2-spanX*scale)/2,oy=h-pad-(h-pad*2-spanY*scale)/2;
 const toX=x=>ox+(x-box.minX)*scale,toY=y=>oy-(y-box.minY)*scale;
 state.map={box,scale,ox,oy,toX,toY,w,h};
 ctx.strokeStyle='#d5dee6';ctx.strokeRect(pad/2,8,w-pad,h-16);
 ctx.fillStyle='#5d6d7c';ctx.font='11px Microsoft YaHei';ctx.fillText(state.sec.h,8,h-8);ctx.fillText(state.sec.v,8,16);
 for(const [line,color] of [[state.sec.pre,'#2f6fdb'],[state.sec.post,'#d23b3b']]){
  if(!line.length)continue;ctx.beginPath();line.forEach((p,i)=>{const x=toX(p[0]),y=toY(p[1]);i?ctx.lineTo(x,y):ctx.moveTo(x,y)});
  ctx.strokeStyle=color;ctx.lineWidth=1.6;ctx.stroke();
 }
 const chosen=picks.get(cases[current].id+'/'+state.sec.id)||[];
 ctx.strokeStyle='#17324d';ctx.fillStyle='#17324d';ctx.lineWidth=1.4;ctx.setLineDash([4,3]);
 for(let i=1;i<chosen.length;i++){ctx.beginPath();ctx.moveTo(toX(chosen[i-1][0]),toY(chosen[i-1][1]));ctx.lineTo(toX(chosen[i][0]),toY(chosen[i][1]));ctx.stroke()}
 ctx.setLineDash([]);
 for(const p of chosen){ctx.beginPath();ctx.arc(toX(p[0]),toY(p[1]),3.5,0,Math.PI*2);ctx.fill()}
 if(measureMode==='line'&&chosen.length===2){
  const dist=Math.hypot(chosen[1][0]-chosen[0][0],chosen[1][1]-chosen[0][1]);
  state.readout.textContent=dist.toFixed(2)+' mm';
 }else if(measureMode==='angle'&&chosen.length===3){
  const deg=angleAt(chosen[0],chosen[1],chosen[2]);
  state.readout.textContent=deg==null?'—':deg.toFixed(1)+'°';
 }else if(chosen.length) state.readout.textContent=measureMode==='angle'?'再点'+(3-chosen.length)+'处':'再点终点';
 else state.readout.textContent='';
}
function angleAt(a,b,c){
 const u=[a[0]-b[0],a[1]-b[1]],v=[c[0]-b[0],c[1]-b[1]];
 const du=Math.hypot(u[0],u[1]),dv=Math.hypot(v[0],v[1]);
 if(du<1e-6||dv<1e-6)return null;
 const cos=Math.max(-1,Math.min(1,(u[0]*v[0]+u[1]*v[1])/(du*dv)));
 return Math.acos(cos)*180/Math.PI;
}
function measure(state,event){
 const rect=state.canvas.getBoundingClientRect(),map=state.map;if(!map)return;
 const x=event.clientX-rect.left,y=event.clientY-rect.top;
 const mm=[map.box.minX+(x-map.ox)/map.scale, map.box.minY+(map.oy-y)/map.scale];
 const key=cases[current].id+'/'+state.sec.id;
 const chosen=picks.get(key)||[],limit=measureMode==='angle'?3:2;
 picks.set(key, chosen.length>=limit?[mm]:[...chosen,mm]);
 drawSection(state);
}

async function show(){
 const ticket=++serial;fillTable();sectionHost();
 clear(overlay.group);
 const pair=stage('step4')||stage('step6');
 if(!pair){$('fatal').textContent='这个病例没有可叠加的备牙前/备牙后单牙';return}
 await Promise.all([
  ...pair.left.map(k=>readInfo(model(k)).then(m=>addColored(overlay,m,0x3d7edb,.42))),
  ...pair.right.map(k=>readInfo(model(k)).then(m=>addColored(overlay,m,0xe07a3d,.92))),
 ]);
 if(ticket!==serial)return;
 fit();
}
function setMode(mode){
 measureMode=mode;
 $('mode-line').setAttribute('aria-pressed',mode==='line'?'true':'false');
 $('mode-angle').setAttribute('aria-pressed',mode==='angle'?'true':'false');
 $('measure-help').textContent=mode==='line'?'剖面图上点两点，量直线距离（mm）':'剖面图上依次点第一边、角点、第二边，量夹角';
 picks.clear();
 for(const state of sectionStates)drawSection(state);
}
const select=$('case');
cases.forEach((c,i)=>{const o=document.createElement('option');o.value=String(i);o.textContent=c.name;select.append(o)});
select.onchange=()=>{current=Number(select.value);show()};
document.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>{view=button.dataset.view;for(const b of document.querySelectorAll('[data-view]'))b.setAttribute('aria-pressed',b===button?'true':'false');fit()});
$('fit').onclick=fit;
$('mode-line').onclick=()=>setMode('line');
$('mode-angle').onclick=()=>setMode('angle');
if(!cases.length)$('fatal').textContent='临床对照清单里没有可显示的病例';
else show();
