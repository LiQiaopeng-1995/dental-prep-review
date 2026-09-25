import { DISPLAY_PALETTE, SHOULDER_IDS, SHOULDER_NAMES } from './anatomical_palette.js';
import * as THREE from 'three';
import {PanelRenderer,ModelCache} from './render_runtime.js';
import {OrbitControls} from './vendor/OrbitControls.js';
const $=id=>document.getElementById(id),panels=[],cache=new ModelCache();
window.addEventListener('error',e=>{$('fatal').textContent=e.message});window.addEventListener('unhandledrejection',e=>{$('fatal').textContent=String(e.reason)});
const response=await fetch('./anatomical_manifest.json',{cache:'no-store'});if(!response.ok)throw Error('无法读取纠正结果');const data=await response.json();
let current=0,serial=0,sync=false,sectionData=null,boundaryData=null,view='front';const C=()=>data.cases[current];
const dirs={front:[0,-1,.1],back:[0,1,.1],sideA:[1,0,.1],sideB:[-1,0,.1],top:[0,0,1],bottom:[0,0,-1]};
function draw(p){p.renderer.render(p.scene,p.camera)}
function panel(id){
 const host=$(id),scene=new THREE.Scene();scene.background=new THREE.Color('#19222d');const camera=new THREE.PerspectiveCamera(36,1,.03,1000);camera.up.set(0,0,1);camera.position.set(0,-35,5);
 const renderer=new PanelRenderer();renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;host.appendChild(renderer.domElement);
 const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=false;controls.minDistance=.1;controls.maxDistance=300;const group=new THREE.Group(),guides=new THREE.Group();scene.add(group,guides,new THREE.AmbientLight(0xffffff,1.5));
 const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(2,2,4);camera.add(light);scene.add(camera);const p={host,scene,camera,renderer,controls,group,guides};panels.push(p);
 new ResizeObserver(()=>{renderer.setSize(host.clientWidth,host.clientHeight,false);camera.aspect=host.clientWidth/host.clientHeight;camera.updateProjectionMatrix();draw(p)}).observe(host);
 controls.addEventListener('change',()=>{draw(p);if(sync)return;sync=true;for(const q of panels){if(q===p)continue;q.camera.position.copy(camera.position);q.camera.quaternion.copy(camera.quaternion);q.camera.up.copy(camera.up);q.controls.target.copy(controls.target);q.controls.update();draw(q)}sync=false});return p;
}
const left=panel('left'),right=panel('right');
async function read(info){
 if(cache.has(info.url))return cache.get(info.url);
 const promise=(async()=>{const res=await fetch(info.url);if(!res.ok)throw Error('无法读取模型 '+info.url);const raw=await res.arrayBuffer(),h=new DataView(raw),nv=h.getUint32(0,true),nf=h.getUint32(4,true);if(raw.byteLength!==8+nv*40+nf*12)throw Error('模型不完整');
 const a=new Float32Array(raw,8,nv*10),f=new Uint32Array(raw,8+nv*40,nf*3),pos=new Float32Array(nv*3),norm=new Float32Array(nv*3),rgb=new Float32Array(nv*3);for(let i=0;i<nv;i++)for(let j=0;j<3;j++){pos[i*3+j]=a[i*10+j];norm[i*3+j]=a[i*10+3+j];rgb[i*3+j]=a[i*10+6+j]}const labels=new Uint16Array(nv);for(let i=0;i<nv;i++)labels[i]=a[i*10+9];return {pos,norm,rgb,f,nv,labels};})();cache.set(info.url,promise);return promise;
}
function clear(group){for(const o of [...group.children]){o.geometry?.dispose();o.material?.dispose();group.remove(o)}}
function add(p,m,tint=null,order=0){
 const g=new THREE.BufferGeometry(),rgb=new Float32Array(m.nv*3),col=new THREE.Color(),mode=$('display-mode').value;
 for(let i=0;i<m.nv;i++){const label=m.labels[i];if(m===p.original)col.setRGB(m.rgb[i*3],m.rgb[i*3+1],m.rgb[i*3+2]).convertSRGBToLinear();
  else if(mode==='grey')col.set('#b2becb');else if(mode==='shoulder'&&label<6)col.set('#596b7d');
  else {col.set(DISPLAY_PALETTE[label]||DISPLAY_PALETTE[0])}col.toArray(rgb,i*3)}
 g.setAttribute('position',new THREE.BufferAttribute(m.pos,3));g.setAttribute('normal',new THREE.BufferAttribute(m.norm,3));g.setAttribute('color',new THREE.BufferAttribute(rgb,3));g.setIndex(new THREE.BufferAttribute(m.f,1));
 const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.85,metalness:0,side:THREE.DoubleSide,wireframe:$('wire').checked});
 if($('back-grey').checked&&m!==p.original){material.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\nif (!gl_FrontFacing) diffuseColor.rgb = vec3(0.32, 0.38, 0.45);')};material.customProgramCacheKey=()=> 'r9-back-grey'}
 p.group.add(new THREE.Mesh(g,material));
 if($('boundary').checked&&m!==p.original){const edges=new Map(),weld=new Map(),ids=[];for(let i=0;i<m.nv;i++){const k=[m.pos[3*i],m.pos[3*i+1],m.pos[3*i+2]].map(x=>x.toFixed(5)).join(',');if(!weld.has(k))weld.set(k,i);ids.push(weld.get(k))}
 for(let i=0;i<m.f.length;i+=3)for(const [a,b] of [[0,1],[1,2],[2,0]]){let u=ids[m.f[i+a]],v=ids[m.f[i+b]];if(u>v)[u,v]=[v,u];const k=u+','+v;edges.set(k,(edges.get(k)||0)+1)}
 const pts=[];for(const [k,n] of edges)if(n===1)for(const id of k.split(',').map(Number))pts.push(...m.pos.slice(id*3,id*3+3));addLines(p.group,pts,'#ec85db',3)}
 if(p===right&&$('linked').checked&&boundaryData)addLines(p.group,boundaryData.lines.flat(2),'#f5f1d5',4);
 if(p===right&&$('axes').checked){const b=C().bounds,c=b[0].map((x,i)=>(x+b[1][i])/2),frame=C().report.direction_prior;
  for(const [key,color] of [['buccal','#63b4fa'],['mesial','#55c9a1'],['vertical','#f3bd45']]){const end=c.map((x,i)=>x+frame[key][i]*5);addLines(p.group,[...c,...end],color,6)}}
}
function addLines(group,pts,color,order){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pts,3));const line=new THREE.LineSegments(g,new THREE.LineBasicMaterial({color,depthTest:order===4,transparent:true,opacity:.88}));line.renderOrder=order;group.add(line)}
function fit(){
 const b=new THREE.Box3(new THREE.Vector3(...C().bounds[0]),new THREE.Vector3(...C().bounds[1])),center=b.getCenter(new THREE.Vector3()),r=b.getSize(new THREE.Vector3()).length()/2,dir=new THREE.Vector3(...dirs[view]).normalize();sync=true;
 for(const p of panels){const vf=THREE.MathUtils.degToRad(p.camera.fov),hf=2*Math.atan(Math.tan(vf/2)*p.camera.aspect);p.controls.target.copy(center);p.camera.position.copy(center).addScaledVector(dir,r/Math.sin(Math.min(vf,hf)/2)*1.08);p.camera.up.set(0,view==='top'||view==='bottom'?1:0,view==='top'||view==='bottom'?0:1);p.camera.lookAt(center);p.controls.update();draw(p)}sync=false;
 for(const b of $('views').querySelectorAll('[data-view]'))b.setAttribute('aria-pressed',String(b.dataset.view===view));
}
function section(){
 if(!sectionData)return;const s=sectionData[Number($('section-angle').value)],angle=s.angle_deg*Math.PI/180;$('angle-value').textContent=s.angle_deg+'°';$('section-evidence').textContent=s.evidence.map((e,i)=>(i?'另一侧':'本侧')+'：'+(e.supported?'有肩台候选证据':'肩台证据不足')+'（径向展宽 '+e.width_mm.toFixed(2)+' mm）').join('；');
 for(const [p,key,color] of [[left,$('left-mode').value==='original'?'original':'before','#f3ba65'],[right,'after','#54e0dc']]){clear(p.guides);if($('show-section').checked){const pts=[];for(const line of s.layers3d[key])for(const point of line)pts.push(...point);addLines(p.guides,pts,color,5)}draw(p)}
 const canvas=$('section-chart'),ratio=Math.min(devicePixelRatio,2),w=canvas.clientWidth||700,h=310;canvas.width=w*ratio;canvas.height=h*ratio;const ctx=canvas.getContext('2d');ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,w,h);
 const points=[...s.layers.before.flat(),...s.layers.after.flat()];if(!points.length)return;let xmin=Math.min(...points.map(p=>p[0]))-1.5,xmax=Math.max(...points.map(p=>p[0]))+1.5,ymin=Math.min(...points.map(p=>p[1]))-1,ymax=Math.max(...points.map(p=>p[1]))+.6;
 const scale=Math.min((w-90)/(xmax-xmin),(h-50)/(ymax-ymin)),ox=(w-scale*(xmax-xmin))/2,oy=22;const xy=(p)=>[ox+(p[0]-xmin)*scale,oy+(ymax-p[1])*scale];
 ctx.strokeStyle='#2c4052';ctx.fillStyle='#92a6bb';ctx.font='11px sans-serif';ctx.lineWidth=1;
 for(let x=Math.ceil(xmin);x<=xmax;x++){const a=xy([x,ymin]),b=xy([x,ymax]);ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke();ctx.fillText(x+'',a[0]-3,a[1]+16)}
 for(let z=Math.ceil(ymin);z<=ymax;z++){const a=xy([xmin,z]),b=xy([xmax,z]);ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke();ctx.fillText(z+'',a[0]-24,a[1]+4)}
 for(const [key,color,width] of [['original','#788697',1.3],['before','#f3ba65',3.8],['after','#54e0dc',1.8],['shoulder','#ff5548',3]]){ctx.save();ctx.beginPath();ctx.rect(ox,oy,(xmax-xmin)*scale,(ymax-ymin)*scale);ctx.clip();ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();for(const line of s.layers[key]){ctx.moveTo(...xy(line[0]));ctx.lineTo(...xy(line[1]))}ctx.stroke();ctx.restore()}
 ctx.fillStyle='#aebed0';ctx.fillText('mm',w-30,h-10);
}
async function render(doFit=false){
 const ticket=++serial,c=C();$('status').textContent='加载模型与剖线…';const keys=['original','before','after'];
 const results=await Promise.all([...keys.map(k=>read(c.models[k])),fetch(c.sections_url).then(r=>{if(!r.ok)throw Error('剖线数据无法读取');return r.json()}),fetch(c.boundaries_url).then(r=>{if(!r.ok)throw Error('关联边界无法读取');return r.json()})]);if(ticket!==serial)return;
 const m=Object.fromEntries(keys.map((k,i)=>[k,results[i]]));sectionData=results[3];boundaryData=results[4];for(const p of panels){clear(p.group);p.original=m.original}
 add(left,m[$('left-mode').value]);add(right,m.after);$('left-label').textContent=$('left-mode').value==='original'?'原扫描邻域':'上一版 R6 · 原始命名';if(doFit)fit();section();$('status').textContent='已加载 · 左右视图联动';
}
function metric(label,val){const e=document.createElement('div');e.className='metric';const b=document.createElement('b');b.textContent=val;e.append(document.createTextNode(label),b);$('metrics').append(e)}
function choose(id){
 current=Math.max(0,data.cases.findIndex(c=>c.id===id));const c=C(),r=c.report;$('title').textContent=c.name;$('assessment').textContent=c.assessment;$('registration-link').href='./registration.html?stage=registration#'+c.case_id;$('baseline-link').href=c.baseline_url;
 $('audit-link').href=c.audit_url;$('tooth-link').href=c.download_url;$('metrics').replaceChildren();metric('单连通牙面','5 / 5');metric('连续肩台段',r.anatomical_shoulder_segment_count+' / 最多 4');metric('颈缘平均调整',r.cervical.mean_trim_mm.toFixed(3)+' mm');metric('肩台面积',r.final_shoulder_area_mm2.toFixed(2)+' mm²');
 $('notes').replaceChildren();for(const note of c.notes){const li=document.createElement('li');li.textContent=note;$('notes').append(li)}
 for(const b of $('cases').querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.case===c.id));history.replaceState(null,'','#'+c.id);render(true);
}
for(const c of data.cases){const b=document.createElement('button');b.className='case';b.dataset.case=c.id;b.textContent=c.name;b.onclick=()=>choose(c.id);$('cases').append(b)}
for(const [sid,name] of [[1,'切端 / 咬合面'],[2,'唇面'],[3,'舌面'],[4,'近中'],[5,'远中'],...SHOULDER_IDS.map(id=>[id,SHOULDER_NAMES[id]])]){const item=document.createElement('span');item.textContent='● '+name;item.style.color=DISPLAY_PALETTE[sid];$('legend').append(item)}

for(const b of $('views').querySelectorAll('[data-view]'))b.onclick=()=>{view=b.dataset.view;fit()};$('fit').onclick=fit;
for(const id of ['left-mode','display-mode','linked','axes','back-grey','boundary','wire'])$(id).onchange=()=>render(false);$('section-angle').oninput=section;$('show-section').onchange=section;
new ResizeObserver(section).observe($('section-chart'));window.addEventListener('hashchange',()=>choose(location.hash.slice(1)));choose(location.hash.slice(1)||'pack2_11_2');
