(() => {
  'use strict';
  const {roles, rules, art}=CLOCKTOWER_DATA, roleMap=GAME_ROLES;
  const $=s=>document.querySelector(s), app=$('#app'), STORAGE='clocktower-web-v1';
  const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const portrait=(id,extra='')=>{const a=art[id];return a?`<div class="portrait ${extra}" role="img" aria-label="${escape(roleMap[id].name)}" style="background-image:url('assets/${a.sheet}');background-position:${a.x}% ${a.y}%;${a.full?'background-size:100% 100%;':''}"></div>`:`<div class="portrait ${extra} card-back-art" aria-hidden="true"></div>`;};
  let difficulty='easy',game=null,menu=true,selected=null,mode='investigate',source=null,targets=[],marks={},notes='',journalTab='log',logPage=0;
  let selectedScript=null,identityQueue=[];
  let saved=null,toastTimer,unmaskTimer,modalAction=null,catalogueFilter='全部',catalogueSearch='',sound=false,audio;
  const nightDeaths=new Map();
  let rosterTipAnchor=null,rosterTipTimer;
  let positionFrame=null;
  const silentSpeech=new Set(['选择目标后，可以使用我的主动能力。','我没有在翻开时提供线索的能力。']);
  function latestDialogue(i,v){
    if(!v.revealed||game.abilityRole(i)==='pyro_slime')return '';
    const history=game.s(i).history;
    for(let j=history.length-1;j>=0;j--)if(history[j].text&&!silentSpeech.has(history[j].text))return history[j].text;
    return v.speech&&!silentSpeech.has(v.speech)?v.speech:'';
  }
  function clearFeedback(){
    hideRosterTooltip();
    identityQueue=[];clearTimeout(unmaskTimer);if($('#reveal-overlay'))$('#reveal-overlay').hidden=true;
    for(const event of nightDeaths.values())clearTimeout(event.timer);nightDeaths.clear();
  }
  function positionRoleDialogues(){
    const arena=$('.table-arena');if(!arena||game?.seats.length>12)return;
    const mobile=matchMedia('(max-width:800px)').matches;
    const bubbles=[...app.querySelectorAll('[data-dialogue-seat]')];
    for(const bubble of bubbles){
      arena.querySelector(`[data-slot="${bubble.dataset.dialogueSeat}"]`).append(bubble);
      bubble.style.cssText='';
    }
    const cards=[...arena.querySelectorAll('[data-seat]')];
    if(mobile){for(const card of cards)card.style.removeProperty('left'),card.style.removeProperty('top'),card.style.removeProperty('width');return;}
    const width=arena.clientWidth,height=arena.clientHeight,half=cards.length/2;
    const cardHeight=Math.min(118,(height-22)/half-7),cardWidth=cardHeight*.77;
    const speechWidth=Math.max(112,Math.min(180,width*.25-cardWidth/2-16));
    cards.forEach((card,j)=>{
      const right=j<half,row=right?j:cards.length-1-j;
      const y=11+(row+.5)*(height-22)/half;
      const arc=Math.sin(Math.PI*(row+.5)/half),x=width*(right?.58+arc*.16:.42-arc*.16);
      card.style.left=x+'px';card.style.top=y+'px';card.style.width=cardWidth+'px';
      const bubble=arena.querySelector(`[data-dialogue-seat="${j+1}"]`);if(!bubble)return;
      bubble.style.width=speechWidth+'px';
      bubble.style.left=(right?x+cardWidth/2+9:x-cardWidth/2-9-speechWidth)+'px';
      bubble.style.top=Math.max(2,Math.min(height-bubble.offsetHeight-2,y-bubble.offsetHeight/2))+'px';
      bubble.classList.toggle('right-of-card',right);bubble.classList.toggle('left-of-card',!right);
    });
  }
  function animateNightDeath(i){
    const event={started:performance.now(),timer:null};nightDeaths.set(i,event);
    event.timer=setTimeout(()=>{if(nightDeaths.get(i)!==event)return;nightDeaths.delete(i);const seat=app.querySelector(`[data-seat="${i}"]`);seat?.classList.remove('night-fatality');seat?.querySelector('.night-impact')?.remove();},2100);
  }
  function refreshDialoguePositions(){if(positionFrame!==null)return;positionFrame=requestAnimationFrame(()=>{positionFrame=null;if(!menu&&innerWidth>800)renderGame();else positionRoleDialogues();});}
  window.addEventListener('resize',refreshDialoguePositions);
  try{const raw=localStorage.getItem(STORAGE);if(raw){const value=JSON.parse(raw);game=GameEngine.restore(value.game);saved=value;difficulty=game.difficulty;selectedScript=game.script;marks=value.marks||{};notes=typeof value.notes==='string'?value.notes:'';}}catch{game=null;saved=null;}
  function canSelectSkill(i){
    const v=game.view(i),role=roleMap[game.abilityRole(i)];
    return game.phase==='playing'&&!game.pendingNight&&game.targetCount(i)>0&&v.alive&&v.revealed&&Boolean(role.targets)&&!(role.once&&v.used);
  }
  function beginSkill(i){
    source=null;targets=[];mode='investigate';
    if(canSelectSkill(i)){source=i;mode='skill';}
  }
  function rosterHTML(){
    const counts=new Map(Object.entries(game.roster()));
    return `<section class="case-roster" aria-label="本局登场角色"><div class="roster-title">本局登场<small>仅公布种类，不对应座位</small></div>${['NPC','喽喽','强敌'].map(type=>{
      const present=roles.filter(r=>r.type===type&&counts.has(r.id));
      const unknown=counts.get('unknown-'+type)||0;
      return `<div class="roster-group" data-roster-type="${type}"><h3>${type}<small>${present.reduce((n,r)=>n+counts.get(r.id),unknown)} 位</small></h3><div>${present.length?present.map(r=>`<span class="roster-role" tabindex="0" data-roster-role="${r.id}">${escape(r.name)}${counts.get(r.id)>1?` ×${counts.get(r.id)}`:''}</span>`).join(''):unknown?'<span class="roster-none">身份不明</span>':'<span class="roster-none">无</span>'}</div></div>`;
    }).join('')}</section>`;
  }
  function hideRosterTooltip(){
    clearTimeout(rosterTipTimer);rosterTipAnchor?.removeAttribute('aria-describedby');rosterTipAnchor=null;$('#roster-tooltip').hidden=true;
  }
  function showRosterTooltip(anchor){
    clearTimeout(rosterTipTimer);rosterTipAnchor?.removeAttribute('aria-describedby');rosterTipAnchor=anchor;
    const role=roleMap[anchor.dataset.rosterRole],tip=$('#roster-tooltip');
    tip.innerHTML=`<div class="roster-tooltip-head">${portrait(role.id)}<div><h3>${escape(role.name)}</h3><small>${escape(role.type)}</small></div></div><p>${escape(role.effect)}</p>${role.hint!=='无'?`<p class="roster-tooltip-hint">提示：${escape(role.hint)}</p>`:''}`;
    tip.hidden=false;anchor.setAttribute('aria-describedby','roster-tooltip');
    const box=anchor.getBoundingClientRect(),gap=10,pad=12;
    tip.style.left=Math.max(pad,Math.min(box.left,innerWidth-tip.offsetWidth-pad))+'px';
    tip.style.top=Math.max(pad,Math.min(box.bottom+gap,innerHeight-tip.offsetHeight-pad))+'px';
  }
  function deferHideRosterTooltip(){rosterTipTimer=setTimeout(hideRosterTooltip,120);}
  $('#roster-tooltip').onpointerenter=()=>clearTimeout(rosterTipTimer);
  $('#roster-tooltip').onpointerleave=deferHideRosterTooltip;
  window.addEventListener('scroll',e=>{if(!$('#roster-tooltip').contains(e.target))hideRosterTooltip();},true);
  window.addEventListener('resize',hideRosterTooltip);
  function centerHTML(ended){
    if(game.pendingNight&&!ended)return `<div class="center-skill"><small>夜晚 · 涡津御建鸣神命</small><h2>选择存活角色</h2><p>已选择 <strong>${targets.length} / ${game.pendingNight.required}</strong><br>随机最多两人死亡，善良角色每人扣2点生命</p><div class="center-targets">${targets.map(i=>i+'号').join('、')||'点击存活角色，免死者不会被抽中'}</div><button class="center-cancel" id="confirm-night" ${targets.length===game.pendingNight.required?'':'disabled'}>确认夜晚选择</button></div>`;
    if(mode==='skill'&&!ended){
      const role=roleMap[game.abilityRole(source)];
      return `<div class="center-skill"><small>${String(source).padStart(2,'0')}号 · ${role.name}</small><h2>选择技能目标</h2><p>已选择 <strong>${targets.length} / ${game.targetCount(source)}</strong><br>选满后自动发动</p><div class="center-targets">${targets.length?targets.map(i=>i+'号').join('、'):(game.abilityRole(source)==='sigewinne'?'点击圆桌上的死亡角色':'点击圆桌上的目标角色')}</div><button class="center-cancel" id="cancel-skill">取消发动技能</button></div>`;
    }
    return `<span class="scales-symbol" aria-hidden="true">⚖</span><h2>${ended?(game.phase==='won'?'真相大白':'长夜未尽'):'圆桌调查'}</h2><p>${ended?'顺时针递增 · 身份已公开':'座位按顺时针递增 · 死亡保留座次'}</p><div class="night-counter">${ended?'本局已结束':`距下一次夜晚 <strong>${rules.nightEvery-game.flips%rules.nightEvery}</strong> 次翻牌`}<div class="night-dots" aria-hidden="true">${Array.from({length:rules.nightEvery},(_,i)=>`<i class="${i<game.flips%rules.nightEvery?'on':''}"></i>`).join('')}</div></div>`;
  }
  function notice(message){const t=$('#toast');t.textContent=message;t.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('visible'),3300);}
  function persist(){
    if(!game)return;saved={game:game.serialize(),marks,notes};
    try{localStorage.setItem(STORAGE,JSON.stringify(saved));}catch{notice('浏览器无法保存进度；本次对局仍可继续。');}
  }
  function bell(kind='flip'){
    if(!sound)return;
    try{audio??=new (window.AudioContext||window.webkitAudioContext)();audio.resume();const base=kind==='night'?146:kind==='execute'?220:523;
      for(let i=0;i<3;i++){const oscillator=audio.createOscillator(),gain=audio.createGain(),at=audio.currentTime+i*.06;oscillator.type='sine';oscillator.frequency.value=base*[1,1.5,2][i];gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(.045/(i+1),at+.015);gain.gain.exponentialRampToValueAtTime(.001,at+.8);oscillator.connect(gain).connect(audio.destination);oscillator.start(at);oscillator.stop(at+.85);}
    }catch{sound=false;updateSound();}
  }
  function updateSound(){$('#sound').classList.toggle('sound-on',sound);$('#sound').setAttribute('aria-label',sound?'关闭音效':'开启音效');$('#sound').title=sound?'关闭音效':'开启音效';}
  function openModal(title,body,yes,action,danger=false){
    modalAction=action;const dialog=$('#modal');dialog.innerHTML=`<button class="dialog-close" data-dialog-close aria-label="关闭">×</button><div class="eyebrow">THE COURT OF FONTAINE</div><h2 id="modal-title" style="margin-top:12px">${escape(title)}</h2>${body}<div class="dialog-actions"><button class="secondary-button" data-dialog-close>取消</button><button class="ornate-button ${danger?'danger':''}" id="modal-confirm">${escape(yes)}</button></div>`;dialog.showModal();$('#modal-confirm').onclick=()=>{const fn=modalAction;modalAction=null;dialog.close();fn?.();};
  }
  function closeModal(){const d=$('#modal');d.close();modalAction=null;if(mode==='execute')setMode('investigate');}
  function renderMenu(){
    clearFeedback();
    if(selectedScript){const latest=ClocktowerWorkshop.all().find(s=>s.id===selectedScript.id);if(latest)selectedScript=latest;}
    document.body.classList.remove('executing','in-game','large-board','game-ended');
    $('#role-total').textContent=cataloguePool().length;
    const menuHP=selectedScript?.hp??rules.difficulties.find(d=>d.id===difficulty)?.hp??rules.hp;
    app.innerHTML=`<section class="hero fade-in"><div class="hero-copy"><div class="eyebrow">THE COURT OF FONTAINE</div><h1>枫丹审判庭</h1><p class="hero-subtitle">真相，藏在谎言之间。</p><p class="hero-description">审判庭的钟声已经响起。圆桌旁的每一位来客，<br>都拥有一个身份，也可能藏着另一个秘密。</p><div class="ornament-line"></div><div class="difficulty-grid" aria-label="选择难度">${rules.difficulties.map((d,i)=>`<button class="difficulty ${d.id===difficulty?'selected':''}" data-difficulty="${d.id}" aria-pressed="${d.id===difficulty}"><div class="seat-count">${d.seats}<small>席</small></div><h3>${d.name}</h3><p>${d.description.split(' · ')[1].replaceAll(' / ',' · ')}</p><span class="level">0${i+1}</span></button>`).join('')}</div><div class="custom-script-list">${ClocktowerWorkshop.all().map(s=>`<button class="secondary-button ${selectedScript?.id===s.id?'selected':''}" data-custom="${s.id}">${escape(s.name)} · ${s.seats}人 · ${s.hp}点生命</button>`).join('')}</div><div class="hero-actions"><button class="ornate-button" id="start">开始调查<span aria-hidden="true">→</span></button><button class="secondary-button workshop-open" id="open-workshop">配板与剧本</button>${saved?`<button class="secondary-button" id="continue">${game?.phase==='playing'?'继续调查':'复盘上局'}</button>`:''}</div><div class="hero-footnote"><span>${menuHP} 点生命</span><span>交叉核对证词</span><span>清除全部魔物</span></div></div><div class="hero-art" aria-hidden="true"><div class="hero-halo"></div><div class="hero-card left">${portrait('mona')}<div class="hero-name">莫娜</div><small>星象之中，另有真相</small></div><div class="hero-card right">${portrait('barbara')}<div class="hero-name">芭芭拉</div><small>请再听一次他的证词</small></div><div class="hero-card front">${portrait('furina')}<div class="hero-name">芙宁娜</div><small>让审判，揭开帷幕</small></div><div class="hero-caption">EVERY TESTIMONY HIDES A SECRET</div></div></section>`;
    app.querySelectorAll('[data-difficulty]').forEach(b=>b.onclick=()=>{difficulty=b.dataset.difficulty;selectedScript=null;renderMenu();});
    $('#open-workshop').onclick=()=>ClocktowerWorkshop.open(s=>{selectedScript=s;difficulty='custom';start();},renderMenu);
    app.querySelectorAll('[data-custom]').forEach(b=>b.onclick=()=>{selectedScript=ClocktowerWorkshop.all().find(s=>s.id===b.dataset.custom);difficulty='custom';renderMenu();});
    $('#start').onclick=()=>{if(game?.phase==='playing')openModal('开始新的调查？','<p>现有对局将被新的调查替换。角色和座次会重新抽取。</p>','开始调查',start);else start();};
    if($('#continue'))$('#continue').onclick=()=>{menu=false;difficulty=game.difficulty;selectedScript=game.script||null;selected=null;mode='investigate';renderGame();};
  }
  function start(){let next;try{next=selectedScript?GameEngine.fromScript(selectedScript):new GameEngine(difficulty);}catch(e){notice(e.message);return;}clearFeedback();game=next;marks={};notes='';selected=null;mode='investigate';source=null;targets=[];menu=false;persist();renderGame();window.scrollTo({top:0});bell();}
  function leave(){persist();menu=true;mode='investigate';source=null;targets=[];renderMenu();window.scrollTo({top:0});}
  function setMode(next){mode=next;source=null;targets=[];renderGame();}
  function renderSeats(){
    const n=game.seats.length,cw=n===6?'14%':n===8?'12%':'10.5%';
    return game.seats.map((s,j)=>{
      const i=j+1,v=game.view(i),angle=j*2*Math.PI/n,x=50+Math.sin(angle)*41,y=49-Math.cos(angle)*38;
      const open=Boolean(v.roleId),state=!v.alive?(v.death==='night'?'夜间遇害':'已处决'):canSelectSkill(i)?(source===i?'选择技能目标':'点击使用技能'):v.revealed?'已翻开':'点击翻开';
      const label=`${i}号 ${v.name}，${state}`;
      const dialogue=latestDialogue(i,v),fatality=nightDeaths.get(i),elapsed=fatality?performance.now()-fatality.started:0;
      return `<div class="seat-slot" data-slot="${i}"><button class="seat ${open?'is-open':''} ${canSelectSkill(i)?'skill-ready':''} ${!v.alive?'dead':''} ${fatality?'night-fatality':''} ${selected===i?'selected':''} ${source===i?'ability-source':''} ${targets.includes(i)?'targeted':''}" data-seat="${i}" style="--x:${x}%;--y:${y}%;--cw:${cw};--death-delay:-${elapsed}ms" aria-label="${escape(label)}" aria-pressed="${selected===i||targets.includes(i)}"><span class="seat-number">${String(i).padStart(2,'0')}</span><span class="seat-inner"><span class="seat-face seat-back card-back-art"><span class="back-caption">${!v.alive?'夜间遇害':'未知身份'}</span></span><span class="seat-face seat-front">${portrait(v.roleId)}<span class="seat-name">${escape(v.name)}</span><span class="seat-state">${state}</span></span></span>${fatality?'<span class="night-impact" aria-hidden="true"><span class="night-slashes"><i></i><i></i><i></i></span><span class="night-death-label">夜间遇害</span><span class="night-embers"><i></i><i></i><i></i><i></i><i></i></span></span>':''}${targets.includes(i)?`<span class="target-badge">目标 ${targets.indexOf(i)+1}</span>`:''}${marks[i]?`<span class="note-marker" title="${marks[i]==='suspect'?'疑似魔物':'暂可信任'}">${marks[i]==='suspect'?'?':'✓'}</span>`:''}</button>${dialogue?`<aside class="seat-speech ${!v.alive?'past-speaker':''} ${selected===i?'selected-speech':''}" data-dialogue-seat="${i}" aria-label="${i}号${escape(v.name)}的最新发言"><header><span>${String(i).padStart(2,'0')}</span><strong>${escape(v.name)}</strong><small>最新发言</small></header><p>${escape(dialogue)}</p></aside>`:''}</div>`;
    }).join('');
  }
  function detailHTML(){
    if(!selected)return `<div class="detail-empty"><span class="empty-emblem" aria-hidden="true"></span><h3>${game.phase!=='playing'?'点击角色复盘':'真相尚未揭晓'}</h3><p>${game.phase!=='playing'?'所有真实身份已公开。点击角色核对身份、异常状态和发言。<br><br>证词记录发言时的情况；后续死亡或身份变化不会改写原答案。':'直接点击圆桌上的角色牌。<br>翻牌后显示效果与提示。蓝色边框表示技能可用，再点一次选择目标。<br><br>善良角色也可能醉酒、中毒，或陷入疯狂。<br>请交叉核对证词，再作出你的裁决。'}</p></div>`;
    const v=game.view(selected),role=roleMap[game.abilityRole(selected)];
    const enabled=canSelectSkill(selected);
    return `<div class="detail-person">${portrait(v.roleId)}<div><h3>${escape(v.name)}</h3><small>座位 ${String(selected).padStart(2,'0')} · ${v.roleId?(v.evil===true?'魔物 · ':v.evil===false?'天理 · ':'')+v.type:'身份尚未公开'}</small></div></div><div class="section-label">角色效果</div><p class="effect-text">${escape(v.roleId?v.effect:"直接点击角色牌即可尝试翻开，并查看效果与提示。")}</p><div class="section-label">调查提示</div><p class="hint-text">${escape(v.hint==='无'?'该角色没有额外提示。':v.hint)}</p>${v.summary?`<p class="real-summary">真实状态：${escape(v.summary)}</p>`:''}<p class="skill-status">${!v.alive?'该角色已死亡':game.phase!=='playing'?'本局已结束':!v.roleId?'点击角色牌即可尝试翻开':role.once&&v.used?'本局技能次数已用完':enabled?(mode==='skill'&&source===selected?'正在选择技能目标；选满后自动发动。':'再次点击这张角色牌即可选择技能目标。'):'该角色没有主动技能。'}</p><div class="note-actions"><button data-mark="suspect" aria-pressed="${marks[selected]==='suspect'}">${marks[selected]==='suspect'?'取消疑点':'? 标记疑点'}</button><button data-mark="trust" aria-pressed="${marks[selected]==='trust'}">${marks[selected]==='trust'?'取消信任':'✓ 暂可信任'}</button></div>`;
  }
  function journalHTML(){
    const perPage=innerHeight<800?2:3,pages=Math.max(1,Math.ceil(game.logs.length/perPage));
    logPage=Math.max(0,Math.min(logPage,pages-1));
    const end=game.logs.length-logPage*perPage,start=Math.max(0,end-perPage);
    return game.logs.slice(start,end).map((log,j)=>`<div class="log-entry"><span class="log-number">${String(start+j+1).padStart(2,'0')}</span>${escape(log)}</div>`).join('')+`<div class="log-pages"><button data-log-page="1" ${logPage>=pages-1?'disabled':''}>较早</button><span>${start+1}–${end} / ${game.logs.length}</span><button data-log-page="-1" ${logPage===0?'disabled':''}>较新</button></div>`;
  }
  function renderGame(flip=null){
    hideRosterTooltip();
    if(menu||!game)return;const ended=game.phase!=='playing',evil=game.aliveList(i=>game.evil(i)).length,cfg=game.config;
    $('#role-total').textContent=cataloguePool().length;document.body.classList.add('in-game');document.body.classList.toggle('large-board',game.seats.length>12);document.body.classList.toggle('game-ended',ended);
    document.body.classList.toggle('executing',mode==='execute'&&!ended);
    const help=game.pendingNight?'夜幕降临：先选择指定数量的存活角色，再确认结算。':ended?'本局已结束。所有真实身份已公开，点击角色复盘。':mode==='skill'?'点击角色选择目标，选满后自动发动。圆盘中央可取消；再次点击已选目标可取消选择。':mode==='execute'?'点击角色立即处决。误杀善良扣 5 点；再次点击「处决」退出。':'点击翻牌；蓝框角色再次点击可用技能。每手动翻开 4 张牌进入夜晚。';
    app.innerHTML=`<section class="game-shell"><div class="game-heading"><h1 class="case-title">${escape(cfg.name)}<small>ROUND TABLE · ${cfg.seats}</small></h1><div class="status-strip"><div class="health ${game.hp<=4?'low':''}"><span class="health-bars" aria-hidden="true">${Array.from({length:game.maxHp},(_,i)=>`<i class="${i<game.hp?'':'empty'}"></i>`).join('')}</span>生命 <strong id="hp">${game.hp}</strong><span>/ ${game.maxHp}</span></div><span>魔物 <strong id="evil-count">${evil}</strong></span><span>手动翻牌 <strong id="flip-count">${game.flips}</strong></span></div></div>${rosterHTML()}${ended?`<div class="outcome ${game.phase}"><div><h2>${game.phase==='won'?'调查成功 · 真相大白':'调查失败 · 长夜未尽'}</h2><p>${game.phase==='won'?'全部魔物已被清除。审判庭迎来了黎明。':'生命已经耗尽。查看每个角色的真实身份，重新梳理证词。'}</p></div><button class="secondary-button" data-restart>再来一局</button></div>`:''}<div class="game-columns"><div class="investigation-area"><div class="table-arena"><div class="round-table" aria-hidden="true"></div><div class="table-center">${centerHTML(ended)}</div>${renderSeats()}</div><div class="mode-dock simple-dock" aria-label="调查操作"><button class="mode-button danger ${mode==='execute'?'active':''}" data-mode="execute" aria-pressed="${mode==='execute'}" ${ended||game.pendingNight?'disabled':''}><span class="mode-icon" aria-hidden="true">⚖</span>${mode==='execute'?'取消处决':'处决'}</button></div><p class="mode-hint" id="mode-hint">${help}</p></div><aside class="detail-panel"><div class="panel-ornament"></div><div class="panel-header"><h2>${selected?'角色详情':'调查手册'}</h2><small>CASE FILE</small></div><div class="detail-content">${detailHTML()}</div><div class="journal"><div class="journal-tabs"><button data-journal="log" class="${journalTab==='log'?'active':''}">调查记录</button><button data-journal="notes" class="${journalTab==='notes'?'active':''}">我的笔记</button><small>${game.logs.length} 条证词</small></div>${journalTab==='log'?`<div class="log-list" aria-label="调查记录">${journalHTML()}</div>`:`<textarea class="notebook" aria-label="我的调查笔记" placeholder="记下疑点，交叉核对每一句证词……">${escape(notes)}</textarea>`}</div><div class="panel-bottom"><button data-menu>← 返回难度选择</button><button data-restart>↻ 重新开局</button></div></aside></div></section>`;
    app.querySelectorAll('[data-seat]').forEach(b=>b.onclick=()=>seatClick(Number(b.dataset.seat)));
    app.querySelectorAll('[data-roster-role]').forEach(b=>{b.onpointerenter=()=>showRosterTooltip(b);b.onpointerleave=deferHideRosterTooltip;b.onfocus=()=>showRosterTooltip(b);b.onblur=deferHideRosterTooltip;b.onclick=()=>showRosterTooltip(b);});
    app.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>setMode(mode==='execute'?'investigate':'execute'));
    app.querySelectorAll('[data-restart]').forEach(b=>b.onclick=restartPrompt);
    app.querySelectorAll('[data-menu]').forEach(b=>b.onclick=leave);
    app.querySelectorAll('[data-mark]').forEach(b=>b.onclick=()=>{const mark=b.dataset.mark;if(marks[selected]===mark)delete marks[selected];else marks[selected]=mark;persist();renderGame();});
    app.querySelectorAll('[data-journal]').forEach(b=>b.onclick=()=>{journalTab=b.dataset.journal;renderGame();});
    if($('.notebook'))$('.notebook').oninput=e=>{notes=e.target.value;persist();};
    if($('#confirm-night'))$('#confirm-night').onclick=()=>{const before=snapshot(),[ok,error]=game.selectNight(targets);targets=[];source=null;mode='investigate';afterAction(before);if(!ok)notice(error);};
    if($('#cancel-skill'))$('#cancel-skill').onclick=()=>setMode('investigate');
    app.querySelectorAll('[data-log-page]').forEach(b=>b.onclick=()=>{logPage+=Number(b.dataset.logPage);renderGame();});
    if(flip){const inner=app.querySelector(`[data-seat="${flip}"] .seat-inner`);if(inner){inner.style.transition='none';inner.style.transform='rotateY(0deg)';void inner.offsetWidth;requestAnimationFrame(()=>{inner.style.transition='';inner.style.transform='';});}}
    positionRoleDialogues();
  }
  function snapshot(){return {hp:game.hp,flips:game.flips,seats:game.seats.map((s,j)=>({alive:s.alive,mask:game.mask(j+1)}))};}
  function afterAction(before,flip=null){
    game.seats.forEach((s,j)=>{if(!before.seats[j].alive&&s.alive){const event=nightDeaths.get(j+1);if(event)clearTimeout(event.timer);nightDeaths.delete(j+1);}});
    const victims=game.seats.flatMap((s,j)=>before.seats[j].alive&&!s.alive&&s.death==='night'?[j+1]:[]);
    victims.forEach(animateNightDeath);
    logPage=0;persist();renderGame(flip);
    if(game.hp<before.hp){document.body.classList.add('damage-flash');setTimeout(()=>document.body.classList.remove('damage-flash'),600);}
    if(game.flips>before.flips&&game.flips%rules.nightEvery===0){document.body.classList.add('night-flash');bell('night');setTimeout(()=>document.body.classList.remove('night-flash'),1900);}
    identityQueue.push(...game.seats.flatMap((s,j)=>before.seats[j].alive&&!s.alive&&s.executionKnown&&before.seats[j].mask!==s.role?[{seat:j+1,mask:before.seats[j].mask,role:s.role}]:[]));
    if($('#reveal-overlay').hidden&&identityQueue.length){const next=identityQueue.shift();showIdentity(next.seat,next.mask,next.role);}

  }
  function seatClick(i){
    if(game.phase!=='playing'){selected=i;renderGame();return;}
    if(game.pendingNight){if(!game.s(i).alive){notice('请选择存活角色。');return;}if(targets.includes(i))targets=targets.filter(j=>j!==i);else if(targets.length<game.pendingNight.required)targets.push(i);renderGame();return;}
    if(mode==='skill'){
      const ability=game.abilityRole(source);
      if(ability==='kirara'?game.s(i).revealed:ability==='sigewinne'?game.s(i).alive:!game.s(i).alive){notice(ability==='kirara'?'请选择未翻开的目标。':ability==='sigewinne'?'请选择死亡角色。':'请选择存活目标。');return;}
      if(targets.includes(i))targets=targets.filter(t=>t!==i);
      else if(targets.length<game.targetCount(source))targets.push(i);
      else{notice('已选足目标。再次点击已选角色可取消。');return;}
      if(targets.length===game.targetCount(source)){
        const before=snapshot(),[ok,error]=game.use(source,targets);
        if(!ok){targets=[];renderGame();notice(error);return;}
        mode='investigate';source=null;targets=[];afterAction(before);bell();
        notice('技能已发动，结果已记入调查记录。');return;
      }
      renderGame();return;
    }
    selected=i;
    if(mode==='execute'){
      if(!game.s(i).alive){notice('该角色已经死亡。');renderGame();return;}
      const before=snapshot(),[ok,error]=game.execute(i);mode='investigate';source=null;targets=[];afterAction(before);
      if(!ok)notice(error);else{
        const result=game.lastExecution;
        notice(result.blocked?`阿佩普阻止了处决，失去2点生命；剩余 ${game.hp} 点生命。`:result.protected?'该角色免于本次处决，未扣生命。':result.baseDamage?`误杀善良 -${result.baseDamage}${result.extraDamage?`，${roleMap[result.role].name}额外 -${result.extraDamage}`:''}；剩余 ${game.hp} 点生命。`:'处决成功，未扣生命。');bell('execute');
      }
    }else if(!game.s(i).alive){renderGame();}
    else if(!game.s(i).revealed){
      const before=snapshot(),[ok,error]=game.reveal(i);if(!ok){notice(error);renderGame();return;}
      source=null;targets=[];mode='investigate';afterAction(before,i);bell('flip');
    }else{beginSkill(i);renderGame();}
  }
  function restartPrompt(){openModal('重新开始调查？','<p>当前难度保持不变，角色和座次会重新抽取。现有对局进度与笔记会被替换。</p>','重新开始',()=>{difficulty=game.difficulty;selectedScript=game.script;start();});}
  function showIdentity(i,maskId,trueId){
    const card=app.querySelector(`[data-seat="${i}"]`).getBoundingClientRect(),arena=$('.table-arena').getBoundingClientRect();
    const dir=card.left+card.width/2<arena.left+arena.width/2?-1:1,overlay=$('#reveal-overlay');
    overlay.style.setProperty('--dir',dir);overlay.innerHTML=`<div class="eyebrow">THE MASK HAS FALLEN</div><h2>伪装已被揭穿</h2><div class="identity-stage"><div class="identity-card true-identity">${portrait(trueId)}<h3>${escape(roleMap[trueId].name)}</h3><small>真实身份 · ${game.evil(i)?'魔物':'天理'}</small></div><div class="identity-card mask">${portrait(maskId)}<h3>${escape(roleMap[maskId].name)}</h3><small>原来的伪装</small></div></div><p>${i}号 · ${escape(roleMap[maskId].name)} → ${escape(roleMap[trueId].name)}</p><button class="secondary-button" id="dismiss-reveal">继续调查</button>`;overlay.hidden=false;$('#dismiss-reveal').onclick=closeIdentity;clearTimeout(unmaskTimer);unmaskTimer=setTimeout(closeIdentity,3500);
  }
  function closeIdentity(){clearTimeout(unmaskTimer);$('#reveal-overlay').hidden=true;if(identityQueue.length){const next=identityQueue.shift();showIdentity(next.seat,next.mask,next.role);}}
  function rulesDialog(){
    hideRosterTooltip();
    const d=$('#modal');modalAction=null;d.innerHTML=`<button class="dialog-close" data-dialog-close aria-label="关闭">×</button><div class="eyebrow">INVESTIGATOR'S HANDBOOK</div><h2 id="modal-title" style="margin-top:12px">调查须知</h2><div class="rules-grid"><div class="rule-row"><h3>01 · 翻开与核对</h3><p>直接点击角色即可翻开并查看效果与提示。翻牌只展示信息。蓝色边框表示有剩余主动技能机会，再次点击该角色进入选目标，选满自动发动；圆盘中央可取消。每局一次的能力不会因重新发言而恢复。温迪自动翻牌会触发翻开技能，但不计翻牌次数、不触发夜晚，自动翻开火史莱姆也不会导致失败。</p></div><div class="rule-row"><h3>02 · 裁决与胜利</h3><p>开局列出本局登场的 NPC、喽喽和强敌种类，不公布座位；吞星之鲸存活且能力生效时，该列表会提供错误信息。6 人局 8 点、8 人局 10 点、12 人局 13 点生命，误杀善良角色扣 5 点；进入处决模式后点击角色立即生效。清除全部魔物获胜，生命归零失败。每手动翻开 4 张牌进入一次夜晚，存活强敌可能夜袭。</p></div><div class="rule-row"><h3>03 · 可疑的证词</h3><p>除钟离的高优先级真话保护外，邪恶角色提供的信息必为假。醉酒／中毒会使技能不生效，信息说谎；疯狂会使角色伪装成另一个随机善良角色。异常状态在局中隐藏，结束后公开。钟离的邻座真话效果拥有高优先级。</p></div><div class="rule-row"><h3>04 · 身份与座次</h3><p>魔物会伪装成善良角色；新开局只能伪装成本局真实登场的 NPC，或任意冒险者。公子在正常阵营查询中被视为善良，但仍必须被清除；他的伪善不会让邪恶角色碰巧报对真实结果。林尼交换真实身份，显示名不变；成为善良林尼的一方次数已经用完。死亡后保留座位。伪装身份被处决时会揭露真实身份；涡津御建鸣神命的夜间击杀也会揭露真实身份。</p></div><div class="rule-row"><h3>05 · 调查笔记</h3><p>疑点和信任标记仅代表你的判断。进度自动保存在当前浏览器，回到首页可继续调查。清除浏览器数据会移除存档。</p></div></div><div class="dialog-actions"><button class="secondary-button" data-dialog-close>开始推理</button></div>`;d.showModal();
  }
  function cataloguePool(){const script=menu?selectedScript:game?.script;return script?roles.filter(r=>script.roleIds.includes(r.id)):roles;}
  function catalogueGrid(){
    const scope=cataloguePool();
    const entries=scope.filter(r=>(catalogueFilter==='全部'||r.type===catalogueFilter)&&(!catalogueSearch||r.name.includes(catalogueSearch)||r.effect.includes(catalogueSearch)));
    $('#catalogue-grid').innerHTML=entries.length?entries.map(r=>`<article class="role-entry ${['喽喽','强敌'].includes(r.type)?'evil':''}"><div class="role-top">${portrait(r.id)}<div><h3>${r.name}</h3><p class="role-type">${['冒险者','NPC'].includes(r.type)?'天理':'魔物'} · ${r.type}</p></div></div><div class="role-text"><p>${escape(r.effect)}</p>${r.hint!=='无'?`<small>提示：${escape(r.hint)}</small>`:''}</div></article>`).join(''):'<p class="empty-search">没有找到匹配的角色。</p>';
    $('#catalogue-count').textContent=`${entries.length} / ${scope.length}`;
    $('#catalogue').querySelectorAll('[data-filter]').forEach(b=>b.classList.toggle('active',b.dataset.filter===catalogueFilter));
  }
  function book(){
    hideRosterTooltip();
    catalogueFilter='全部';catalogueSearch='';const d=$('#catalogue');
    d.innerHTML=`<button class="dialog-close" data-book-close aria-label="关闭图鉴">×</button><div class="catalogue-header"><div class="eyebrow">THE CAST OF NOCTURNE</div><h2 id="catalogue-title" style="margin-top:12px">角色图鉴</h2><p>仅展示当前剧本的角色池，不透露本局实际分配的身份或座位。</p></div><div class="catalogue-tools"><div class="filter-tabs">${['全部','冒险者','NPC','喽喽','强敌'].map(t=>`<button data-filter="${t}" class="${t==='全部'?'active':''}">${t}</button>`).join('')}</div><input id="role-search" type="search" placeholder="搜索角色或效果" aria-label="搜索角色或效果"><small id="catalogue-count"></small></div><div class="catalogue-grid" id="catalogue-grid"></div>`;
    d.classList.add('catalogue');d.showModal();catalogueGrid();d.querySelector('[data-book-close]').onclick=()=>d.close();d.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{catalogueFilter=b.dataset.filter;catalogueGrid();});$('#role-search').oninput=e=>{catalogueSearch=e.target.value.trim();catalogueGrid();};
  }
  document.addEventListener('click',e=>{if(e.target.closest('[data-dialog-close]'))closeModal();});
  $('#modal').addEventListener('cancel',()=>{modalAction=null;if(mode==='execute')setMode('investigate');});
  $('#home').onclick=()=>{if(!menu)leave();};
  document.querySelectorAll('[data-action="book"]').forEach(b=>b.onclick=book);
  document.querySelectorAll('[data-action="rules"]').forEach(b=>b.onclick=rulesDialog);
  $('#sound').onclick=()=>{sound=!sound;updateSound();if(sound)bell();};
  $('#fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{notice('此浏览器不支持页面全屏。');}};
  document.addEventListener('keydown',e=>{if(e.key!=='Escape')return;if(!$('#roster-tooltip').hidden){hideRosterTooltip();return;}if(!$('#reveal-overlay').hidden)closeIdentity();else if(!$('#modal').open&&!$('#catalogue').open&&(mode==='skill'||mode==='execute'))setMode('investigate');});
  $('#role-total').textContent=roles.length;window.addEventListener('pagehide',persist);renderMenu();
})();
