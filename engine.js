/* Static browser game rules and state. Seat numbers are one-based. */
(() => {
  'use strict';
  const {roles: list, rules} = globalThis.CLOCKTOWER_DATA;
  const roles = Object.fromEntries(list.map(r => [r.id, r]));
  const copy = value => JSON.parse(JSON.stringify(value));
  const good = id => ['冒险者', 'NPC'].includes(roles[id].type);
  class GameEngine {
    constructor(difficulty = 'easy', seed = Date.now(), fixture = null, script = null) {
      this.seed = ((Math.floor(seed) % 2147483646) + 2147483646) % 2147483646 + 1;
      this.seats = []; this.logs = [];
      this.phase = 'playing'; this.flips = 0; this.turn = 0; this.difficulty = difficulty; this.onceUsageVersion = 1;
      this.script = script ? GameEngine.validateScript(script) : null;
      this.hp = this.maxHp;
      if (fixture) this.seats = copy(fixture.map(s => typeof s === 'string' ? {role:s} : s));
      else {
        const cfg = this.config;
        if (!cfg) throw new Error('未知难度');
        const ids = [];
        const take = (type, n, allowed) => {
          const pool = this.shuffle(this.pool(type, allowed).filter(id=>!ids.includes(id)));
          if (pool.length < n) throw new Error('角色池不足');
          ids.push(...pool.slice(0, n));
        };
        take('喽喽', cfg.minions, cfg.minionPool); take('强敌', cfg.bosses, cfg.bossPool);
        let npcs = cfg.npcs + Number(ids.includes('eremite'));
        take('NPC', npcs, cfg.npcPool);
        if(ids.includes('arataki')){take('NPC',1,cfg.npcPool);npcs++;}
        if(cfg.seats-cfg.minions-cfg.bosses-npcs<0)throw Error('配板调整后没有足够的冒险者名额。');
        take('冒险者', cfg.seats - cfg.minions - cfg.bosses - npcs, cfg.adventurers);
        this.seats = this.shuffle(ids).map(role => ({role}));
      }
      this.setup(); this.startingRoles=this.seats.map(s=>s.role);this.log('调查开始：先翻开角色，交叉核对发言，再处决可疑目标。');this.startAbilities();this.roster();
    }
    s(i) { return this.seats[i - 1]; }
    random(n) { this.seed = (this.seed * 48271) % 2147483647; return this.seed % n + 1; }
    pick(xs) { return xs.length ? xs[this.random(xs.length) - 1] : undefined; }
    shuffle(xs) { const r=copy(xs); for(let i=r.length;i>1;i--){const j=this.random(i)-1;[r[i-1],r[j]]=[r[j],r[i-1]];} return r; }
    pool(type, allowed) { return list.filter(r=>r.type===type&&r.initial!==false&&(!allowed?.length||allowed.includes(r.id))).map(r=>r.id); }
    informationRoles() { return this.script?list.filter(r=>this.script.roleIds.includes(r.id)):list; }
    wrongMask(real) { const scope=this.informationRoles(),goodChoices=scope.filter(r=>good(r.id)&&r.id!==real);return this.pick((goodChoices.length?goodChoices:scope.filter(r=>r.id!==real)).map(r=>r.id)); }
    log(text) { this.logs.push(text); }
    neighbors(i) { const n=this.seats.length; return [(i+n-2)%n+1,i%n+1]; }
    evil(i, perceived=false) { return !good(this.s(i).role)&&!(perceived&&this.s(i).role==='childe'); }
    aliveList(predicate=()=>true) { return this.seats.flatMap((s,j)=>s.alive&&predicate(j+1,s)?[j+1]:[]); }
    bossPoisoned(i) { return !this.evil(i)&&this.seats.some((s,j)=>s.alive&&s.role==='shouki'&&!s.drunk&&!s.poisoned&&(j+1)%2!==i%2); }
    rayPoisoned(i) { return this.seats.some(s=>s.alive&&s.role==='hunters_ray'&&s.rayTarget===i); }
    isPoisoned(i) { return this.s(i).poisoned||this.bossPoisoned(i)||this.rayPoisoned(i); }
    disabled(i) { return this.s(i).drunk||this.isPoisoned(i); }
    effective(i) { return this.s(i).alive&&!this.disabled(i); }
    truthProtected(i) { return this.neighbors(i).some(j=>this.hasAbility(j,'zhongli')&&this.canAct(j)); }
    lies(i) {
      if(this.truthProtected(i))return false;
      if(this.s(i).role==='hunters_ray')return this.disabled(i);
      return this.evil(i)||this.disabled(i)||this.seats.some((s,j)=>this.effective(j+1)&&(s.role==='shunji'&&s.novelTarget===i||s.role==='whopperflower'&&(j+1)%this.seats.length+1===i));
    }
    informationEvil(observer,target) { return this.evil(target,!this.lies(observer)); }
    canAct(i) { return this.effective(i)&&(!this.evil(i)||this.s(i).role==='hunters_ray'); }
    mask(i) { const s=this.s(i); return s.role==='pyro_slime'?'pyro_slime':s.mad?s.madMask:s.disguise; }
    abilityRole(i) { const s=this.s(i);if(s.role==='pyro_slime')return 'pyro_slime';if(s.exchangedGood&&rules.lyneyAfterSwap==='real-role'&&s.role!=='yae'){if(s.role==='hanachirusato')return s.inheritedRole==='yae'?this.mask(i):s.inheritedRole||s.role;return s.role;}return this.mask(i); }
    innateRole(i) { const s=this.s(i);return s.role==='hunters_ray'&&s.inheritedRole?s.inheritedRole:s.role==='hanachirusato'&&(s.mad||s.exchangedGood)?s.inheritedRole||s.madMask:s.role; }
    hasAbility(i,id) { const s=this.s(i),retained=s.role==='yae'||s.role==='hunters_ray'||s.role==='hanachirusato'&&(s.mad||s.exchangedGood);return this.innateRole(i)===id||retained&&this.abilityRole(i)===id; }
    blocked(i) {
      return (this.mask(i)==='kujirai'&&(rules.whaleAlwaysBlocked||!this.disabled(i)))||this.seats.some((s,j)=>s.role==='cryo'&&this.effective(j+1)&&s.frozenTarget===i);
    }
    checkEnd() {
      if(this.phase!=='playing')return;
      if(this.hp<=0){this.phase='lost';this.log('生命耗尽，钟声沉入黑夜。');}
      else if(!this.aliveList(i=>this.evil(i)).length){this.phase='won';this.log('所有魔物已被清除，天理阵营获胜。');}
    }
    damage(n, why) { this.hp=Math.max(0,this.hp-n);this.log(`${why}，失去${n}点生命。`); }
    setup() {
      const adventurers=this.pool('冒险者',this.script?.roleIds);
      const masks=[...adventurers,...this.pool('NPC',this.script?.roleIds).filter(id=>id!=='jack')];
      // Real lineup membership, not another evil player's disguise, permits an NPC mask.
      const present=new Set(this.seats.map(s=>s.role));
      const evilMasks=masks.filter(id=>roles[id].type!=='NPC'||present.has(id));
      this.seats.forEach(s=>{
        Object.assign(s,{alive:true,revealed:false,used:false,speech:null,history:[],death:null});
        if(s.role==='arataki')s.aratakiOriginal=!s.formerRole;
        if(s.role==='yae'&&!s.disguise)s.disguise=this.pick(adventurers.filter(id=>id!=='yae'));
        s.disguise=s.disguise||(good(s.role)?s.role:this.pick(evilMasks));
        if(s.disguise==='yae'){s.yaeDisguised=true;s.disguise=s.yaeMask||this.pick(adventurers.filter(id=>id!=='yae'));}
        if(s.role==='hanachirusato'||s.disguise==='hanachirusato'){
          s.inheritedRole=s.inheritedRole||s.madMask||this.pick(adventurers);s.mad=true;
          s.madMask=s.inheritedRole==='yae'?this.pick(adventurers.filter(id=>id!=='yae')):s.inheritedRole;
        }
        s.drunk=Boolean(s.drunk||s.role==='jack');s.poisoned=Boolean(s.poisoned);
        s.mad=Boolean(s.mad||['jack','hilichurl','scout'].includes(s.role));
        if(s.mad)s.madMask=s.madMask||(s.role==='jack'?this.pick(masks):s.disguise);
        if(s.madMask==='yae'){s.yaeDisguised=true;s.madMask=this.pick(adventurers.filter(id=>id!=='yae'));}
        if(s.role==='pyro_slime')this.unmaskSlime(s);
      });
      // Ray's initial poison is established before all other starting abilities.
      const actualAdventurers=this.aliveList((i,s)=>roles[s.role].type==='冒险者');
      for(const s of this.seats.filter(s=>s.role==='hunters_ray')){
        const target=s.rayTarget&&actualAdventurers.includes(s.rayTarget)?s.rayTarget:this.pick(actualAdventurers);
        if(!target)throw Error('猎刀鳐需要至少一名真实在场的冒险者。');
        s.rayTarget=target;s.disguise=this.s(target).role;s.mad=false;s.madMask=null;
        if(s.disguise==='yae'){
          s.inheritedRole='yae';
          const alternatives=actualAdventurers.filter(j=>this.s(j).role!=='yae');
          if(alternatives.length){s.inheritedRole='yae';s.rayTarget=this.pick(alternatives);s.disguise=this.s(s.rayTarget).role;}
        }
      }
      this.seats.forEach((s,j)=>{if(s.role==='connor'&&this.canAct(j+1)){const t=this.pick(this.aliveList(i=>i!==j+1&&!this.evil(i)));if(t)this.s(t).drunk=true;}});
      this.seats.forEach((s,j)=>{
        if(s.role==='dendro'&&this.effective(j+1)){const t=this.pick(this.neighbors(j+1).filter(i=>!this.evil(i)));if(t)this.s(t).poisoned=true;}
        else if(s.role==='cryo')s.frozenTarget=this.pick(this.aliveList());
        else if(s.role==='shunji')s.novelTarget=this.pick(this.neighbors(j+1));
      });
    }
    get config() {
      if(!this.script)return rules.difficulties.find(d=>d.id===this.difficulty);
      const s=this.script,q=s.quantities,of=type=>s.roleIds.filter(id=>roles[id]?.type===type);
      return {id:'custom',name:s.name,seats:s.seats,hp:s.hp,minions:q['喽喽'],bosses:q['强敌'],npcs:q.NPC,adventurers:of('冒险者'),npcPool:of('NPC'),minionPool:of('喽喽'),bossPool:of('强敌')};
    }
    static fromScript(script,seed=Date.now()) { return new GameEngine('custom',seed,null,script); }
    unmaskSlime(s) { s.disguise='pyro_slime';s.mad=false;s.madMask=null;delete s.inheritedRole;delete s.rayTarget;delete s.frozenTarget;delete s.novelTarget;delete s.yaeMask;delete s.yaeDisguised;if(s.speech?.kind!=='pyro_slime')s.speech=null; }
    startAbilities() {
      const actors=this.aliveList(i=>['klee','paimon'].includes(this.abilityRole(i)));
      for(const i of actors){
        if(!this.s(i).alive||!['klee','paimon'].includes(this.abilityRole(i)))continue;
        if(this.abilityRole(i)==='klee'&&this.canAct(i)){
          const t=this.pick(this.aliveList(j=>this.evil(j)&&this.s(j).role!=='pyro_slime'));
          if(t){const s=this.s(t);s.role='pyro_slime';this.unmaskSlime(s);this.s(i).kleeSlime=t;}
        }
        this.reveal(i,false);
      }
    }
    targetCount(i) { return this.abilityRole(i)==='kirara'?Math.min(2,this.seats.filter(s=>!s.revealed).length):roles[this.abilityRole(i)].targets||0; }
    roster() {
      const counts={};for(const s of this.seats)counts[s.role]=(counts[s.role]||0)+1;
      if(!this.seats.some((s,j)=>s.role==='narwhal'&&this.effective(j+1)))return counts;
      if(!this.falseRoster){
        this.falseRoster={};
        const candidates=this.script?list.filter(r=>this.script.roleIds.includes(r.id)):list;
        for(const type of ['NPC','喽喽','强敌']){
          const present=list.filter(r=>r.type===type&&counts[r.id]),absent=candidates.filter(r=>r.type===type&&!counts[r.id]&&r.initial!==false);
          for(const r of present){const wrong=this.pick(absent);if(wrong)this.falseRoster[wrong.id]=(this.falseRoster[wrong.id]||0)+counts[r.id];else this.falseRoster['unknown-'+type]=(this.falseRoster['unknown-'+type]||0)+counts[r.id]+1;}
          if(!present.length&&absent.length)this.falseRoster[this.pick(absent).id]=1;
          else if(!present.length&&!absent.length)this.falseRoster['unknown-'+type]=1;
        }
      }
      return copy(this.falseRoster);
    }
    describeSpeech(i,speech) {
      const {kind}=speech,targets=speech.targets||[],text=speech.text||'';
      const direction={'顺时针最近':'离我最近的邪恶玩家在顺时针方向。','逆时针最近':'离我最近的邪恶玩家在逆时针方向。','距离相同':'顺时针和逆时针方向，离我最近的邪恶玩家距离相同。'};
      const parity={'奇数位更多':'当前奇数座位上的邪恶玩家更多。','偶数位更多':'当前偶数座位上的邪恶玩家更多。','奇偶一样多':'当前奇数和偶数座位上的邪恶玩家一样多。'};
      if(kind==='fischl'&&direction[text])return direction[text];
      if(kind==='heizou'&&parity[text])return parity[text];
      if(kind==='diona'&&/^邻座中(有|没有)醉酒(?:或中毒)?的角色。$/.test(text))return `邻座${this.neighbors(i).join('号和')}号中，${text.includes('没有')?'没有':'有'}${text.includes('中毒')?'醉酒或中毒':'醉酒'}的角色。`;
      if(targets.length){
        if(kind==='mona'&&text.startsWith('这两个角色中'))return `${targets[0]}号和${targets[1]}号角色中${text.includes('不存在')?'不存在':'存在'}魔物。`;
        if(kind==='layla'&&text.startsWith('这两个角色阵营'))return `${targets[0]}号和${targets[1]}号角色阵营${text.includes('不同')?'不同':'相同'}。`;
        if(kind==='barbara'&&text.startsWith('该角色刚才'))return `${targets[0]}号角色刚才的发言是${text.includes('假话')?'假话':'真话'}。`;
        if(kind==='yelan'&&text==='已尝试处决选中的邪恶角色。')return `已尝试处决${targets[0]}号角色。`;
        if(kind==='baizhu'&&text==='请选中的角色重新发言。')return `已尝试治疗${targets[0]}号角色，并令其重新发言。`;
        if(kind==='lyney'&&text==='已尝试交换身份。')return `已尝试与${targets[0]}号角色交换身份。`;
        const position=/^我得到的位置是(\d+)号。$/.exec(text);
        if(kind==='connor'&&position)return `对${targets[0]}号使用技能，线索指向${position[1]}号魔物。`;
      }
      if(kind==='sucrose'&&text==='已尝试治疗两侧角色。')return `已尝试治疗邻座${this.neighbors(i).join('号和')}号的醉酒、中毒和疯狂。`;
      if(kind==='furina')return text.replace(/^(\d+)号的真实身份/, '$1号角色的真实身份');
      const seats=/^([\d、]+)号的角色类型各不相同。$/.exec(text);
      if(kind==='ningguang'&&seats)return `${seats[1].split('、').join('号、')}号角色的类型各不相同。`;
      return text;
    }
    upgradeSpeechText() {
      const old=this.seats.map(s=>s.history.map(h=>h.text)),cursor=this.seats.map(()=>0);
      this.seats.forEach((s,j)=>{s.history.forEach(h=>h.text=this.describeSpeech(j+1,h));if(s.speech)s.speech.text=this.describeSpeech(j+1,s.speech);});
      this.logs=this.logs.map(log=>{const m=/^(\d+)号·([^：]+)：(.*)$/.exec(log);if(!m)return log;const j=Number(m[1])-1,k=cursor[j]++;return old[j]?.[k]===m[3]?`${m[1]}号·${m[2]}：${this.seats[j].history[k].text}`:log;});
      return this;
    }
    saveSpeech(i,text,truth,kind,targets=[]) {
      const s=this.s(i),speech={text:this.describeSpeech(i,{text,kind,targets}),truth:truth??null,kind,targets:copy(targets),turn:this.turn};
      s.speech=speech;s.history.push(copy(speech));this.log(`${i}号·${roles[this.mask(i)].name}：${speech.text}`);return speech;
    }
    boolSpeech(i,value,yes,no,kind,targets=[]) { const answer=this.lies(i)?!value:Boolean(value);return this.saveSpeech(i,answer?yes:no,answer===Boolean(value),kind,targets); }
    ternarySpeech(i,value,choices,kind) { const answer=this.lies(i)?this.pick(choices.filter(v=>v!==value)):value;return this.saveSpeech(i,answer,answer===value,kind); }
    direction(i) {
      let cw=Infinity,ccw=Infinity,n=this.seats.length;
      this.seats.forEach((s,j)=>{j++;if(j!==i&&s.alive&&this.informationEvil(i,j)){cw=Math.min(cw,(j-i+n)%n);ccw=Math.min(ccw,(i-j+n)%n);}});
      return cw===ccw?'距离相同':cw<ccw?'顺时针最近':'逆时针最近';
    }
    parity(observer=null) { let odd=0,even=0;for(const i of this.aliveList(i=>observer===null?this.evil(i,true):this.informationEvil(observer,i)))i%2?odd++:even++;return odd===even?'奇偶一样多':odd>even?'奇数位更多':'偶数位更多'; }
    speak(i, kind=this.abilityRole(i), targets=[], repeatOnly=false) {
      if(this.s(i).role==='pyro_slime'){kind='pyro_slime';targets=[];}
      if(roles[kind].targets&&!targets.length)return this.saveSpeech(i,'选择目标后，可以使用我的主动能力。',null,kind);
      if(kind==='arataki'){
        const s=this.s(i),original=s.role==='arataki'&&s.aratakiOriginal;
        if(original&&this.canAct(i)){
          if(!repeatOnly){const j=this.pick(this.aliveList((j,v)=>!v.revealed&&!this.evil(j)));if(j){const t=this.s(j);t.formerRole=t.role;t.aratakiOriginal=false;t.role='arataki';t.disguise='arataki';t.mad=false;t.madMask=null;t.used=false;delete t.inheritedRole;delete t.rayTarget;delete t.frozenTarget;delete t.novelTarget;}}
          return this.saveSpeech(i,'我是原始的荒泷派小弟，已尝试令一个未翻开的善良角色变身。',null,kind);
        }
        const previous=s.formerRole||s.role;
        const id=this.lies(i)?this.pick(this.informationRoles().filter(r=>good(r.id)&&r.id!==previous).map(r=>r.id)):previous;
        return id?this.saveSpeech(i,`我原来的身份是${roles[id].name}。`,id===previous,kind):this.saveSpeech(i,'我不是原始的荒泷派小弟。',!original,kind);
      }
      if(kind==='nahida'){
        const n=this.neighbors(i).filter(j=>this.informationEvil(i,j)).length;
        const answer=this.lies(i)?this.pick([0,1,2].filter(v=>v!==n)):n;
        return this.saveSpeech(i,`邻座${this.neighbors(i).join('号和')}号中有${answer}个邪恶玩家。`,answer===n,kind);
      }
      if(kind==='mizuki'){
        if(!repeatOnly)return this.saveSpeech(i,'进入夜晚后，我会提供两个座位的线索。',null,kind);
        const candidates=this.aliveList(j=>j!==i),pairs=[],lying=this.lies(i);
        for(let a=0;a<candidates.length;a++)for(let b=a+1;b<candidates.length;b++){
          const pair=[candidates[a],candidates[b]],evil=pair.some(j=>lying?this.evil(j):this.informationEvil(i,j));
          if(lying?!evil:evil)pairs.push(pair);
        }
        const pair=this.pick(pairs);
        return pair?this.saveSpeech(i,`${pair[0]}号和${pair[1]}号中至少有1个邪恶玩家。`,!lying,kind,pair):this.saveSpeech(i,'没有足够的其他存活玩家可提供这条线索。',null,kind);
      }
      if(kind==='kirara'){
        const answers=targets.map(j=>{const real=this.mask(j),id=this.lies(i)?this.wrongMask(real):real;return {seat:j,id,truth:id===real};});
        return this.saveSpeech(i,answers.map(a=>`${a.seat}号的表面身份是${roles[a.id].name}`).join('；')+'。',answers.every(a=>a.truth),kind,targets);
      }
      if(kind==='klee'){
        const lying=this.lies(i),slimes=this.aliveList(j=>this.s(j).role==='pyro_slime');
        const pool=this.aliveList(j=>!lying||this.s(j).role!=='pyro_slime');
        const first=!lying?this.pick(slimes):this.pick(pool),second=this.pick(pool.filter(j=>j!==first));
        return first&&second?this.saveSpeech(i,`${first}号和${second}号中有一个火史莱姆。`,!lying&&slimes.includes(first),kind,[first,second]):this.saveSpeech(i,'没有足够的座位可提供火史莱姆线索。',null,kind);
      }
      if(kind==='hutao'){
        const s=this.s(i);s.deathReports??={};
        for(let j=1;j<=this.seats.length;j++)if(this.s(j).death==='night'&&(!s.deathReports[j]||(s.deathReports[j].deathVersion||0)!==(this.s(j).deathVersion||0))){
          const real=this.s(j).deathMask||this.mask(j),id=this.lies(i)?this.wrongMask(real):real;
          s.deathReports[j]={id,truth:id===real,deathVersion:this.s(j).deathVersion||0};
        }
        const entries=Object.entries(s.deathReports).filter(([j])=>this.s(Number(j)).death==='night');
        return this.saveSpeech(i,entries.length?'夜间遇害角色的表面身份：'+entries.map(([j,a])=>`${j}号·${roles[a.id].name}`).join('；')+'。':'目前没有在夜晚死亡的玩家。',entries.every(([,a])=>a.truth),kind);
      }
      if(kind==='venti'){
        if(!repeatOnly&&!this.disabled(i)){
          const hidden=[];for(let k=1;k<this.seats.length;k++){const j=(i+k-1)%this.seats.length+1;if(this.s(j).alive&&!this.s(j).revealed)hidden.push(j);}
          if(this.canAct(i)){const j=this.pick(hidden);if(j)this.s(j).drunk=true;}
          for(const j of hidden){if(this.phase!=='playing')break;if(this.s(j).alive&&!this.s(j).revealed)this.reveal(j,false);}
        }
        return this.saveSpeech(i,'已按顺时针尝试翻开剩余角色。',null,kind);
      }
      if(kind==='fischl')return this.ternarySpeech(i,this.direction(i),['距离相同','顺时针最近','逆时针最近'],kind);
      if(kind==='heizou')return this.ternarySpeech(i,this.parity(i),['奇偶一样多','奇数位更多','偶数位更多'],kind);
      if(kind==='diona')return this.boolSpeech(i,this.neighbors(i).some(j=>this.s(j).drunk||this.isPoisoned(j)),'邻座中有醉酒或中毒的角色。','邻座中没有醉酒或中毒的角色。',kind);
      if(kind==='furina'){
        const t=this.pick(this.aliveList(j=>j!==i))||i;let id=this.s(t).role;
        if(this.lies(i))id=this.pick(this.informationRoles().filter(r=>r.id!==id&&(!this.evil(i)||!good(r.id))).map(r=>r.id));
        return this.saveSpeech(i,`${t}号的真实身份是${roles[id].name}。`,id===this.s(t).role,kind);
      }
      if(kind==='ningguang'){
        const seats=this.shuffle(this.aliveList());let found=[];const types=new Set();
        if(!this.lies(i)){for(const j of seats){const type=roles[this.s(j).role].type;if(!types.has(type)){types.add(type);found.push(j);}if(found.length===3)break;}}
        else {outer:for(let a=0;a<seats.length;a++)for(let b=a+1;b<seats.length;b++)if(roles[this.s(seats[a]).role].type===roles[this.s(seats[b]).role].type){found=[seats[a],seats[b]];break outer;}if(found.length){const j=seats.find(j=>!found.includes(j));if(j)found.push(j);}}
        if(found.length)return this.saveSpeech(i,`${found.join('号、')}号角色的类型各不相同。`,!this.lies(i),kind);
        if(seats.length>=2)return this.saveSpeech(i,`${seats[0]}号和${seats[1]}号角色的类型相同。`,false,kind);
        const t=seats[0]??i,type=['冒险者','NPC','喽喽','强敌'].find(v=>v!==roles[this.s(t).role].type);
        return this.saveSpeech(i,`${t}号角色的类型是${type}。`,false,kind);
      }
      if(kind==='mona')return this.boolSpeech(i,this.informationEvil(i,targets[0])||this.informationEvil(i,targets[1]),'这两个角色中存在魔物。','这两个角色中不存在魔物。',kind,targets);
      if(kind==='layla')return this.boolSpeech(i,this.informationEvil(i,targets[0])===this.informationEvil(i,targets[1]),'这两个角色阵营相同。','这两个角色阵营不同。',kind,targets);
      if(kind==='barbara')return this.boolSpeech(i,this.s(targets[0]).speech.truth,'该角色刚才说的是真话。','该角色刚才说的是假话。',kind,targets);
      if(kind==='connor'){
        const lying=this.lies(i);let pool=this.aliveList();
        if(lying){pool=pool.filter(j=>!this.evil(j));if(!pool.length)pool=this.seats.flatMap((s,j)=>!this.evil(j+1)?[j+1]:[]);}
        else if(this.truthProtected(i)||this.s(targets[0]).drunk)pool=pool.filter(j=>this.evil(j,true));
        const j=this.pick(pool);
        return j?this.saveSpeech(i,`对${targets[0]}号使用技能，线索指向${j}号魔物。`,this.evil(j,true),kind,targets):this.saveSpeech(i,'当前没有可指认的存活魔物。',!lying,kind,targets);
      }
      if(kind==='sucrose'){if(!repeatOnly&&this.canAct(i))this.neighbors(i).forEach(j=>this.cure(j,true));return this.saveSpeech(i,'已尝试治疗两侧角色。',null,kind);}
      return this.saveSpeech(i,'我没有在翻开时提供线索的能力。',null,kind);
    }
    cure(i,madness=false) { const s=this.s(i);s.drunk=false;s.poisoned=false;if(madness){s.mad=false;s.madMask=null;} }
    reSpeak(i) { const s=this.s(i);if(!s.revealed)return;const old=s.speech,id=this.abilityRole(i);if(old?.kind===id&&old.targets.length&&['barbara','mona','layla','connor','kirara'].includes(old.kind)){if(old.kind==='barbara'&&!this.s(old.targets[0]).speech)return;this.speak(i,old.kind,old.targets,true);}else this.speak(i,id,[],true); }
    nightImmune(i) { return this.hasAbility(i,'qiqi')&&this.canAct(i); }
    kill(i,cause,reveal=false) {
      const s=this.s(i);if(!s?.alive)return false;
      s.deathMask=this.mask(i);s.deathVersion=(s.deathVersion||0)+1;s.alive=false;s.death=cause;if(reveal)s.executionKnown=true;
      this.log(`${i}号${cause==='night'?'在夜晚遇害':'被海乱鬼击杀'}。`);
      if(cause==='night')for(const j of this.aliveList(j=>this.s(j).revealed&&this.abilityRole(j)==='hutao'))this.speak(j,'hutao');
      return true;
    }
    night() {
      this.log(`第${this.flips}次翻牌：夜幕降临。`);
      for(const i of this.aliveList(i=>this.s(i).revealed&&this.abilityRole(i)==='mizuki'))this.speak(i,'mizuki',[],true);
      this.nightQueue=this.aliveList((i,s)=>['andrius','childe','magatsu','dvalin','apep'].includes(s.role)&&this.effective(i));this.processNight();
    }
    processNight() {
      while(this.nightQueue?.length&&this.phase==='playing'){
        const a=this.nightQueue.shift();if(!this.effective(a))continue;
        if(this.s(a).role==='magatsu'){
          this.pendingNight={boss:a,required:Math.min(4,this.aliveList().length)};this.log('请为涡津御建鸣神命选择'+this.pendingNight.required+'个存活角色。');return;
        }
        if(this.s(a).role==='dvalin'){
          const goodTargets=this.shuffle(this.aliveList((i,s)=>!s.revealed&&!this.evil(i))).slice(0,2);
          const evilTargets=this.shuffle(this.aliveList((i,s)=>!s.revealed&&this.evil(i))).slice(0,1);
          for(const j of [...goodTargets,...evilTargets]){if(this.nightImmune(j))this.log(`${j}号遭到夜袭，但存活了下来。`);else this.kill(j,'night');}
          this.damage(2,'裂空的魔龙的夜袭');this.checkEnd();continue;
        }
        const t=this.pick(this.aliveList((i,s)=>!s.revealed&&!this.evil(i)));
        if(t){if(this.nightImmune(t))this.log(`${t}号遭到夜袭，但存活了下来。`);else this.kill(t,'night');}
        else this.log('夜袭未找到未翻开的善良角色。');
        this.damage(2,'魔物的夜袭');this.checkEnd();
      }
      this.pendingNight=null;this.nightQueue=[];this.checkEnd();
    }
    selectNight(targets) {
      const pending=this.pendingNight;if(!pending||this.phase!=='playing')return [false,'当前不需要选择夜晚目标。'];
      if(targets.length!==pending.required||new Set(targets).size!==targets.length||targets.some(j=>!this.s(j)?.alive))return [false,'请选择指定数量的不同存活角色。'];
      const victims=this.shuffle(targets.filter(j=>this.s(j).role!=='magatsu'&&!this.nightImmune(j))).slice(0,2);
      this.pendingNight=null;
      for(const j of victims){const good=!this.evil(j);this.kill(j,'night',true);if(good)this.damage(2,'夜间失去善良角色');}
      this.checkEnd();this.processNight();return [true];
    }
    reveal(i,manual=true) {
      if(this.phase!=='playing')return [false,'本局已经结束。'];if(this.pendingNight)return [false,'请先完成夜晚选择。'];
      if(manual&&this.aliveList(j=>this.hasAbility(j,'timmie')&&this.s(j).revealed&&this.canAct(j)).length&&this.random(2)===1){const j=this.pick(this.aliveList((j,s)=>!s.revealed&&!this.blocked(j)));if(j){this.log(`提米干扰翻牌：转而翻开${j}号。`);i=j;}}
      const s=this.s(i);
      if(!s)return [false,'无效座位。'];if(!s.alive)return [false,'该角色已死亡。'];if(s.revealed)return [false,'该角色已经翻开。'];if(this.blocked(i))return [false,'这个角色无法被翻开。'];
      s.revealed=true;if(manual)this.flips++;this.turn++;
      if(manual&&s.role==='pyro_slime'&&this.effective(i)){this.phase='lost';this.log('手动翻开了火史莱姆，调查失败。');return [true];}
      if(s.role==='kairagi'&&this.effective(i)){const t=this.pick(this.aliveList(j=>!this.evil(j)&&this.effective(j)));if(t)this.kill(t,'kairagi');}
      if(s.alive)this.speak(i);
      if(manual&&this.phase==='playing'&&this.flips%rules.nightEvery===0)this.night();this.checkEnd();return [true];
    }
    execute(i,skill=false) {
      if(this.phase!=='playing')return [false,'本局已经结束。'];if(this.pendingNight)return [false,'请先完成夜晚选择。'];const s=this.s(i);if(!s?.alive)return [false,'只能处决存活角色。'];this.turn++;
      if(roles[s.role].type==='喽喽'&&this.seats.some((v,j)=>v.role==='apep'&&this.effective(j+1))){
        this.lastExecution={seat:i,role:s.role,blocked:true,protected:false,baseDamage:0,extraDamage:0,blockedDamage:2,beforeHp:this.hp};
        this.log(`阿佩普的绿洲守望者阻止了对${i}号的处决。`);this.damage(2,'试图处决受保护的喽喽');this.lastExecution.afterHp=this.hp;this.checkEnd();return [true];
      }
      // Capture reactions before death changes the actor's effective state.
      const evil=this.evil(i),immune=this.hasAbility(i,'qiqi')&&this.canAct(i),yae=this.innateRole(i)==='yae',yaeReport=yae,lying=this.lies(i);
      const baseDamage=!evil&&!immune&&!yae?(s.role==='jack'||this.hasAbility(i,'timmie')?2:rules.mistakeDamage):0;
      const extraDamage=!evil&&!immune&&!yae?(this.hasAbility(i,'qiqi')?4:s.role==='tian'?5:0):0;
      this.lastExecution={seat:i,role:s.role,protected:immune,baseDamage,extraDamage,beforeHp:this.hp};
      if(immune){this.lastExecution.afterHp=this.hp;this.log(`${i}号没有被处决死亡。`);return [true];}
      s.deathVersion=(s.deathVersion||0)+1;s.alive=false;s.death=typeof skill==='string'?skill:skill?'yelan':'execute';s.executionKnown=true;
      this.log(`${i}号被处决，身份是${roles[s.role].name}（${evil?'魔物':'天理'}）。`);
      if(baseDamage)this.damage(baseDamage,'误杀善良角色');if(extraDamage)this.damage(extraDamage,this.hasAbility(i,'qiqi')?'七七的额外惩罚':'天叔的额外惩罚');
      if(yaeReport){const j=this.pick(this.aliveList(j=>lying?!this.evil(j):this.evil(j,true)));this.saveSpeech(i,j?`线索指向${j}号邪恶玩家。`:'当前没有可指认的存活邪恶玩家。',j?!lying:null,'yae',j?[j]:[]);}
      this.lastExecution.afterHp=this.hp;
      this.checkEnd();return [true];
    }
    validateAbility(i,targets) {
      if(this.phase!=='playing')return [false,'本局已经结束。'];if(this.pendingNight)return [false,'请先完成夜晚选择。'];const s=this.s(i);
      if(!s?.alive||!s.revealed)return [false,'请选择已翻开且存活的角色。'];const id=this.abilityRole(i),role=roles[id];
      if(!role.targets)return [false,'这个角色没有主动技能。'];if(role.once&&s.used)return [false,'本局次数已用完。'];if(!this.targetCount(i)||targets.length!==this.targetCount(i))return [false,'目标数量不正确。'];
      if(targets.some(j=>!this.s(j)||(id==='kirara'?this.s(j).revealed:id==='sigewinne'?this.s(j).alive:!this.s(j).alive)))return [false,id==='kirara'?'只能选择未翻开的角色。':id==='sigewinne'?'只能选择死亡角色。':'只能选择存活目标。'];if(new Set(targets).size!==targets.length)return [false,'请选择不同目标。'];
      if(id==='barbara'&&(targets[0]===i||this.s(targets[0]).speech?.truth==null))return [false,'请选择已有可判断真假的发言的其他角色。'];
      if(id==='lyney'&&targets[0]===i)return [false,'林尼不能选择自己。'];return [true,id];
    }
    use(i,targets) {
      const [ok,id]=this.validateAbility(i,targets);if(!ok)return [false,id];const s=this.s(i);if(roles[id].once)s.used=true;this.turn++;
      if(id==='raiden'){
        const executions=[];
        if(this.canAct(i)){
          const evil=this.evil(targets[0]);this.execute(targets[0],'raiden');
          if(!this.s(targets[0]).alive)executions.push(targets[0]);
          if(!evil){this.phase='lost';this.log('雷电将军选择了善良角色，调查失败。');}
          else if(!this.s(targets[0]).alive&&this.phase==='playing'){const j=this.pick(this.aliveList(j=>j!==targets[0]&&this.evil(j)));if(j){this.execute(j,'raiden');if(!this.s(j).alive)executions.push(j);}}
        }
        this.lastSkill={source:i,kind:id,targets:copy(targets),executions};
        this.saveSpeech(i,`已尝试处决${targets[0]}号角色；本次实际处决${executions.length?executions.map(j=>j+'号').join('、'):'未发生'}。`,null,id,targets);
      }
      else if(id==='sigewinne'){
        const j=targets[0],t=this.s(j);
        if(this.canAct(i)&&!this.evil(j)){t.alive=true;t.used=false;t.death=null;delete t.deathMask;this.log(`${j}号被复活，技能使用机会已恢复。`);for(const observer of this.aliveList(j=>this.s(j).revealed&&this.abilityRole(j)==='hutao'))this.speak(observer,'hutao');}
        this.saveSpeech(i,`已尝试复活${j}号角色并恢复其技能使用机会。`,null,id,targets);
      }
      else if(id==='yelan'){if(this.canAct(i)&&this.evil(targets[0],true))this.execute(targets[0],true);this.saveSpeech(i,'已尝试处决选中的邪恶角色。',null,id,targets);}
      else if(id==='baizhu'){if(this.canAct(i))this.cure(targets[0]);this.saveSpeech(i,'请选中的角色重新发言。',null,id,targets);this.reSpeak(targets[0]);}
      else if(id==='lyney'){
        if(this.canAct(i)&&this.evil(targets[0],true)){
          const t=this.s(targets[0]);[s.role,t.role]=[t.role,s.role];s.exchangedGood=false;t.exchangedGood=true;
          [s.used,t.used]=[t.used,s.used];[s.frozenTarget,t.frozenTarget]=[t.frozenTarget,s.frozenTarget];[s.novelTarget,t.novelTarget]=[t.novelTarget,s.novelTarget];
          [s.inheritedRole,t.inheritedRole]=[t.inheritedRole,s.inheritedRole];
          [s.rayTarget,t.rayTarget]=[t.rayTarget,s.rayTarget];[s.formerRole,t.formerRole]=[t.formerRole,s.formerRole];[s.aratakiOriginal,t.aratakiOriginal]=[t.aratakiOriginal,s.aratakiOriginal];
          if(s.role==='pyro_slime')this.unmaskSlime(s);if(t.role==='pyro_slime')this.unmaskSlime(t);
        }
        this.saveSpeech(i,'已尝试交换身份。',null,id,targets);
      }else this.speak(i,id,targets);
      this.checkEnd();return [true];
    }
    view(i) {
      const s=this.s(i);if(!s)return null;const ended=this.phase!=='playing',visible=s.revealed||s.executionKnown||ended;
      const id=visible?(s.executionKnown||ended?s.role:this.mask(i)):null,role=roles[id];
      const v={seat:i,alive:s.alive,revealed:s.revealed,roleId:id,name:role?.name||'未知角色',type:role?.type||null,effect:role?.effect||'先翻开角色，再点击详情查看效果与提示。',hint:role?.hint||'无',speech:s.revealed&&s.speech?s.speech.text:'',used:s.used,death:s.death};
      if(ended){const statuses=[];if(s.drunk)statuses.push('醉酒');if(this.isPoisoned(i))statuses.push('中毒');if(s.mad)statuses.push('疯狂');v.summary=`${roles[s.role].name} · ${this.evil(i)?'魔物':'天理'} · ${statuses.join('/')||'正常'}`;v.evil=this.evil(i);}
      return v;
    }
    get maxHp() { return this.config?.hp ?? rules.hp; }
    serialize() { return {version:1,state:copy({...this})}; }
    static restore(data) {
      if(data?.version!==1||!data.state||!rules.difficulties.some(d=>d.id===data.state.difficulty)&&data.state.difficulty!=='custom')throw new Error('存档格式无效');
      const s=data.state;if(s.difficulty==='custom')GameEngine.validateScript(s.script);else if(s.script)throw Error('存档剧本与难度不匹配。');
      const cfg=Object.assign(Object.create(GameEngine.prototype),{difficulty:s.difficulty,script:s.script}).config;
      const maxHp=cfg.hp??rules.hp;
      if(!Array.isArray(s.seats)||s.seats.length!==cfg.seats||!['playing','won','lost'].includes(s.phase)||!Number.isFinite(s.hp)||s.hp<0||s.hp>Math.max(maxHp,rules.hp)||!Number.isFinite(s.seed)||!Array.isArray(s.logs))throw new Error('存档数据无效');
      for(const seat of s.seats)if(!roles[seat.role]||!roles[seat.disguise]||(seat.mad&&!roles[seat.madMask])||!Array.isArray(seat.history))throw new Error('角色存档无效');
      if(s.pendingNight&&(!Number.isInteger(s.pendingNight.boss)||s.seats[s.pendingNight.boss-1]?.role!=='magatsu'||!Number.isInteger(s.pendingNight.required)||s.pendingNight.required<1||s.pendingNight.required>4))throw Error('夜晚存档无效');
      const game=Object.assign(Object.create(GameEngine.prototype),copy(s),{hp:Math.min(s.hp,maxHp)}).upgradeSpeechText();
      game.seats.forEach(seat=>{if(seat.role==='pyro_slime')game.unmaskSlime(seat);});
      if(!game.onceUsageVersion){
        game.seats.forEach((seat,j)=>{
          if(game.abilityRole(j+1)!=='mona'||seat.used||!seat.history.some(h=>h.kind==='mona'&&h.targets?.length===2))return;
          const lastQuery=game.logs.findLastIndex(log=>log.startsWith(`${j+1}号·莫娜：`)&&seat.history.some(h=>h.kind==='mona'&&h.targets?.length===2&&log.endsWith(h.text)));
          const lastRevival=game.logs.findLastIndex(log=>log===`${j+1}号被复活，技能使用机会已恢复。`);
          if(lastRevival<0||lastQuery>lastRevival)seat.used=true;
        });
      }
      game.onceUsageVersion=1;return game;
    }
    static validateScript(s){
      if(!s||s.version!==1||typeof s.name!=='string'||!s.name.trim()||s.name.length>60||!Number.isInteger(s.seats)||s.seats<2||s.seats>24||!Number.isInteger(s.hp)||s.hp<1||s.hp>99||!Array.isArray(s.roleIds)||new Set(s.roleIds).size!==s.roleIds.length||s.roleIds.some(id=>!roles[id]||roles[id].initial===false)||!s.quantities)throw Error('剧本数据无效。');
      let total=0;for(const type of ['冒险者','NPC','喽喽','强敌']){const n=s.quantities[type];if(!Number.isInteger(n)||n<0||s.roleIds.filter(id=>roles[id].type===type).length<n)throw Error('剧本角色池数量不足。');total+=n;}
      if(total!==s.seats||!s.quantities['冒险者']&&!s.quantities.NPC||!s.quantities['喽喽']&&!s.quantities['强敌'])throw Error('剧本类别数量无效。');
      if(s.quantities['喽喽']&&s.roleIds.includes('eremite')&&(!s.quantities['冒险者']||s.roleIds.filter(id=>roles[id].type==='NPC').length<s.quantities.NPC+1))throw Error('镀金旅团缺少额外NPC候选。');
      const adventurers=s.roleIds.filter(id=>roles[id].type==='冒险者');
      const extraMinion=Number(s.quantities['喽喽']>0&&s.roleIds.includes('eremite'));
      const extraArataki=Number(s.quantities.NPC+extraMinion>0&&s.roleIds.includes('arataki'));
      const adjustments=extraMinion+extraArataki;
      if(s.quantities['冒险者']<adjustments||s.roleIds.filter(id=>roles[id].type==='NPC').length<s.quantities.NPC+adjustments)throw Error('镀金旅团／荒泷派小弟需要预留额外NPC候选和冒险者名额。');
      if(s.quantities['喽喽']>0&&s.roleIds.includes('hunters_ray')&&s.quantities['冒险者']-adjustments<1)throw Error('猎刀鳐需要预留至少一名实际登场的冒险者。');
      if(s.roleIds.includes('yae')&&adventurers.length<2)throw Error('勾选八重神子时，还需勾选至少一名其他冒险者供其伪装。');
      if(s.roleIds.includes('hanachirusato')&&!adventurers.length)throw Error('勾选花散里时，至少需要一名冒险者供其继承。');
      if(!s.roleIds.some(id=>good(id)&&id!=='jack'))throw Error('剧本至少需要一个可用于伪装的善良身份（杰克除外）。');return copy(s);
    }
  }
  globalThis.GameEngine=GameEngine;globalThis.GAME_ROLES=roles;
})();
