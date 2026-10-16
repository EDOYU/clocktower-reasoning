/* Script library and portable static-site export. Works from file:// and HTTP. */
(() => {
  'use strict';
  const key='clocktower-scripts-v1',roles=CLOCKTOWER_DATA.roles;
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function validate(value,checkAbilities=true){
    if(!value||typeof value!=='object'||value.version!==1)throw Error('不支持的剧本格式。');
    const name=typeof value.name==='string'?value.name.trim():'';
    if(!name||name.length>60)throw Error('剧本名称须为1至60字。');
    if(!Number.isInteger(value.seats)||value.seats<2||value.seats>24)throw Error('人数须为2至24。');
    if(!Number.isInteger(value.hp)||value.hp<1||value.hp>99)throw Error('生命值须为1至99。');
    if(!value.quantities||typeof value.quantities!=='object'||!Array.isArray(value.roleIds))throw Error('缺少角色池或类别数量。');
    const roleIds=[...new Set(value.roleIds)];
    for(const id of roleIds){const role=roles.find(r=>r.id===id);if(!role||role.initial===false)throw Error('角色池包含无效或不能初始登场的角色。');}
    const quantities={};let total=0;
    for(const type of ['冒险者','NPC','喽喽','强敌']){
      const n=value.quantities[type];if(!Number.isInteger(n)||n<0||n>24)throw Error('类别数量无效：'+type);
      if(roleIds.filter(id=>roles.find(r=>r.id===id).type===type).length<n)throw Error(type+'角色池数量不足。');
      quantities[type]=n;total+=n;
    }
    if(total!==value.seats)throw Error(`类别共${total}名，须与人数${value.seats}一致。`);
    if(!quantities['冒险者']&&!quantities.NPC||!quantities['喽喽']&&!quantities['强敌'])throw Error('剧本须同时包含善良角色和魔物。');
    if(quantities['喽喽']&&roleIds.includes('eremite')&&(!quantities['冒险者']||roleIds.filter(id=>roles.find(r=>r.id===id).type==='NPC').length<quantities.NPC+1))throw Error('含镀金旅团时，须预留至少1名冒险者以及额外1名NPC候选。');
    if(checkAbilities)GameEngine.validateScript({...value,roleIds,quantities});
    const id=typeof value.id==='string'&&/^[\w-]{1,80}$/.test(value.id)?value.id:'script-'+crypto.randomUUID();
    return {version:1,id,name,seats:value.seats,hp:value.hp,roleIds,quantities};
  }
  const library=new Map();
  for(const value of globalThis.CLOCKTOWER_SCRIPTS||[])try{const s=validate(value,false);library.set(s.id,s);}catch{}
  try{for(const value of JSON.parse(localStorage.getItem(key)||'[]')){const s=validate(value,false);library.set(s.id,s);}}catch{}
  function all(){return [...library.values()].map(s=>structuredClone(s));}
  function save(s){s=validate(s);library.set(s.id,s);persist();return s;}
  function persist(){try{localStorage.setItem(key,JSON.stringify(all()));}catch{}}
  function remove(id){library.delete(id);persist();}
  function download(name,data,type='application/json'){
    const url=URL.createObjectURL(new Blob([data],{type})),a=document.createElement('a');
    a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
  const encoder=new TextEncoder();
  function zip(files){
    const table=Array.from({length:256},(_,i)=>{for(let j=0;j<8;j++)i=i&1?0xedb88320^(i>>>1):i>>>1;return i>>>0;});
    const chunks=[],central=[];let offset=0,size=0;
    const header=n=>{const a=new Uint8Array(n);return [a,new DataView(a.buffer)];};
    for(const [name,content] of Object.entries(files)){
      const data=typeof content==='string'?encoder.encode(content):content,path=encoder.encode(name);
      let crc=0xffffffff;for(const b of data)crc=table[(crc^b)&255]^(crc>>>8);crc=(crc^0xffffffff)>>>0;
      const [h,v]=header(30);v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint32(14,crc,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,path.length,true);
      const [c,d]=header(46);d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,0x800,true);d.setUint32(16,crc,true);d.setUint32(20,data.length,true);d.setUint32(24,data.length,true);d.setUint16(28,path.length,true);d.setUint32(42,offset,true);
      chunks.push(h,path,data);central.push(c,path);offset+=h.length+path.length+data.length;size+=c.length+path.length;
    }
    const [end,e]=header(22);e.setUint32(0,0x06054b50,true);e.setUint16(8,Object.keys(files).length,true);e.setUint16(10,Object.keys(files).length,true);e.setUint32(12,size,true);e.setUint32(16,offset,true);
    return new Blob([...chunks,...central,end],{type:'application/zip'});
  }
  function base64(bytes){let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(binary);}
  async function exportBase(){
    if(globalThis.CLOCKTOWER_SITE_BUNDLE)return CLOCKTOWER_SITE_BUNDLE;
    if(location.protocol!=='file:'&&Array.isArray(globalThis.CLOCKTOWER_SITE_FILES)){
      const entries=await Promise.all(CLOCKTOWER_SITE_FILES.map(async name=>{const response=await fetch(name,{cache:'no-cache'});if(!response.ok)throw Error('无法读取游戏文件：'+name);return [name,base64(new Uint8Array(await response.arrayBuffer()))];}));
      return Object.fromEntries(entries);
    }
    await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='site-bundle.js';s.onload=resolve;s.onerror=()=>{s.remove();reject(Error('请从已部署的网站导出，或使用完整版文件夹进行离线导出。'));};document.head.append(s);});
    return CLOCKTOWER_SITE_BUNDLE;
  }
  async function exportSite(upload=false){
    const base=await exportBase(),files={};
    for(const [name,b64] of Object.entries(base))files[name]=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
    files['scripts.js']='globalThis.CLOCKTOWER_SCRIPTS='+JSON.stringify(all())+';\n';
    if(!upload)files['site-bundle.js']='globalThis.CLOCKTOWER_SITE_BUNDLE='+JSON.stringify(base)+';\n';
    const archive=zip(files);
    if(upload&&archive.size>25000000)throw Error('当前上传包超过25MB，请导出完整版后解压上传文件夹。');
    download(upload?'枫丹审判庭_含剧本上传版.zip':'枫丹审判庭_含剧本网页版.zip',archive,'application/zip');
  }
  function open(onPlay,onChange){
    const dialog=document.querySelector('#workshop');let editing=null;
    const render=()=>{
      dialog.innerHTML=`<button class="dialog-close" data-workshop-close aria-label="关闭">×</button><div class="eyebrow">SCRIPT WORKSHOP</div><h2>自定义剧本</h2><p>选择本次可登场的角色，再设置冒险者、NPC、喽喽和强敌的数量。开局从角色池随机抽取。</p><div class="workshop-toolbar"><button class="secondary-button" id="script-new">新建剧本</button><label class="secondary-button">导入剧本<input id="script-import" type="file" accept=".json,application/json" hidden></label><button class="secondary-button" id="site-export-upload">导出上传版（25MB内）</button><button class="secondary-button" id="site-export">导出完整版</button></div><p class="workshop-message" role="status"></p><div class="script-library">${all().map(s=>`<article><div><strong>${esc(s.name)}</strong><small>${s.seats}人 · ${s.hp}点生命</small></div><div><button data-play="${s.id}">开局</button><button data-edit="${s.id}">编辑</button><button data-export="${s.id}">导出剧本</button><button data-delete="${s.id}">删除</button></div></article>`).join('')||'<p>暂无保存的剧本。导出的网页版会包含这里保存的全部剧本，上传腾讯云后其他玩家也能看到。</p>'}</div><form id="script-editor" hidden></form>`;
      dialog.querySelector('[data-workshop-close]').onclick=()=>dialog.close();
      const message=t=>dialog.querySelector('.workshop-message').textContent=t;
      dialog.querySelector('#script-new').onclick=()=>edit(null);
      dialog.querySelector('#site-export-upload').onclick=async()=>{try{message('正在打包上传版与已保存剧本……');await exportSite(true);message('已导出25MB内的上传包。可上传ZIP或解压后的文件夹；部署后仍可导出剧本和网页版。');}catch(e){message(e.message);}};
      dialog.querySelector('#site-export').onclick=async()=>{try{message('正在打包剧本与游戏资源……');await exportSite();message('已导出。解压后将全部文件上传腾讯云，访客即可选择保存的剧本。');}catch(e){message(e.message);}};
      dialog.querySelector('#script-import').onchange=async e=>{try{const value=JSON.parse(await e.target.files[0].text());const values=Array.isArray(value)?value:[value];const valid=values.map(validate);valid.forEach(save);onChange?.();render();message('已导入'+valid.length+'个剧本。');}catch(e){message('导入失败：'+e.message);}};
      dialog.querySelectorAll('[data-play]').forEach(b=>b.onclick=()=>{dialog.close();onPlay(library.get(b.dataset.play));});
      dialog.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>edit(library.get(b.dataset.edit)));
      dialog.querySelectorAll('[data-export]').forEach(b=>b.onclick=()=>{const s=library.get(b.dataset.export);download(s.name+'.json',JSON.stringify(s,null,2));});
      dialog.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>{const s=library.get(b.dataset.delete);if(confirm('删除剧本“'+s.name+'”？')){remove(s.id);onChange?.();render();}});
    };
    const edit=value=>{
      editing=value;const form=dialog.querySelector('#script-editor');form.hidden=false;
      const selected=value?.roleIds||[];
      const quantities=value?.quantities||{'冒险者':5,'NPC':1,'喽喽':1,'强敌':1};
      form.innerHTML=`<h3>${value?'编辑剧本':'新建剧本'}</h3><div class="script-fields"><label>名称<input name="name" required maxlength="60" value="${esc(value?.name||'我的剧本')}"></label><label>人数<input name="seats" type="number" min="2" max="24" value="${value?.seats||8}" required></label><label>生命值<input name="hp" type="number" min="1" max="99" value="${value?.hp||10}" required></label></div><p id="script-total"></p>${['冒险者','NPC','喽喽','强敌'].map(type=>`<h4>${type} <label>数量 <input data-quantity="${type}" type="number" min="0" max="24" value="${quantities[type]}"></label></h4><div class="script-roles">${roles.filter(r=>r.type===type).map(r=>`<label title="${esc(r.effect)}"><span>${esc(r.name)}${r.initial===false?'（仅转化）':''}</span><input data-role="${r.id}" type="checkbox" ${selected.includes(r.id)?'checked':''} ${r.initial===false?'disabled':''}></label>`).join('')}</div>`).join('')}<p class="script-error" role="alert"></p><button class="ornate-button" type="submit">保存剧本</button>`;
      const total=()=>form.querySelector('#script-total').textContent='已配置 '+[...form.querySelectorAll('[data-quantity]')].reduce((n,e)=>n+Number(e.value),0)+' / '+form.elements.seats.value+' 名角色';
      form.oninput=total;total();form.onsubmit=e=>{e.preventDefault();try{const roleIds=[...form.querySelectorAll('[data-role]:checked:not(:disabled)')].map(e=>e.dataset.role),quantities=Object.fromEntries([...form.querySelectorAll('[data-quantity]')].map(e=>[e.dataset.quantity,Number(e.value)]));save({version:1,id:editing?.id,name:form.elements.name.value,seats:Number(form.elements.seats.value),hp:Number(form.elements.hp.value),roleIds,quantities});onChange?.();render();}catch(e){form.querySelector('.script-error').textContent=e.message;}};
      form.scrollIntoView({block:'start',behavior:'smooth'});
    };
    render();dialog.showModal();
  }
  globalThis.ClocktowerWorkshop={all,save,validate,open,exportSite,zip};
})();
