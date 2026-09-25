import {PanelRenderer,ModelCache} from './render_runtime.js';
import * as THREE from 'three';
import {OrbitControls} from './vendor/OrbitControls.js';
const $=id=>document.getElementById(id),panels=[],cache=new ModelCache(),jsonCache=new ModelCache(4);
window.addEventListener('error',e=>{if(String(e.message).includes('ResizeObserver'))return;$('fatal').textContent=e.message});window.addEventListener('unhandledrejection',e=>{$('fatal').textContent=String(e.reason)});
const response=await fetch('./stages_manifest.json',{cache:'no-store'});if(!response.ok)throw Error('无法读取阶段清单');const data=await response.json();
const shoulderResponse=await fetch('./shoulder_manifest.json',{cache:'no-store'});const shoulder=shoulderResponse.ok?await shoulderResponse.json():null;
const shoulderById=new Map(shoulder?shoulder.cases.map(c=>[c.id,c]):[]);
const clinicResponse=await fetch('./clinic_manifest.json',{cache:'no-store'});const clinic=clinicResponse.ok?await clinicResponse.json():null;
const clinicById=new Map(clinic?clinic.cases.map(c=>[c.id,c]):[]);
const baselineName=(shoulder&&shoulder.baseline_name)||'上一版 R6';
if(shoulder)$('left-mode').options[0].textContent=baselineName;
let current=0,stageId=null,serial=0,sync=false,view='front',sectionData=null,boundaryData=null,acceptMode='line',acceptDir='buccolingual',cutPlane=null,regOverlay=true;
const acceptPicks=new Map(),acceptStates=[];
const acceptCut={pre:[],post:[]};
const ACCEPT_AXES={
 buccolingual:{axis:0,h:1,v:2},
 mesiodistal:{axis:1,h:0,v:2},
 horizontal:{axis:2,h:1,v:0},
};
const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
let measurePtr=null;
const C=()=>data.cases[current],SC=()=>shoulderById.get(C().id);
const S=()=>C().stages.find(s=>s.id===stageId)||C().stages[0];
const dirs={front:[0,-1,.1],back:[0,1,.1],sideA:[1,0,.1],sideB:[-1,0,.1],top:[0,0,1],bottom:[0,0,-1]};
const query=new URLSearchParams(location.search);if(Object.hasOwn(dirs,query.get('view')))view=query.get('view');
if(query.get('removed')==='1')$('removed').checked=true;if(['segmented','paired','grey','shoulder'].includes(query.get('mode')))$('display-mode').value=query.get('mode');if(query.has('section'))$('section-angle').value=Math.max(0,Math.min(71,Number(query.get('section'))||0));
function draw(p){p.renderer.render(p.scene,p.camera)}
function panel(id){
 const host=$(id),scene=new THREE.Scene();scene.background=new THREE.Color('#19222d');const camera=new THREE.PerspectiveCamera(36,1,.03,1000);camera.up.set(0,0,1);camera.position.set(0,-35,5);
 const renderer=new PanelRenderer();renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;host.appendChild(renderer.domElement);
 const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=false;controls.minDistance=.1;controls.maxDistance=400;const group=new THREE.Group(),guides=new THREE.Group();scene.add(group,guides,new THREE.AmbientLight(0xffffff,1.5));
 const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(2,2,4);camera.add(light);scene.add(camera);const p={host,scene,camera,renderer,controls,group,guides};panels.push(p);
 new ResizeObserver(()=>{renderer.setSize(host.clientWidth,host.clientHeight,false);camera.aspect=host.clientWidth/host.clientHeight;camera.updateProjectionMatrix();draw(p)}).observe(host);
 controls.addEventListener('change',()=>{draw(p);if(sync)return;sync=true;for(const q of panels){if(q===p)continue;q.camera.position.copy(camera.position);q.camera.quaternion.copy(camera.quaternion);q.camera.up.copy(camera.up);q.controls.target.copy(controls.target);q.controls.update();draw(q)}sync=false});return p;
}
const left=panel('left'),right=panel('right');
const ringOverlay=new THREE.Group();right.scene.add(ringOverlay);
const measureOverlay=new THREE.Group();right.scene.add(measureOverlay);
const ringInfo=()=>SC()?.report?.algorithm_report?.shoulder_ring;
const fixedTooth=()=>SC()?.report?.algorithm_report?.geometry_policy==='preserve_all_input_faces';
function ringReady(r){return r&&r.status==='applied'&&r.upper_boundary_display?.length&&r.growth_step?.length===r.upper_boundary_display.length}
function ringPoints(points,color,size){if(!points.length)return;const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(points.flat(),3));const object=new THREE.Points(geometry,new THREE.PointsMaterial({color,size,sizeAttenuation:false,depthTest:true}));object.renderOrder=8;ringOverlay.add(object)}
function showRing(){
 clear(ringOverlay);const r=ringInfo();if(!r){draw(right);return}
 if(!ringReady(r)){$('ring-progress').textContent='未生成闭环：'+(r.reason||r.status||'缺少显示坐标');draw(right);return}
 const last=Math.max(...r.growth_step),step=Number($('ring-step').value),complete=step>last,points=r.upper_boundary_display,visible=r.growth_step.map(k=>complete||k<=step),segments={supported:[],inferred:[]},dots={supported:[],inferred:[]};
 let forward=0,backward=0;for(let i=0;i<points.length;i++){if(!visible[i])continue;const type=r.inferred[i]?'inferred':'supported';dots[type].push(points[i]);if(r.growth_direction[i]>0)forward++;if(r.growth_direction[i]<0)backward++;const j=(i+1)%points.length;if(!visible[j]||(!complete&&Math.max(r.growth_step[i],r.growth_step[j])===last))continue;segments[r.inferred[i]||r.inferred[j]?'inferred':'supported'].push(...points[i],...points[j])}
 $('ring-progress').textContent=(complete?'终态 · 路径已闭合':'生长 '+step+' / '+last)+'；两侧已达 '+forward+' / '+backward+' 段';
 if($('show-ring').checked){for(const [type,color] of [['supported','#54e58b'],['inferred','#ffac46']]){addLines(ringOverlay,segments[type],color,4);ringPoints(dots[type],color,4)}if(visible[r.seed_index])ringPoints([points[r.seed_index]],'#ffe36b',12)}draw(right);
}
function setupRing(){
 const r=ringInfo(),ready=ringReady(r);$('ring-controls').hidden=!r;
 for(const id of ['show-ring','ring-step','ring-start','ring-complete'])$(id).disabled=!ready;
 if(ready){$('ring-step').max=Math.max(...r.growth_step)+1;$('ring-step').value=$('ring-step').max}showRing();
}
function ringSectionEvidence(angle){
 const r=ringInfo(),node=$('ring-section-evidence');node.hidden=!r;if(!r)return;if(!ringReady(r)){node.textContent='几何支持分数，非概率；本例没有可展示的闭环。';return}
 const angles=r.angle_display_deg;if(!angles?.length){node.textContent='几何支持分数，非概率；缺少方向显示变换，无法对应当前剖线。';return}
 const distance=(a,b)=>Math.abs(((a-b+540)%360)-180);
 const describe=(target,name)=>{let k=0;for(let i=1;i<angles.length;i++)if(distance(angles[i],target)<distance(angles[k],target))k=i;const score=Number(r.confidence[k]),width=Number(r.width_mm?.[k]??r.selected_width_mm?.[k]);return name+'最近方向 '+Number(r.angle_deg[k]).toFixed(1)+'°：'+(Number.isFinite(score)?score.toFixed(3):'—')+'，'+(r.inferred[k]?'低分推断':'强证据')+'，最终宽度 '+(Number.isFinite(width)?width.toFixed(2):'—')+' mm'};
 node.textContent='几何支持分数，非概率。'+describe(angle,'剖线正向')+'；'+describe((angle+180)%360,'反向')+'。按方向就近对应，剖线原点可能不同；评分对应离散候选，宽度为最终环带。';
}
async function readInfo(info){
 if(cache.has(info.url))return cache.get(info.url);
 const promise=(async()=>{const res=await fetch(info.url);if(!res.ok)throw Error('无法读取模型 '+info.url);const raw=await res.arrayBuffer(),h=new DataView(raw),nv=h.getUint32(0,true),nf=h.getUint32(4,true);if(raw.byteLength!==8+nv*40+nf*12)throw Error('模型不完整');
 const a=new Float32Array(raw,8,nv*10),f=new Uint32Array(raw,8+nv*40,nf*3),pos=new Float32Array(nv*3),norm=new Float32Array(nv*3),rgb=new Float32Array(nv*3),labels=new Uint16Array(nv);for(let i=0;i<nv;i++)for(let j=0;j<3;j++){pos[i*3+j]=a[i*10+j];norm[i*3+j]=a[i*10+3+j];rgb[i*3+j]=a[i*10+6+j]}for(let i=0;i<nv;i++)labels[i]=a[i*10+9];return {pos,norm,rgb,f,nv,labels,mode:info.mode};})();cache.set(info.url,promise);return promise;
}
const read=key=>readInfo(C().models[key]);
function jsonFile(url){if(!jsonCache.has(url))jsonCache.set(url,fetch(url).then(r=>{if(!r.ok)throw Error('无法读取 '+url);return r.json()}));return jsonCache.get(url)}
function clear(group){for(const o of [...group.children]){o.geometry?.dispose();o.material?.dispose();group.remove(o)}}
function addLines(group,pts,color,order){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pts,3));const line=new THREE.LineSegments(g,new THREE.LineBasicMaterial({color,depthTest:order===4,transparent:true,opacity:.88}));line.renderOrder=order;group.add(line)}
function meshOf(m,rgb,greyBack){
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(m.pos,3));g.setAttribute('normal',new THREE.BufferAttribute(m.norm,3));g.setAttribute('color',new THREE.BufferAttribute(rgb,3));g.setIndex(new THREE.BufferAttribute(m.f,1));
 const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.85,metalness:0,side:THREE.DoubleSide,wireframe:$('wire').checked});
 if($('back-grey').checked&&greyBack){material.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\nif (!gl_FrontFacing) diffuseColor.rgb = vec3(0.32, 0.38, 0.45);')};material.customProgramCacheKey=()=>'stages-back-grey'}
 return new THREE.Mesh(g,material);
}
function add(p,m,regSide){
 const rgb=new Float32Array(m.nv*3),col=new THREE.Color();
 for(let i=0;i<m.nv;i++){
  if(m.mode==='rgb')col.setRGB(m.rgb[i*3],m.rgb[i*3+1],m.rgb[i*3+2]).convertSRGBToLinear();
  else if(m.mode==='grey')col.set('#b2becb');
  else if(m.mode==='instance')col.setHSL((m.labels[i]*.618)%1,.58,.56);
  else col.set(data.palette[m.labels[i]]||'#a1adb9');
  col.toArray(rgb,i*3)}
 const mesh=meshOf(m,rgb,m.mode!=='rgb');if(regSide)mesh.userData.regSide=regSide;p.group.add(mesh);
}
function addShoulder(p,m){
 const rgb=new Float32Array(m.nv*3),col=new THREE.Color(),mode=$('display-mode').value;
 for(let i=0;i<m.nv;i++){const label=m.labels[i];if(m===p.original)col.setRGB(m.rgb[i*3],m.rgb[i*3+1],m.rgb[i*3+2]).convertSRGBToLinear();
  else if(m===p.removed)col.set('#ffa326');else if(mode==='grey')col.set('#b2becb');else if(mode==='shoulder'&&label<6)col.set('#596b7d');
  else{const sid=mode==='paired'&&label>=7?label-5:label;col.set(data.palette[sid]||'#a1adb9');if(mode==='paired'&&label>=7)col.multiplyScalar(.65)}col.toArray(rgb,i*3)}
 p.group.add(meshOf(m,rgb,m!==p.original&&m!==p.removed));
 if($('boundary').checked&&m!==p.original&&m!==p.removed){const edges=new Map(),weld=new Map(),ids=[];for(let i=0;i<m.nv;i++){const k=[m.pos[3*i],m.pos[3*i+1],m.pos[3*i+2]].map(x=>x.toFixed(5)).join(',');if(!weld.has(k))weld.set(k,i);ids.push(weld.get(k))}
 for(let i=0;i<m.f.length;i+=3)for(const [a,b] of [[0,1],[1,2],[2,0]]){let u=ids[m.f[i+a]],v=ids[m.f[i+b]];if(u>v)[u,v]=[v,u];const k=u+','+v;edges.set(k,(edges.get(k)||0)+1)}
 const pts=[];for(const [k,n] of edges)if(n===1)for(const id of k.split(',').map(Number))pts.push(...m.pos.slice(id*3,id*3+3));addLines(p.group,pts,'#ec85db',3)}
 if(p===right&&m!==p.removed&&$('linked').checked&&boundaryData)addLines(p.group,boundaryData.lines.flat(2),'#f5f1d5',4);
 if(p===right&&m!==p.removed&&$('axes').checked&&boundaryData)addLines(p.group,boundaryData.side_lines.flat(2),'#a0dcff',4);
}
function fit(){
 let box=null;
 if(stageId==='shoulder'&&SC()){const b=SC().bounds;box=new THREE.Box3(new THREE.Vector3(...b[0]),new THREE.Vector3(...b[1]))}
 else if(stageId==='step6'||stageId==='step8'||isRegStage()){
  box=new THREE.Box3();
  for(const p of panels){if(!p.group.children.length)continue;box.union(new THREE.Box3().setFromObject(p.group))}
  if(box.isEmpty())return;
 }
 else{const s=S();for(const side of ['left','right'])for(const key of s[side]){const b=C().models[key].bounds,bb=new THREE.Box3(new THREE.Vector3(...b[0]),new THREE.Vector3(...b[1]));box=box?box.union(bb):bb}}
 if(!box)return;const center=box.getCenter(new THREE.Vector3()),r=Math.max(box.getSize(new THREE.Vector3()).length()/2,1),dir=new THREE.Vector3(...dirs[view]).normalize();sync=true;
 for(const p of panels){if(p.host.clientWidth<2)continue;const vf=THREE.MathUtils.degToRad(p.camera.fov),hf=2*Math.atan(Math.tan(vf/2)*p.camera.aspect);p.controls.target.copy(center);p.camera.position.copy(center).addScaledVector(dir,r/Math.sin(Math.min(vf,hf)/2)*1.08);p.camera.up.set(0,view==='top'||view==='bottom'?1:0,view==='top'||view==='bottom'?0:1);p.camera.lookAt(center);p.controls.update();draw(p)}sync=false;
 for(const b of $('views').querySelectorAll('[data-view]'))b.setAttribute('aria-pressed',String(b.dataset.view===view));
}
function section(){
 if(!sectionData)return;const s=sectionData[Number($('section-angle').value)],angle=s.angle_deg*Math.PI/180;$('angle-value').textContent=s.angle_deg+'°';$('section-evidence').textContent=fixedTooth()?'本轮保留全部输入曲面；剖线用于检查肩台分区，输入已有的缺损仍会保留。':s.layers.removed.length?(ringInfo()?'此剖面经过基线已剔除的薄片；本次闭环实验没有新增剔除。':'此剖面经过本轮剔除的薄片，橙色显示移除位置。'):'此剖面未经过剔除薄片。';
 ringSectionEvidence(s.angle_deg);
 for(const [p,key,color] of [[left,$('left-mode').value==='original'?'original':'before','#f3ba65'],[right,'after','#54e0dc']]){clear(p.guides);if($('show-section').checked){const pts=[];for(const line of s.layers3d[key])for(const point of line)pts.push(...point);addLines(p.guides,pts,color,5)}draw(p)}
 const canvas=$('section-chart'),ratio=Math.min(devicePixelRatio,2),w=canvas.clientWidth||700,h=310;canvas.width=w*ratio;canvas.height=h*ratio;const ctx=canvas.getContext('2d');ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,w,h);
 const points=[...s.layers.before.flat(),...s.layers.after.flat()];if(!points.length)return;let xmin=Math.min(...points.map(p=>p[0]))-1.5,xmax=Math.max(...points.map(p=>p[0]))+1.5,ymin=Math.min(...points.map(p=>p[1]))-1,ymax=Math.max(...points.map(p=>p[1]))+.6;
 const scale=Math.min((w-90)/(xmax-xmin),(h-50)/(ymax-ymin)),ox=(w-scale*(xmax-xmin))/2,oy=22;const xy=(p)=>[ox+(p[0]-xmin)*scale,oy+(ymax-p[1])*scale];
 ctx.strokeStyle='#2c4052';ctx.fillStyle='#92a6bb';ctx.font='11px sans-serif';ctx.lineWidth=1;
 for(let x=Math.ceil(xmin);x<=xmax;x++){const a=xy([x,ymin]),b=xy([x,ymax]);ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke();ctx.fillText(x+'',a[0]-3,a[1]+16)}
 for(let z=Math.ceil(ymin);z<=ymax;z++){const a=xy([xmin,z]),b=xy([xmax,z]);ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke();ctx.fillText(z+'',a[0]-24,a[1]+4)}
 for(const [key,color,width] of [['original','#788697',1.3],['before','#f3ba65',3.8],['after','#54e0dc',1.8],['shoulder','#ff5548',3],['removed','#ffa326',3.4]]){ctx.save();ctx.beginPath();ctx.rect(ox,oy,(xmax-xmin)*scale,(ymax-ymin)*scale);ctx.clip();ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();for(const line of s.layers[key]){ctx.moveTo(...xy(line[0]));ctx.lineTo(...xy(line[1]))}ctx.stroke();ctx.restore()}
 ctx.fillStyle='#aebed0';ctx.fillText('mm',w-30,h-10);
}
function addColored(p,m,hex,opacity,regSide){
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(m.pos,3));g.setAttribute('normal',new THREE.BufferAttribute(m.norm,3));g.setIndex(new THREE.BufferAttribute(m.f,1));
 const material=new THREE.MeshStandardMaterial({color:hex,roughness:.5,metalness:0,side:THREE.DoubleSide,transparent:opacity<1,opacity,depthWrite:opacity>=.8});
 const mesh=new THREE.Mesh(g,material);mesh.renderOrder=opacity<.8?1:2;if(regSide)mesh.userData.regSide=regSide;p.group.add(mesh);
}
const REG_FOCUS_PAD_MM=1.5;
function regFocusInfo(s){
 const prep=s.prep_label??s['预备牙标签'];
 const neighbors=s.neighbor_labels??s['ICP约束邻牙标签列表']??[];
 if(prep==null&&(!neighbors||!neighbors.length))return null;
 const pre=new Set();
 if(prep!=null)pre.add(Number(prep));
 for(const n of neighbors)pre.add(Number(n));
 if(!pre.size)return null;
 const map=s.pre_label_to_post_instance??s['PRE标签到POST实例']??{};
 const postPrep=s.post_prep_instance??s['备牙后预备牙实例'];
 const post=new Set();
 let mapped=0;
 for(const lab of pre){
  const hit=map[String(lab)]??map[lab];
  if(hit!=null){post.add(Number(hit));mapped++}
  else post.add(lab);
 }
 if(postPrep!=null){post.add(Number(postPrep));mapped++}
 return {pre,post,hasMap:mapped>0};
}
function compactMesh(m,keepV,count){
 const index=new Int32Array(m.nv).fill(-1),pos=new Float32Array(count*3),norm=new Float32Array(count*3),rgb=new Float32Array(count*3),labels=new Uint16Array(count);
 let w=0;
 for(let i=0;i<m.nv;i++){
  if(!keepV[i])continue;index[i]=w;
  pos[w*3]=m.pos[i*3];pos[w*3+1]=m.pos[i*3+1];pos[w*3+2]=m.pos[i*3+2];
  norm[w*3]=m.norm[i*3];norm[w*3+1]=m.norm[i*3+1];norm[w*3+2]=m.norm[i*3+2];
  rgb[w*3]=m.rgb[i*3];rgb[w*3+1]=m.rgb[i*3+1];rgb[w*3+2]=m.rgb[i*3+2];
  labels[w]=m.labels[i];w++;
 }
 const faces=[];
 for(let i=0;i<m.f.length;i+=3){
  const a=m.f[i],b=m.f[i+1],c=m.f[i+2];
  if(keepV[a]&&keepV[b]&&keepV[c])faces.push(index[a],index[b],index[c]);
 }
 return {pos,norm,rgb,f:new Uint32Array(faces),nv:count,labels,mode:m.mode};
}
function filterMeshByLabels(m,keep){
 if(!m||!keep?.size)return m;
 const keepV=new Uint8Array(m.nv);let n=0;
 for(let i=0;i<m.nv;i++)if(keep.has(m.labels[i])){keepV[i]=1;n++}
 if(!n)return null;
 if(n===m.nv)return m;
 return compactMesh(m,keepV,n);
}
function meshBounds(m){
 let minx=Infinity,miny=Infinity,minz=Infinity,maxx=-Infinity,maxy=-Infinity,maxz=-Infinity;
 for(let i=0;i<m.nv;i++){
  const x=m.pos[i*3],y=m.pos[i*3+1],z=m.pos[i*3+2];
  if(x<minx)minx=x;if(y<miny)miny=y;if(z<minz)minz=z;
  if(x>maxx)maxx=x;if(y>maxy)maxy=y;if(z>maxz)maxz=z;
 }
 return Number.isFinite(minx)?{min:[minx,miny,minz],max:[maxx,maxy,maxz]}:null;
}
function unionBounds(a,b){
 if(!a)return b;if(!b)return a;
 return {min:[Math.min(a.min[0],b.min[0]),Math.min(a.min[1],b.min[1]),Math.min(a.min[2],b.min[2])],
  max:[Math.max(a.max[0],b.max[0]),Math.max(a.max[1],b.max[1]),Math.max(a.max[2],b.max[2])]};
}
function filterMeshByBox(m,box,pad){
 if(!m||!box)return m;
 const keepV=new Uint8Array(m.nv);let n=0;
 const x0=box.min[0]-pad,y0=box.min[1]-pad,z0=box.min[2]-pad,x1=box.max[0]+pad,y1=box.max[1]+pad,z1=box.max[2]+pad;
 for(let i=0;i<m.nv;i++){
  const x=m.pos[i*3],y=m.pos[i*3+1],z=m.pos[i*3+2];
  if(x>=x0&&x<=x1&&y>=y0&&y<=y1&&z>=z0&&z<=z1){keepV[i]=1;n++}
 }
 if(!n)return null;
 if(n===m.nv)return m;
 return compactMesh(m,keepV,n);
}
function filterRegMeshes(s,models){
 const info=regFocusInfo(s);if(!info)return models;
 const out=Object.assign({},models);
 let preBox=null;
 for(const key of s.left){
  const filtered=filterMeshByLabels(models[key],info.pre);
  if(filtered){out[key]=filtered;preBox=unionBounds(preBox,meshBounds(filtered))}
 }
 for(const key of s.right){
  let filtered=info.hasMap?filterMeshByLabels(models[key],info.post):filterMeshByLabels(models[key],info.pre);
  if((!filtered||filtered.nv<32)&&preBox)filtered=filterMeshByBox(models[key],preBox,REG_FOCUS_PAD_MM);
  if(filtered)out[key]=filtered;
 }
 return out;
}
async function render(doFit=false){
 const ticket=++serial,s=S();
 if(stageId==='step6')return renderPrep(ticket,doFit);
 if(stageId==='step8')return renderUndercut(ticket,doFit);
 if(stageId==='shoulder'&&SC())return renderShoulder(ticket,doFit);
 clear(ringOverlay);
 const hasMeshes=s.left.length+s.right.length>0;
 const overlay=isRegStage()&&regOverlay&&hasMeshes;
 $('panels').classList.toggle('hidden',!hasMeshes);
 $('panels').classList.toggle('overlay-only',overlay);
 $('panels').classList.toggle('reg-overlay',overlay);
 $('left-label').textContent=s.left_label||'';
 $('right-label').textContent=overlay?'蓝半透明：备牙前 · 彩色：配准后的备牙后':(s.right_label||'');
 if(!hasMeshes){for(const p of panels){clear(p.group);clear(p.guides);draw(p)}return}
 $('status').textContent='加载模型…';
 const keys=[...new Set([...s.left,...s.right])],models=await Promise.all(keys.map(read));if(ticket!==serial)return;
 let m=Object.fromEntries(keys.map((k,i)=>[k,models[i]]));
 if(isRegStage())m=filterRegMeshes(s,m);
 for(const p of panels){clear(p.group);clear(p.guides)}
 if(overlay){
  for(const key of s.left)if(m[key])addColored(right,m[key],0x3d7edb,.35,'pre');
  for(const key of s.right)if(m[key])add(right,m[key],'post');
 }else{
  for(const key of s.left)if(m[key])add(left,m[key],'pre');
  for(const key of s.right)if(m[key])add(right,m[key],'post');
 }
 if(doFit)fitSoon();else{draw(left);draw(right)}
 if(isRegStage())$('status').textContent=overlay?'已加载 · 叠加查看配准（备牙+左右邻牙）':'已加载 · 左右视图联动（备牙+左右邻牙）';
 else $('status').textContent='已加载 · 左右视图联动';
}
async function renderShoulder(ticket,doFit){
 const sc=SC();$('panels').classList.remove('hidden');
 $('left-label').textContent=$('left-mode').value==='original'?'原扫描邻域':baselineName;$('right-label').textContent=(shoulder&&shoulder.after_name)||'本轮约束结果';
 $('status').textContent='加载模型与剖线…';
 const keys=['original','before','after'];if(sc.models.removed)keys.push('removed');
 const results=await Promise.all([...keys.map(k=>readInfo(sc.models[k])),jsonFile(sc.sections_url),jsonFile(sc.boundaries_url)]);if(ticket!==serial)return;
 const m=Object.fromEntries(keys.map((k,i)=>[k,results[i]]));sectionData=results[keys.length];boundaryData=results[keys.length+1];
 for(const p of panels){clear(p.group);clear(p.guides);p.original=m.original;p.removed=m.removed}
 addShoulder(left,m[$('left-mode').value]);addShoulder(right,m.after);if($('removed').checked&&m.removed)addShoulder(right,m.removed);
 if(doFit)fit();section();showRing();$('status').textContent='已加载 · 左右视图联动';
}
async function renderPrep(ticket,doFit){
 $('panels').classList.remove('hidden');$('panels').classList.add('overlay-only');
 $('right-label').textContent='蓝：备牙前 · 彩色：预备量';$('status').textContent='加载预备量…';
 const pair=S();
 for(const p of panels){clear(p.group);clear(p.guides)}
 if(!pair.left.length&&!pair.right.length){$('status').textContent='没有预备量网格';return}
 const models=await Promise.all([...pair.left,...pair.right].map(read));if(ticket!==serial)return;
 acceptCut.pre=models.slice(0,pair.left.length);acceptCut.post=models.slice(pair.left.length);
 pair.left.forEach((_,i)=>addColored(right,models[i],0x3d7edb,.4));
 pair.right.forEach((_,i)=>add(right,models[pair.left.length+i]));
 cutPlane=null;setupAcceptRanges();
 if(doFit)fit();else draw(right);
 const active=acceptStates.find(s=>s.sec.id===acceptDir)||acceptStates[0];
 if(active)placeCutPlane(active);
 $('status').textContent='已加载 · 拖动剖面滑块移动切平面';
 drawAccept();
}
function metric(label,val){
 let text=String(val);
 if(label==='判定'&&text.includes("'result'")){
  const result=text.match(/'result': '(\w+)'/)?.[1]||text;
  const p95=text.match(/'p95_mm': ([0-9.]+)/);
  const p99=text.match(/'p99_mm': ([0-9.]+)/);
  text=p95?result+' · P95 '+Number(p95[1]).toFixed(3)+' mm · P99 '+Number(p99[1]).toFixed(3)+' mm':result;
 }
 const e=document.createElement('div');e.className='metric';const b=document.createElement('b');b.textContent=text;e.append(document.createTextNode(label),b);$('metrics').append(e);
}
function isRegStage(){return stageId==='step2'||stageId==='step3'}
function fitSoon(){requestAnimationFrame(()=>{for(const p of panels){if(p.host.clientWidth<2)continue;p.renderer.setSize(p.host.clientWidth,p.host.clientHeight,false);p.camera.aspect=p.host.clientWidth/Math.max(p.host.clientHeight,1);p.camera.updateProjectionMatrix()}fit()})}
function fmtNum(v,digits){return v==null||!Number.isFinite(Number(v))?'—':Number(v).toFixed(digits)}
function circularAzDist(a,b){return Math.abs(((a-b+540)%360)-180)}
function nearestShoulderBin(az,bins){if(!bins?.length)return null;let best=null,bestD=Infinity;for(const bin of bins){const d=circularAzDist(az,Number(bin.az));if(d<bestD){bestD=d;best=bin}}return best}
/** 牙体显示坐标：x=近中、y=唇面，与 section_azimuth_deg 一致（0=唇侧，+90=近中）。 */
function hitAzimuthDeg(point){return Math.atan2(point.x,point.y)*180/Math.PI}
function syncMeasurePanel(){
 if(stageId==='step6'){$('measure-panel').classList.add('hidden');return}
 const on=$('measure').checked;$('measure-panel').classList.toggle('hidden',!on);
 if(!on)return;
 const ref=$('measure-ref');
 if(isRegStage()){
  if(ref)ref.hidden=true;
  if(!$('measure-result').dataset.filled)$('measure-result').textContent='测量已开：在叠加模型上点一下，报告该点到另一侧表面的局部配准间隙（mm）。点彩色 POST → 量到蓝色 PRE；点蓝色 PRE → 量到 POST。轻点，勿拖转。';
  return;
 }
 if(ref)ref.hidden=false;
 const bins=C().shoulder_bins,ok=bins?.length&&(stageId==='step5'||stageId==='shoulder_regrade');
 if(!ok)$('measure-result').textContent='当前阶段没有复判桶数据，请切到「⑤ 牙面分割」或「⑤b 肩台复判」后再点右侧网格。';
 else if(!$('measure-result').dataset.filled)$('measure-result').textContent='测量已开：在右侧网格点一下（轻点，勿拖转）。未发布桶也会显示数字。';
}
function measureWidthText(bin){
 const w=bin.台面宽中位_mm;
 return w==null||!Number.isFinite(Number(w))?'台面宽 未检出':'台面宽 '+Number(w).toFixed(3)+' mm';
}
function measureTurnText(bin){
 const turn=bin.转角中位_deg;
 if(turn!=null&&Number.isFinite(Number(turn)))return '转折 '+Number(turn).toFixed(1)+'°';
 const rmax=bin.最大转角_deg;
 if(rmax!=null&&Number.isFinite(Number(rmax)))return '最大转角 '+Number(rmax).toFixed(1)+'°（无台面转折）';
 return '转折 未检出';
}
function clearMeasureBin(){clear(measureOverlay);draw(right)}
/** 测量真正用的那条径向剖线：过牙长轴(显示 z 轴)、方位角 azDeg 的平面 ∩ 网格，
 * 只留朝外(径向≥0)一侧。返回线段坐标数组（与 Python _crown_branch 同一几何）。 */
function radialProfileSegments(mesh,azDeg){
 const center=azDeg*Math.PI/180;
 const dirx=Math.sin(center),diry=Math.cos(center);
 const nx=-diry,ny=dirx;             // 平面法向 = axis(0,0,1) × radial
 const pos=mesh.geometry.getAttribute('position');
 const idx=mesh.geometry.index?mesh.geometry.index.array:null;
 const at=i=>idx?idx[i]:i;
 const n=idx?idx.length:pos.count;
 const P=i=>[pos.getX(i),pos.getY(i),pos.getZ(i)];
 const d=i=>nx*pos.getX(i)+ny*pos.getY(i);     // 到剖面的有符号距离
 const r=i=>dirx*pos.getX(i)+diry*pos.getY(i); // 沿径向的距离（>0 朝外）
 const lerp=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];
 const segs=[];
 for(let i=0;i<n;i+=3){
  const a=at(i),b=at(i+1),c=at(i+2);
  const da=d(a),db=d(b),dc=d(c);
  const pts=[];
  for(const [u,v,du,dv] of [[a,b,da,db],[b,c,db,dc],[c,a,dc,da]]){
   if((du<0&&dv<0)||(du>0&&dv>0)) continue;
   const t=du/(du-dv);
   pts.push({p:lerp(P(u),P(v),t),rr:r(u)+(r(v)-r(u))*t});
  }
  if(pts.length===2&&Math.max(pts[0].rr,pts[1].rr)>=-0.02) segs.push(...pts[0].p,...pts[1].p);
 }
 return segs;
}
/** 线段串成折线，取最长一条，按显示 z 从低到高排列（颈缘 → 切端）。 */
function chainProfile(segs){
 const key=p=>p.map(x=>x.toFixed(4)).join(',');
 const nodes=new Map(),adj=new Map();
 const id=p=>{const k=key(p);if(!nodes.has(k)){nodes.set(k,p);adj.set(k,[])}return k};
 for(let i=0;i<segs.length;i+=6){
  const a=id(segs.slice(i,i+3)),b=id(segs.slice(i+3,i+6));
  if(a===b)continue;adj.get(a).push(b);adj.get(b).push(a);
 }
 const seen=new Set();let best=[],bestLen=0;
 const starts=[...adj.keys()].sort((a,b)=>adj.get(a).length-adj.get(b).length);
 for(const s of starts){
  if(seen.has(s))continue;
  const path=[s];seen.add(s);let cur=s;
  for(;;){const nxt=adj.get(cur).find(k=>!seen.has(k));if(!nxt)break;seen.add(nxt);path.push(nxt);cur=nxt}
  let len=0;for(let i=1;i<path.length;i++){const a=nodes.get(path[i-1]),b=nodes.get(path[i]);len+=Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2])}
  if(len>bestLen){bestLen=len;best=path}
 }
 const pts=best.map(k=>nodes.get(k));
 if(pts.length>1&&pts[0][2]>pts[pts.length-1][2])pts.reverse();
 return pts;
}
/** 桶内两条实测剖线（lo、lo+2.5°）里离点击方位角更近的一条。 */
function measuredProfileAz(bin,clickAz){
 const c=Number(bin.az),candidates=[c-2.5,c];
 return candidates.reduce((a,b)=>circularAzDist(clickAz,a)<=circularAzDist(clickAz,b)?a:b);
}
function highlightMeasureBin(bin,hitPoint,clickAz){
 clear(measureOverlay);
 const mesh=right.group.children.find(o=>o.isMesh);
 if(!mesh){draw(right);return}
 const profileAz=measuredProfileAz(bin,clickAz??Number(bin.az));
 const pts=chainProfile(radialProfileSegments(mesh,profileAz));
 if(pts.length>1){
  const lift=p=>{const r=Math.hypot(p[0],p[1])||1;return new THREE.Vector3(p[0]+p[0]/r*.08,p[1]+p[1]/r*.08,p[2])};
  const curve=new THREE.CatmullRomCurve3(pts.map(lift),false,'centripetal',0);
  const tube=new THREE.Mesh(
   new THREE.TubeGeometry(curve,Math.max(24,pts.length*2),.09,8,false),
   new THREE.MeshBasicMaterial({color:0xff3b30}),
  );
  tube.renderOrder=7;
  measureOverlay.add(tube);
  const neck=new THREE.Mesh(
   new THREE.SphereGeometry(.22,16,12),
   new THREE.MeshBasicMaterial({color:0xffe36b}),
  );
  neck.position.copy(lift(pts[0]));
  neck.renderOrder=8;
  measureOverlay.add(neck);
 }
 $('measure-result').textContent+=`\n剖线 ${profileAz.toFixed(1)}°：红线从颈缘（黄点）沿牙面走到切端；台面宽和转折量的是黄点附近的颈缘段`;
 if(hitPoint){
  const dot=new THREE.Mesh(
   new THREE.SphereGeometry(0.45,16,12),
   new THREE.MeshBasicMaterial({color:0xff5a1f,depthTest:false}),
  );
  dot.position.copy(hitPoint);
  dot.renderOrder=8;
  measureOverlay.add(dot);
 }
 draw(right);
}
function showMeasureHit(az,bin){
 const pub=bin.发布?'已发布':'未发布';
 $('measure-result').dataset.filled='1';
 $('measure-result').textContent=
  `方位角 ${az.toFixed(1)}° → 最近桶 ${Number(bin.az).toFixed(1)}°\n`+
  `${measureWidthText(bin)} · ${measureTurnText(bin)}\n`+
  `分类 ${bin.分类??'—'} · ${pub}`+(bin.状态?`（${bin.状态}）`:'');
}
function pickRightMeasure(event){
 if(!$('measure').checked)return;
 if(isRegStage()){pickRegGapMeasure(event);return}
 const bins=C().shoulder_bins;
 if(!bins?.length||(stageId!=='step5'&&stageId!=='shoulder_regrade')){
  $('measure-result').textContent='当前阶段没有复判桶数据，请切到「⑤ 牙面分割」或「⑤b 肩台复判」后再点右侧网格。';
  delete $('measure-result').dataset.filled;return;
 }
 const rect=right.host.getBoundingClientRect();
 if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)return;
 pointer.x=((event.clientX-rect.left)/rect.width)*2-1;
 pointer.y=-((event.clientY-rect.top)/rect.height)*2+1;
 raycaster.setFromCamera(pointer,right.camera);
 const hits=raycaster.intersectObjects(right.group.children,true).filter(h=>h.object.isMesh);
 if(!hits.length){$('measure-result').textContent='未点到右侧网格，请再点唇面颈缘附近。';delete $('measure-result').dataset.filled;return}
 const az=hitAzimuthDeg(hits[0].point),bin=nearestShoulderBin(az,bins);
 if(!bin){$('measure-result').textContent='清单里没有可匹配的测量桶。';delete $('measure-result').dataset.filled;clearMeasureBin();return}
 showMeasureHit(az,bin);
 highlightMeasureBin(bin,hits[0].point,az);
}
const _regA=new THREE.Vector3(),_regB=new THREE.Vector3(),_regC=new THREE.Vector3();
const _regAB=new THREE.Vector3(),_regAC=new THREE.Vector3(),_regAP=new THREE.Vector3();
const _regBP=new THREE.Vector3(),_regCP=new THREE.Vector3(),_regOut=new THREE.Vector3();
function closestPointOnTriangle(p,a,b,c,out){
 _regAB.subVectors(b,a);_regAC.subVectors(c,a);_regAP.subVectors(p,a);
 const d1=_regAB.dot(_regAP),d2=_regAC.dot(_regAP);
 if(d1<=0&&d2<=0)return out.copy(a);
 _regBP.subVectors(p,b);const d3=_regAB.dot(_regBP),d4=_regAC.dot(_regBP);
 if(d3>=0&&d4<=d3)return out.copy(b);
 const vc=d1*d4-d3*d2;
 if(vc<=0&&d1>=0&&d3<=0){return out.copy(a).addScaledVector(_regAB,d1/(d1-d3))}
 _regCP.subVectors(p,c);const d5=_regAB.dot(_regCP),d6=_regAC.dot(_regCP);
 if(d6>=0&&d5<=d6)return out.copy(c);
 const vb=d5*d2-d1*d6;
 if(vb<=0&&d2>=0&&d6<=0){return out.copy(a).addScaledVector(_regAC,d2/(d2-d6))}
 const va=d3*d6-d5*d4;
 if(va<=0&&(d4-d3)>=0&&(d5-d6)>=0){return out.copy(b).addScaledVector(_regCP.subVectors(c,b),(d4-d3)/((d4-d3)+(d5-d6)))}
 const denom=1/(va+vb+vc);
 return out.copy(a).addScaledVector(_regAB,vb*denom).addScaledVector(_regAC,vc*denom);
}
function closestOnMesh(point,mesh,best){
 const pos=mesh.geometry.getAttribute('position');
 const idx=mesh.geometry.index?mesh.geometry.index.array:null;
 const n=idx?idx.length:pos.count;
 const at=i=>idx?idx[i]:i;
 mesh.updateWorldMatrix(true,false);
 const mw=mesh.matrixWorld;
 for(let i=0;i<n;i+=3){
  _regA.set(pos.getX(at(i)),pos.getY(at(i)),pos.getZ(at(i))).applyMatrix4(mw);
  _regB.set(pos.getX(at(i+1)),pos.getY(at(i+1)),pos.getZ(at(i+1))).applyMatrix4(mw);
  _regC.set(pos.getX(at(i+2)),pos.getY(at(i+2)),pos.getZ(at(i+2))).applyMatrix4(mw);
  closestPointOnTriangle(point,_regA,_regB,_regC,_regOut);
  const d2=point.distanceToSquared(_regOut);
  if(d2<best.d2){best.d2=d2;best.point.copy(_regOut)}
 }
 return best;
}
function regMeshes(side){
 const out=[];
 for(const p of panels)for(const o of p.group.children)if(o.isMesh&&o.userData.regSide===side)out.push(o);
 return out;
}
function highlightRegGap(hitPoint,closest){
 clear(measureOverlay);
 const mk=(pt,hex,r)=>{const d=new THREE.Mesh(new THREE.SphereGeometry(r,16,12),new THREE.MeshBasicMaterial({color:hex,depthTest:false}));d.position.copy(pt);d.renderOrder=8;measureOverlay.add(d)};
 mk(hitPoint,0xff5a1f,.35);mk(closest,0x54e0dc,.28);
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([...hitPoint.toArray(),...closest.toArray()],3));
 const line=new THREE.Line(g,new THREE.LineBasicMaterial({color:0xffe36b,depthTest:false}));line.renderOrder=7;measureOverlay.add(line);
 draw(right);if(!regOverlay)draw(left);
}
function pickRegGapMeasure(event){
 const rect=right.host.getBoundingClientRect();
 if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)return;
 pointer.x=((event.clientX-rect.left)/rect.width)*2-1;
 pointer.y=-((event.clientY-rect.top)/rect.height)*2+1;
 raycaster.setFromCamera(pointer,right.camera);
 const hits=raycaster.intersectObjects(right.group.children,true).filter(h=>h.object.isMesh);
 if(!hits.length){
  $('measure-result').textContent='未点到网格：请点在蓝色 PRE 或彩色 POST 表面上（勿点空处）。';
  delete $('measure-result').dataset.filled;clearMeasureBin();return;
 }
 const hit=hits[0];
 let side=hit.object.userData.regSide;
 if(!side)side=hit.object.material?.transparent?'pre':'post';
 const other=side==='pre'?'post':'pre';
 const targets=regMeshes(other);
 if(!targets.length){
  $('measure-result').textContent=regOverlay?'另一侧网格未加载，无法量配准间隙。':'请先切回「叠加查看」，再在同一视图里点 PRE/POST。';
  delete $('measure-result').dataset.filled;clearMeasureBin();return;
 }
 const best={d2:Infinity,point:new THREE.Vector3()};
 for(const mesh of targets)closestOnMesh(hit.point,mesh,best);
 if(!Number.isFinite(best.d2)){
  $('measure-result').textContent='未找到另一侧表面上的对应点，请换一处再点。';
  delete $('measure-result').dataset.filled;clearMeasureBin();return;
 }
 const gap=Math.sqrt(best.d2);
 const from=side==='pre'?'PRE → POST':'POST → PRE';
 $('measure-result').dataset.filled='1';
 $('measure-result').textContent=`配准间隙 ${gap.toFixed(3)} mm（${from}）`;
 highlightRegGap(hit.point,best.point);
}
function showStage(id,doFit=true){
 stageId=id;const s=S(),sc=SC(),isShoulder=id==='shoulder'&&!!sc,isPrep=id==='step6',isUndercut=id==='step8',isReg=id==='step2'||id==='step3',overlay=isReg&&regOverlay;
 for(const b of $('stages').querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.stage===id));
 $('shoulder-controls').classList.toggle('hidden',!isShoulder);$('section-block').classList.toggle('hidden',!isShoulder);
 $('accept-visual').classList.toggle('hidden',!isPrep);$('accept-numbers').classList.toggle('hidden',!isPrep);
 $('undercut-visual').classList.toggle('hidden',!isUndercut);$('undercut-numbers').classList.toggle('hidden',!isUndercut);
 $('metrics').classList.toggle('hidden',isPrep||isUndercut);$('images').classList.toggle('hidden',isPrep||isReg||isUndercut);
 $('images').classList.toggle('reg-review',isReg);
 $('display-toggles').classList.toggle('hidden',isPrep);
 $('measure').parentElement.classList.toggle('hidden',isUndercut);
 $('panels').classList.toggle('overlay-only',isPrep||overlay||isUndercut);
 $('panels').classList.toggle('reg-overlay',overlay);
 $('reg-split').hidden=!isReg;
 $('reg-split').textContent=regOverlay?'分开查看':'叠加查看';
 $('reg-split').setAttribute('aria-pressed',String(!regOverlay));
 layoutPrep(isPrep||isUndercut, isUndercut?$('undercut-visual'):$('accept-visual'));
 $('ring-controls').hidden=true;$('ring-section-evidence').hidden=true;
 if(isShoulder){$('model-help').hidden=false;$('model-help').textContent='拖动旋转 · 滚轮缩放 · 右键平移；左右视图联动。白线：肩台与牙面的交界；浅蓝线：牙面侧边界；'+(fixedTooth()?'本轮保留全部输入曲面，只重新划分标签。':ringInfo()?'橙色薄片：沿用基线的剔除范围，本轮未新增剔除。':'橙色：本轮剔除的薄片。')}
 else if(isReg){$('model-help').hidden=false;$('model-help').textContent=overlay?'同一坐标系叠加，只显示备牙牙与左右邻牙。蓝色半透明是备牙前，彩色是配准后的备牙后；错位会露出双层边缘。':'左右分开，只显示备牙牙与左右邻牙。左侧备牙前，右侧配准后的备牙后，视角联动。'}
 else if(isUndercut){$('model-help').hidden=false;$('model-help').textContent='左侧是预备牙上的倒凹深度着色，右侧是分层剖面。下面的数字只测不判，占比达到 1% 记为有倒凹。'}
 else $('model-help').hidden=true;
 $('assessment').textContent=isShoulder?(sc.assessment||''):'';
 if(isShoulder){$('audit-link').href=sc.audit_url;$('tooth-link').href=sc.download_url;setupRing()}
 else{sectionData=null;boundaryData=null}
 if(isPrep)fillAccept(clinicById.get(C().id));
 $('metrics').replaceChildren();for(const [label,val] of s.metrics)metric(label,val);
 $('notes').replaceChildren();for(const note of s.notes){const li=document.createElement('li');li.textContent=note;$('notes').append(li)}
 $('images').replaceChildren();for(const img of s.images){const fig=document.createElement('figure'),el=document.createElement('img');el.src=img.url;el.alt=img.caption;el.loading='lazy';const cap=document.createElement('figcaption');cap.textContent=img.caption;fig.append(el,cap);$('images').append(fig)}
 $('legend').replaceChildren();
 const modes=new Set(s.left.concat(s.right).map(k=>C().models[k].mode));
 if(modes.has('label')||isShoulder)for(const [sid,name] of [[1,'切端/咬合面'],[2,'唇面'],[3,'舌面'],[4,'近中'],[5,'远中'],[7,'肩台']]){const item=document.createElement('span');item.textContent='● '+name;item.style.color=data.palette[sid];$('legend').append(item)}
 if(modes.has('instance')){const item=document.createElement('span');item.textContent='● 实例分色';item.style.color='#63b4fa';$('legend').append(item)}
 if(overlay){const item=document.createElement('span');item.textContent='● 备牙前（半透明）';item.style.color='#3d7edb';$('legend').prepend(item)}
 delete $('measure-result').dataset.filled;clear(measureOverlay);syncMeasurePanel();
 history.replaceState(null,'','#'+C().id+'/'+id);render(doFit);
}
function shoulderMetrics(sc){
 const r=sc.report,ring=r.algorithm_report?.shoulder_ring,fixed=r.algorithm_report?.geometry_policy==='preserve_all_input_faces';
 return [['处理范围',r.algorithm_report?.processing_scope||r.processing_scope||(ring?'仅肩台分区':r.preserved?'保留基线':'肩台附近')],
 ['肩台连续区',r.shoulder_union.components+' 条'],
 [fixed?'本轮剔除面积':ring?'沿用基线剔除面积':'局部剔除面积',r.trim.removed_area_mm2.toFixed(2)+' mm²'],
 ['肩台面积',r.shoulder_area_mm2.toFixed(2)+' mm²']];
}
const PREP_SECTIONS=[
 {id:'buccolingual',name:'唇舌向',h:'唇舌 (mm)',v:'牙长轴 (mm)',pre:[],post:[]},
 {id:'mesiodistal',name:'近远中向',h:'近远中 (mm)',v:'牙长轴 (mm)',pre:[],post:[]},
 {id:'horizontal',name:'水平向',h:'唇舌 (mm)',v:'近远中 (mm)',pre:[],post:[]},
];
function fillAccept(item){
 item=item||{groups:[],sections:PREP_SECTIONS};
 if(!item.sections?.length)item={...item,sections:PREP_SECTIONS};
 const body=$('accept-table').querySelector('tbody');body.replaceChildren();
 for(const group of item.groups){
  const head=document.createElement('tr');head.className='group';
  const cell=document.createElement('td');cell.colSpan=3;cell.textContent=group.name;head.append(cell);body.append(head);
  for(const row of group.rows){const tr=document.createElement('tr');for(const text of [row.item,row.standard,row.value]){const td=document.createElement('td');td.textContent=text;tr.append(td)}body.append(tr)}
 }
 const dirs=$('accept-dirs');dirs.replaceChildren();
 const root=$('accept-sections');root.replaceChildren();acceptStates.length=0;
 if(!item.sections.some(s=>s.id===acceptDir))acceptDir=item.sections[0]?.id||'buccolingual';
 for(const sec of item.sections){
  const button=document.createElement('button');button.type='button';button.textContent=sec.name;
  const wrap=document.createElement('div');
  const slider=document.createElement('input');slider.type='range';slider.min='0';slider.max='1000';slider.value='500';slider.style.width='100%';slider.setAttribute('aria-label',sec.name+'切平面位置');
  const readout=document.createElement('div');readout.className='muted';
  const canvas=document.createElement('canvas');
  wrap.append(slider,readout,canvas);root.append(wrap);
  const state={sec,canvas,readout,slider,wrap,button,map:null,t:.5};acceptStates.push(state);
  button.onclick=()=>showAcceptDir(sec.id);
  slider.addEventListener('input',()=>moveCut(state,Number(slider.value)/1000));
  canvas.addEventListener('click',event=>acceptClick(state,event));
  new ResizeObserver(()=>drawAcceptOne(state)).observe(canvas);
  dirs.append(button);
 }
 showAcceptDir(acceptDir);
}
function axisExtent(meshes,axis){
 let min=Infinity,max=-Infinity;
 for(const mesh of meshes){const pos=mesh.pos;for(let i=axis;i<pos.length;i+=3){if(pos[i]<min)min=pos[i];if(pos[i]>max)max=pos[i]}}
 if(!Number.isFinite(min))return {min:-5,max:5};
 return {min,max};
}
function setupAcceptRanges(){
 const all=[...acceptCut.pre,...acceptCut.post];
 for(const state of acceptStates){
  const dir=ACCEPT_AXES[state.sec.id];if(!dir)continue;
  state.dir=dir;state.range=axisExtent(all,dir.axis);
  state.span=projectSpan(all,dir.h,dir.v);
  state.origin=state.range.min+(state.range.max-state.range.min)*state.t;
 }
}
function projectSpan(meshes,h,v){
 let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
 for(const mesh of meshes){const pos=mesh.pos;for(let i=0;i<pos.length;i+=3){const x=pos[i+h],y=pos[i+v];if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y}}
 if(!Number.isFinite(minX))return {minX:-5,minY:-5,maxX:5,maxY:5};
 const pad=Math.max(maxX-minX,maxY-minY,1)*.06;
 return {minX:minX-pad,minY:minY-pad,maxX:maxX+pad,maxY:maxY+pad};
}
function sliceLines(meshes,axis,h,v,origin){
 const lines=[];
 for(const mesh of meshes){
  const pos=mesh.pos,f=mesh.f;
  for(let i=0;i<f.length;i+=3){
   const id=[f[i],f[i+1],f[i+2]],dist=id.map(k=>pos[k*3+axis]-origin),hits=[];
   for(let e=0;e<3;e++){
    const a=e,b=(e+1)%3,da=dist[a],db=dist[b];
    if((da<0&&db<0)||(da>0&&db>0))continue;
    const denom=da-db,t=denom===0?0:da/denom;
    if(t<0||t>1)continue;
    const pa=id[a]*3,pb=id[b]*3;
    hits.push([pos[pa+h]+(pos[pb+h]-pos[pa+h])*t, pos[pa+v]+(pos[pb+v]-pos[pa+v])*t]);
   }
   if(hits.length>=2)lines.push([hits[0],hits[1]]);
  }
 }
 return lines;
}
function td(text){const el=document.createElement('td');el.textContent=text;return el}
function fillUndercut(){
 const info=S().undercut||{};
 const body=$('undercut-table').querySelector('tbody');
 body.replaceChildren();
 const img=(S().images||[])[0];
 const pic=$('undercut-section');
 if(img){pic.hidden=false;pic.src=img.url;pic.alt=img.caption||'倒凹分层剖面'}
 else pic.hidden=true;
 const present=info['有倒凹'];
 const ratio=info['倒凹点占比_百分比'];
 const rows=[
  ['有无', present==null?'—':(present?'有倒凹':'无倒凹')],
  ['倒凹点占比', ratio==null?'—':Number(ratio).toFixed(2)+' %'],
  ['最大深度', info['最大深度_mm']==null?'—':Number(info['最大深度_mm']).toFixed(3)+' mm'],
  ['平均深度', info['平均深度_mm']==null?'—':Number(info['平均深度_mm']).toFixed(3)+' mm'],
  ['最小深度阈值', info['最小深度阈值_mm']==null?'—':Number(info['最小深度阈值_mm']).toFixed(2)+' mm'],
 ];
 for(const pair of rows){const tr=document.createElement('tr');tr.append(td(pair[0]),td(pair[1]));body.append(tr)}
 const faces=info['各牙面']||[];
 if(faces.length){
  const head=document.createElement('tr');head.className='group';
  head.append(td('牙面'),td('倒凹点数'),td('最大深度'),td('平均深度'));
  body.append(head);
  for(const face of faces){
   const tr=document.createElement('tr');
   tr.append(
    td(face['牙面']||''),
    td(face['倒凹点数']==null?'—':String(face['倒凹点数'])),
    td(face['最大深度_mm']==null?'—':Number(face['最大深度_mm']).toFixed(3)+' mm'),
    td(face['平均深度_mm']==null?'—':Number(face['平均深度_mm']).toFixed(3)+' mm'),
   );
   body.append(tr);
  }
 }
 const gate=info['有倒凹判定占比_百分比']??1;
 $('undercut-note').textContent=info['判定说明']||('倒凹点占比达到 '+gate+'% 记为有倒凹，不按角度判定。');
}
async function renderUndercut(ticket,doFit){
 $('panels').classList.remove('hidden');
 $('panels').classList.add('overlay-only');
 $('right-label').textContent='倒凹热力图';
 const pair=S();
 for(const p of panels){clear(p.group);clear(p.guides)}
 fillUndercut();
 const key=pair.right[0];
 if(!key){$('status').textContent='没有倒凹热力图';return}
 const model=await read(key);if(ticket!==serial)return;
 add(right,model);
 if(doFit)fitSoon();else draw(right);
 $('status').textContent='已加载 · 颜色表示倒凹深度';
}
function layoutPrep(on, side){
 const top=$('prep-top');
 const extra=side||$('accept-visual');
 if(on){
  if(!$('panels').parentElement.isSameNode(top))top.append($('panels'),$('views'));
  if(!extra.parentElement.isSameNode(top))top.append(extra);
  for(const id of ['accept-visual','undercut-visual']){
   const el=$(id);
   if(el!==extra&&el.parentElement&&el.parentElement.isSameNode(top))$('accept-numbers').before(el);
  }
  top.classList.remove('hidden');
 }else if($('panels').parentElement.isSameNode(top)){
  $('model-help').before($('panels'),$('views'));
  for(const id of ['accept-visual','undercut-visual']){
   const el=$(id);
   if(el.parentElement&&el.parentElement.isSameNode(top))$('accept-numbers').before(el);
  }
  top.classList.add('hidden');
 }
}
function showAcceptDir(id){
 acceptDir=id;
 for(const state of acceptStates){
  const on=state.sec.id===id;
  state.wrap.hidden=!on;state.button.setAttribute('aria-pressed',on?'true':'false');
  if(on){drawAcceptOne(state);if(state.dir)placeCutPlane(state)}
 }
}
function moveCut(state,t){
 state.t=t;
 if(state.range)state.origin=state.range.min+(state.range.max-state.range.min)*t;
 acceptPicks.delete(C().id+'/'+state.sec.id);
 drawAcceptOne(state);placeCutPlane(state);
}
function placeCutPlane(state){
 if(!state?.dir||state.origin==null)return;
 if(!cutPlane){
  cutPlane=new THREE.Mesh(new THREE.PlaneGeometry(1,1), new THREE.MeshBasicMaterial({color:0xff3344,transparent:true,opacity:.28,side:THREE.DoubleSide,depthWrite:false}));
  cutPlane.renderOrder=6;right.guides.add(cutPlane);
 }
 const span=Math.max((state.range?.max??0)-(state.range?.min??0),8)*1.35;
 cutPlane.scale.set(span,span,1);cutPlane.rotation.set(0,0,0);cutPlane.position.set(0,0,0);
 if(state.dir.axis===0){cutPlane.rotation.y=Math.PI/2;cutPlane.position.x=state.origin}
 else if(state.dir.axis===1){cutPlane.rotation.x=-Math.PI/2;cutPlane.position.y=state.origin}
 else cutPlane.position.z=state.origin;
 draw(right);
}
function acceptBounds(sec){
 let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
 for(const line of [sec.pre,sec.post])for(const p of line){minX=Math.min(minX,p[0]);minY=Math.min(minY,p[1]);maxX=Math.max(maxX,p[0]);maxY=Math.max(maxY,p[1])}
 if(!Number.isFinite(minX)){minX=-5;maxX=5;minY=-5;maxY=5}
 const pad=Math.max(maxX-minX,maxY-minY,1)*.08;
 return {minX:minX-pad,minY:minY-pad,maxX:maxX+pad,maxY:maxY+pad};
}
function drawAccept(){for(const state of acceptStates)drawAcceptOne(state)}
function drawAcceptOne(state){
 const canvas=state.canvas,box=state.span||acceptBounds(state.sec),ratio=Math.min(devicePixelRatio,2);
 const w=canvas.clientWidth||280,h=canvas.clientHeight||220;canvas.width=w*ratio;canvas.height=h*ratio;
 const ctx=canvas.getContext('2d');ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,w,h);
 const pad=26,spanX=box.maxX-box.minX,spanY=box.maxY-box.minY,scale=Math.min((w-pad*2)/spanX,(h-pad*2)/spanY);
 const ox=pad+(w-pad*2-spanX*scale)/2,oy=h-pad-(h-pad*2-spanY*scale)/2;
 const toX=x=>ox+(x-box.minX)*scale,toY=y=>oy-(y-box.minY)*scale;
 state.map={box,scale,ox,oy};
 ctx.fillStyle='#aebed0';ctx.font='11px Microsoft YaHei';ctx.fillText(state.sec.h,8,h-8);ctx.fillText(state.sec.v,8,14);
 const live=state.dir&&acceptCut.pre.length;
 if(live){
  const pre=sliceLines(acceptCut.pre,state.dir.axis,state.dir.h,state.dir.v,state.origin);
  const post=sliceLines(acceptCut.post,state.dir.axis,state.dir.h,state.dir.v,state.origin);
  strokeSegments(ctx,pre,'#5aa2ff',toX,toY);strokeSegments(ctx,post,'#ff6b6b',toX,toY);
  const mid=state.range.min+(state.range.max-state.range.min)*.5;
  state.readout.dataset.offset=(state.origin-mid).toFixed(2);
 }else{
  for(const [line,color] of [[state.sec.pre,'#5aa2ff'],[state.sec.post,'#ff6b6b']]){
   if(!line.length)continue;ctx.beginPath();line.forEach((p,i)=>{const x=toX(p[0]),y=toY(p[1]);i?ctx.lineTo(x,y):ctx.moveTo(x,y)});
   ctx.strokeStyle=color;ctx.lineWidth=1.6;ctx.stroke();
  }
 }
 const chosen=acceptPicks.get(C().id+'/'+state.sec.id)||[];
 ctx.strokeStyle='#f3bd45';ctx.fillStyle='#f3bd45';ctx.setLineDash([4,3]);
 for(let i=1;i<chosen.length;i++){ctx.beginPath();ctx.moveTo(toX(chosen[i-1][0]),toY(chosen[i-1][1]));ctx.lineTo(toX(chosen[i][0]),toY(chosen[i][1]));ctx.stroke()}
 ctx.setLineDash([]);
 for(const p of chosen){ctx.beginPath();ctx.arc(toX(p[0]),toY(p[1]),3.5,0,Math.PI*2);ctx.fill()}
 const offset=state.readout.dataset.offset;
 if(acceptMode==='line'&&chosen.length===2)state.readout.textContent=(offset?`切面 ${offset} mm · `:'')+Math.hypot(chosen[1][0]-chosen[0][0],chosen[1][1]-chosen[0][1]).toFixed(2)+' mm';
 else if(acceptMode==='angle'&&chosen.length===3){const deg=acceptAngle(chosen[0],chosen[1],chosen[2]);state.readout.textContent=deg==null?'—':deg.toFixed(1)+'°'}
 else if(chosen.length)state.readout.textContent=(offset?`切面 ${offset} mm · `:'')+(acceptMode==='angle'?'再点'+(3-chosen.length)+'处':'再点终点');
 else state.readout.textContent=offset?`切面 ${offset} mm`:'' ;
}
function strokeSegments(ctx,lines,color,toX,toY){
 if(!lines.length)return;ctx.beginPath();
 for(const [a,b] of lines){ctx.moveTo(toX(a[0]),toY(a[1]));ctx.lineTo(toX(b[0]),toY(b[1]))}
 ctx.strokeStyle=color;ctx.lineWidth=1.6;ctx.stroke();
}
function acceptAngle(a,b,c){
 const u=[a[0]-b[0],a[1]-b[1]],v=[c[0]-b[0],c[1]-b[1]],du=Math.hypot(u[0],u[1]),dv=Math.hypot(v[0],v[1]);
 if(du<1e-6||dv<1e-6)return null;
 return Math.acos(Math.max(-1,Math.min(1,(u[0]*v[0]+u[1]*v[1])/(du*dv))))*180/Math.PI;
}
function acceptClick(state,event){
 const rect=state.canvas.getBoundingClientRect(),map=state.map;if(!map)return;
 const mm=[map.box.minX+(event.clientX-rect.left-map.ox)/map.scale, map.box.minY+(map.oy-(event.clientY-rect.top))/map.scale];
 const key=C().id+'/'+state.sec.id,chosen=acceptPicks.get(key)||[],limit=acceptMode==='angle'?3:2;
 acceptPicks.set(key,chosen.length>=limit?[mm]:[...chosen,mm]);drawAcceptOne(state);
}
function setAcceptMode(mode){
 acceptMode=mode;$('accept-line').setAttribute('aria-pressed',mode==='line'?'true':'false');$('accept-angle').setAttribute('aria-pressed',mode==='angle'?'true':'false');
 $('accept-help').textContent=mode==='line'?'剖面图上点两点，量直线距离（mm）':'剖面图上依次点第一边、角点、第二边';
 acceptPicks.clear();drawAccept();
}
function choose(id){
 current=Math.max(0,data.cases.findIndex(c=>c.id===id));const c=C();$('title').textContent=c.name;
 const sc=shoulderById.get(c.id);
 if(sc&&!c.stages.some(s=>s.id==='shoulder'))c.stages.push({id:'shoulder',name:'肩台对照',left:[],right:[],metrics:shoulderMetrics(sc),notes:sc.notes||[],images:[]});
 if(!c.stages.length){$('stages').replaceChildren();$('title').textContent=c.name+'（无可展示产物）';return}
 $('stages').replaceChildren();for(const s of c.stages){const b=document.createElement('button');b.dataset.stage=s.id;b.textContent=s.name;b.onclick=()=>showStage(s.id);$('stages').append(b)}
 for(const b of $('cases').querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.case===c.id));
 const wanted=(location.hash.split('/')[1]||'').trim();
 showStage(c.stages.some(s=>s.id===wanted)?wanted:c.stages[0].id,true);
}
for(const c of data.cases){const b=document.createElement('button');b.className='case';b.dataset.case=c.id;b.textContent=c.name;b.onclick=()=>choose(c.id);$('cases').append(b)}
for(const b of $('views').querySelectorAll('[data-view]'))b.onclick=()=>{view=b.dataset.view;fit()};$('fit').onclick=fit;
$('reg-split').onclick=()=>{regOverlay=!regOverlay;showStage(stageId,true)};
for(const id of ['wire','back-grey','left-mode','display-mode','linked','axes','boundary','removed'])$(id).onchange=()=>render(false);
$('measure').onchange=()=>{delete $('measure-result').dataset.filled;if(!$('measure').checked)clearMeasureBin();syncMeasurePanel()};
right.host.addEventListener('pointerdown',e=>{if(!$('measure').checked||e.button!==0)return;measurePtr={x:e.clientX,y:e.clientY}});
right.host.addEventListener('pointerup',e=>{
 if(!$('measure').checked||e.button!==0||!measurePtr)return;
 const dx=e.clientX-measurePtr.x,dy=e.clientY-measurePtr.y;measurePtr=null;
 if(dx*dx+dy*dy>25)return;pickRightMeasure(e);
});
$('section-angle').oninput=section;$('show-section').onchange=section;new ResizeObserver(section).observe($('section-chart'));
$('accept-line').onclick=()=>setAcceptMode('line');$('accept-angle').onclick=()=>setAcceptMode('angle');
$('show-ring').onchange=showRing;$('ring-step').oninput=showRing;$('ring-start').onclick=()=>{$('ring-step').value=0;showRing()};$('ring-complete').onclick=()=>{$('ring-step').value=$('ring-step').max;showRing()};
window.addEventListener('hashchange',()=>{const id=location.hash.slice(1).split('/')[0];if(id&&id!==C().id)choose(id);else{const st=location.hash.split('/')[1];if(st&&st!==stageId)showStage(st)}});
const init=(location.hash.slice(1)||'').split('/');choose(init[0]||data.cases[0].id);if(init[1])showStage(init[1]);
