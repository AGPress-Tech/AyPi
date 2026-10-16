const { ipcRenderer } = require('electron');
'use strict';
const $ = id => document.getElementById(id);
const fmt = n => Number(n || 0).toLocaleString('it-IT');
const clock = ts => ts ? new Date(ts*1000).toLocaleTimeString('it-IT',{hour12:false}) : '—';
const safe = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const isRecent = (ts,now) => Boolean(ts && (now||Date.now()/1000)-ts<5);
const names = {overview:'Dashboard',machines:'Macchine & Robot',signals:'Signal Discovery',events:'Eventi'};
let latest = null, activeView='overview';
function showView(view){if(!names[view])return;activeView=view;document.querySelectorAll('.nav-link').forEach(el=>el.classList.toggle('active',el.dataset.view===view));document.querySelectorAll('.page').forEach(el=>el.classList.toggle('hidden',el.id!==`view-${view}`));location.hash=view;if(view==='overview')updateCarouselPosition();}
document.querySelectorAll('[data-view]').forEach(el=>el.addEventListener('click',e=>{e.preventDefault();showView(el.dataset.view);}));
document.querySelectorAll('[data-goto]').forEach(el=>el.addEventListener('click',()=>showView(el.dataset.goto)));
const kind=m=>m.asset_type==='robot'?'robot':m.signal?'production':m.code==='21D300'?'siren':m.device?'provisional':'unmapped';
function machineCard(m,s){const k=kind(m),up=k==='robot'?Boolean(m.online):k==='provisional'?s.flows.some(f=>f.machine===m.code&&isRecent(f.last,s.now)):isRecent(m.frame_time,s.now),unmapped=k==='unmapped';let icon=k==='robot'?'R':k==='siren'?'♬':k==='provisional'?'P':unmapped?'⌁':'▥';let status=k==='robot'?(up?'PAGINA ONLINE':'PAGINA OFFLINE'):(up?'FLUSSO PRESENTE':'FLUSSO ASSENTE');let content='';
if(k==='production'){content=`<div class="mc-metrics"><div class="mc-metric"><label>IMPULSI · SESSIONE</label><strong>${fmt(m.pulses)}</strong></div><div class="mc-metric"><label>PEZZI · SESSIONE</label><strong>${fmt(m.pieces)}</strong></div><div class="mc-metric"><label>PEZZI · ULTIMI 60 MIN</label><strong>${fmt(m.hour)}</strong></div><div class="mc-metric"><label>ULTIMO CONTEGGIO</label><strong class="smaller">${clock(m.last)}</strong></div></div><div class="mc-hint">${m.multiplier} ${m.multiplier===1?'pezzo':'pezzi'} per impulso · Produzione non deducibile dal link</div>`;}
else if(k==='siren'){content=`<div class="mc-metrics"><div class="mc-metric"><label>ATTIVAZIONI · SESSIONE</label><strong>${fmt(m.siren)}</strong></div><div class="mc-metric"><label>ULTIMA ATTIVAZIONE</label><strong class="smaller">${clock(m.siren_last)}</strong></div><div class="mc-metric wide"><label>TIPO SEGNALE</label><strong class="smaller">Sirena · non conteggia pezzi</strong></div></div><div class="mc-hint">Monitoraggio attivazioni, non classificazione automatica degli allarmi</div>`;}
else if(k==='robot'){content=`<div class="robot-meta"><span>ISOLA ${safe(m.island||'—')}</span><span>${safe(m.ip||'—')}</span></div><div class="mc-metrics robot-metrics"><div class="mc-metric wide"><label>PROGRAMMA DI LAVORO</label><strong class="smaller robot-value">${safe(m.program||'Non disponibile')}</strong></div><div class="mc-metric wide"><label>STATO ROBOT</label><strong class="smaller robot-value">${safe(m.robot_state||'Non disponibile')}</strong></div><div class="mc-metric"><label>CONTAPEZZI · ROBOT</label><strong>${safe(m.counter||'—')}</strong></div><div class="mc-metric"><label>TEMPO CICLO</label><strong class="smaller">${m.cycle_time?safe(m.cycle_time)+' s':'—'}</strong></div></div><div class="mc-hint robot-detail" title="${safe(m.details||m.error||'')}">${safe(!up ? (m.error||'Robot non raggiungibile')+(m.last_seen?' · Ultima lettura '+clock(m.last_seen):'') : (m.details||'Pagina HTML aggiornata'))}</div>`;}
else if(k==='provisional'){content=`<div class="mc-metrics"><div class="mc-metric wide"><label>ASSOCIAZIONE PROFINET</label><strong class="smaller">Provvisoria · da confermare</strong></div><div class="mc-metric"><label>NODO / IP</label><strong class="smaller">${safe(m.device.nodo)} · ${safe(m.device.ip)}</strong></div><div class="mc-metric"><label>FRAME ID</label><strong class="smaller">${safe(m.device.frame_id)}</strong></div></div><div class="mc-hint">${safe(m.device.evidenza||'Eventi BIT osservati')} · Nessun conteggio pezzi</div>`;}
else{content=`<div class="mc-metrics"><div class="mc-metric wide"><label>STATO MAPPATURA</label><strong class="smaller">Segnale da identificare</strong></div><div class="mc-metric wide"><label>ACQUISIZIONE</label><strong class="smaller">Discovery disponibile</strong></div></div><div class="mc-hint">Nessun conteggio pezzi finché il segnale non è validato</div>`;}
return `<article class="machine-card ${k}"><div class="mc-top"><div class="mc-icon" aria-hidden="true">${icon}</div><div><div class="mc-code"><small>${k==='robot'?'ISOLA ROBOTIZZATA':k==='siren'?'EVENTI / SIRENA':k==='provisional'?'ASSOCIAZIONE PROVVISORIA':unmapped?'DA IDENTIFICARE':'CONTAPEZZI / LIVE'}</small>${safe(m.code)}</div><div class="mc-name">${safe(m.name)}</div></div><span class="mc-status ${up?'on':'off'}">${up?'● LIVE':'○ OFFLINE'}</span></div><div class="mc-divider"></div><div class="mc-flow"><span>${k==='robot'?'Lettura pagina HTML':'Stato flusso PROFINET'}</span><b>${status}</b></div>${content}</article>`;}
function patchCardNode(current,next){
  if(current.nodeType!==next.nodeType||current.nodeName!==next.nodeName){current.replaceWith(next.cloneNode(true));return;}
  if(current.nodeType===Node.TEXT_NODE){if(current.nodeValue!==next.nodeValue)current.nodeValue=next.nodeValue;return;}
  if(current.nodeType!==Node.ELEMENT_NODE)return;
  for(const attribute of [...current.attributes])if(!next.hasAttribute(attribute.name))current.removeAttribute(attribute.name);
  for(const attribute of [...next.attributes])if(current.getAttribute(attribute.name)!==attribute.value)current.setAttribute(attribute.name,attribute.value);
  const previous=[...current.childNodes],incoming=[...next.childNodes];
  incoming.forEach((node,index)=>{if(previous[index])patchCardNode(previous[index],node);else current.append(node.cloneNode(true));});
  previous.slice(incoming.length).forEach(node=>node.remove());
}
function renderCards(container,assets,s){
  const existing=new Map([...container.querySelectorAll(':scope > .machine-card')].map(card=>[card.dataset.code,card]));
  if(!existing.size)container.replaceChildren();
  assets.forEach((m,index)=>{
    const temp=document.createElement('template');temp.innerHTML=machineCard(m,s);
    const next=temp.content.firstElementChild;next.dataset.code=m.code;
    const current=existing.get(m.code)||next;
    if(existing.has(m.code)){patchCardNode(current,next);existing.delete(m.code);}
    if(container.children[index]!==current)container.insertBefore(current,container.children[index]||null);
  });
  existing.forEach(card=>card.remove());
}
function noRows(cols,msg){return `<tr><td colspan="${cols}" style="padding:23px;text-align:center;color:#83a9ca">${safe(msg)}</td></tr>`;}
function carouselStep(){const strip=$('overview-cards'),card=strip.querySelector('.machine-card');return card?card.getBoundingClientRect().width+14:strip.clientWidth*.8;}
function updateCarouselPosition(){const strip=$('overview-cards'),cards=[...strip.querySelectorAll('.machine-card')];if(!cards.length){$('asset-position').textContent='0 / 0';return;}const current=Math.min(cards.length,Math.max(1,Math.round(strip.scrollLeft/carouselStep())+1));$('asset-position').textContent=`${current} / ${cards.length}`;$('assets-prev').disabled=strip.scrollLeft<4;$('assets-next').disabled=strip.scrollLeft>=strip.scrollWidth-strip.clientWidth-4;}
function scrollAssets(direction){$('overview-cards').scrollBy({left:direction*carouselStep(),behavior:'smooth'});}
$('assets-prev').addEventListener('click',()=>scrollAssets(-1));
$('assets-next').addEventListener('click',()=>scrollAssets(1));
$('overview-cards').addEventListener('scroll',updateCarouselPosition,{passive:true});
$('overview-cards').addEventListener('keydown',event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();scrollAssets(event.key==='ArrowRight'?1:-1);}});
window.addEventListener('resize',updateCarouselPosition);
const assetStrip=$('overview-cards');
let assetDrag=null;
assetStrip.addEventListener('pointerdown',event=>{
  if(event.button!==0||event.pointerType==='touch')return;
  const bounds=assetStrip.getBoundingClientRect();
  if(event.clientY>=bounds.top+assetStrip.clientHeight)return;
  if(event.target.closest('button,a,input,select,textarea'))return;
  event.preventDefault();
  assetStrip.focus({preventScroll:true});
  assetDrag={id:event.pointerId,x:event.clientX,scroll:assetStrip.scrollLeft};
  assetStrip.setPointerCapture(event.pointerId);
  assetStrip.classList.add('is-dragging');
});
assetStrip.addEventListener('pointermove',event=>{
  if(!assetDrag||event.pointerId!==assetDrag.id)return;
  event.preventDefault();
  assetStrip.scrollLeft=assetDrag.scroll-(event.clientX-assetDrag.x);
});
function finishAssetDrag(event){
  if(!assetDrag||event.pointerId!==assetDrag.id)return;
  assetDrag=null;assetStrip.classList.remove('is-dragging');
  if(assetStrip.hasPointerCapture(event.pointerId))assetStrip.releasePointerCapture(event.pointerId);
}
assetStrip.addEventListener('pointerup',finishAssetDrag);
assetStrip.addEventListener('pointercancel',finishAssetDrag);
assetStrip.addEventListener('lostpointercapture',finishAssetDrag);
function renderSnapshot(s){latest=s;$('mode').textContent=s.mode;$('mode').classList.toggle('demo',s.mode==='DEMO');$('clock').textContent=new Date().toLocaleTimeString('it-IT');$('last-sync').textContent=clock(s.now);let n=s.flows.filter(f=>isRecent(f.last,s.now)).length;const robots=s.machines.filter(m=>kind(m)==='robot'),robotsOnline=robots.filter(m=>m.online).length;$('stat-nodes').textContent=n;$('stat-robots').textContent=robotsOnline;$('stat-monitored').textContent=s.machines.length;$('header-connection').textContent=n||robotsOnline?'DATI PRESENTI':'NESSUN DATO';$('footer-live').textContent=s.mode==='DEMO'?'Simulazione + robot':'Ricezione passiva + robot';$('link-dot').classList.toggle('off',!n&&!robotsOnline);
$('kpi-pieces').textContent=fmt(s.machines.reduce((a,m)=>a+Number(m.pieces||0),0));$('kpi-hour').textContent=fmt(s.machines.reduce((a,m)=>a+Number(m.hour||0),0));$('kpi-siren').textContent=fmt(s.machines.reduce((a,m)=>a+Number(m.siren||0),0));$('kpi-robots').textContent=robotsOnline;$('kpi-online').textContent=n;
const rank={production:0,provisional:1,robot:2,siren:3,unmapped:4},assets=[...s.machines].sort((a,b)=>rank[kind(a)]-rank[kind(b)]);const strip=$('overview-cards');
renderCards(strip,assets,s);renderCards($('all-machines'),assets,s);updateCarouselPosition();updateSession(s.session);
const plc=s.machines.filter(m=>kind(m)!=='robot');
const plcOnline=plc.filter(m=>isRecent(m.frame_time,s.now)||s.flows.some(f=>f.machine===m.code&&isRecent(f.last,s.now))).length;
$('dash-machines').textContent=`${plcOnline} / ${plc.length}`;
$('dash-centers').textContent=`${robotsOnline} / ${robots.length}`;
$('dash-pieces').textContent=$('kpi-pieces').textContent;
$('dash-hour').textContent=$('kpi-hour').textContent;
$('dash-flows').textContent=`${n} / ${s.flows.length}`;
$('flow-body').innerHTML=s.flows.map(f=>`<tr><td><strong>${safe(f.node)}</strong></td><td>${safe(f.ip)}</td><td>${safe(f.mac)}</td><td>${safe(f.fid)}</td><td>${safe(f.machine)}</td><td>${fmt(f.frames)}</td><td><span class="tag ${isRecent(f.last,s.now)?'':'bad'}">${isRecent(f.last,s.now)?'● PRESENTE':'○ ASSENTE'}</span></td></tr>`).join('')||noRows(7,'Nessun flusso configurato');
const filter=$('mac-filter'),old=filter.value;filter.replaceChildren(new Option('Tutti i MAC',''),...s.flows.map(f=>new Option(f.mac,f.mac)));filter.value=[...filter.options].some(o=>o.value===old)?old:'';
const machineSelect=$('marker-machine'),selected=machineSelect.value;machineSelect.replaceChildren(...s.machines.map(m=>new Option(m.code+' · '+m.name,m.code)));machineSelect.value=s.machines.some(m=>m.code===selected)?selected:s.machines[0]?.code||'';
renderBits();refreshEventSources(s);}
function mappedFlowLabel(mac, fid){
  if(!latest)return mac;
  const flow=latest.flows.find(f=>f.mac.toLowerCase()===String(mac).toLowerCase() && f.fid===fid);
  return flow && flow.machine && flow.machine!=='Da identificare' ? flow.machine.replace(/ · Sirena$/, '') : mac;
}
function renderBits(){if(!latest)return;let filter=$('mac-filter').value;let bits=latest.bits.filter(b=>!filter||b.mac===filter);let rows=bits.slice(0,150).map(b=>`<tr><td><span class="event-bullet"></span>${safe(mappedFlowLabel(b.mac,b.fid))}</td><td>${safe(b.fid)}</td><td>${b.offset}</td><td>${b.bit}</td><td>${fmt(b.changes)}</td><td>${fmt(b.rises)}</td><td>${clock(b.last)}</td></tr>`).join('');$('bit-body').innerHTML=rows||noRows(7,'Nessuna transizione rilevata');$('overview-bits').innerHTML=bits.slice(0,12).map(b=>`<tr><td><span class="event-bullet"></span>${safe(mappedFlowLabel(b.mac,b.fid))}</td><td>${safe(b.fid)}</td><td>${b.offset}</td><td>${b.bit}</td><td>${fmt(b.changes)}</td><td>${fmt(b.rises)}</td><td>${clock(b.last)}</td></tr>`).join('')||noRows(7,'In attesa di variazioni dei bit');}
$('mac-filter').addEventListener('change',renderBits);
let lastEvents = [];
function eventType(kind){return kind==='PIEZZA'?'CONTATORE':kind;}
function refreshEventSources(s){
  const sel=$('event-source-filter');
  const current=sel.value;
  const options=[{value:'',label:'Tutte le macchine e i MAC'}];
  const seen=new Set();
  for(const m of s.machines){
    const code=String(m.code);
    if(!seen.has(code)){
      options.push({value:code,label:`${code} · ${m.name}`});
      seen.add(code);
    }
  }
  for(const f of s.flows){
    if(!f.machine||f.machine==='Da identificare'){
      const mac=String(f.mac).toUpperCase();
      const short=mac.slice(-8);
      if(!seen.has(short)){
        options.push({value:short,label:`MAC ${mac} · ${f.node}`});
        seen.add(short);
      }
    }
  }
  const signature=options.map(o=>o.value+'|'+o.label).join('~');
  if(sel.dataset.optionsSignature!==signature){
    sel.replaceChildren(...options.map(o=>new Option(o.label,o.value)));
    sel.dataset.optionsSignature=signature;
  }
  sel.value=options.some(o=>o.value===current)?current:'';
}
function renderEvents(events){
  lastEvents=events;
  const kind=$('event-kind-filter').value;
  const source=$('event-source-filter').value;
  const filtered=events.filter(e=>{
    if(kind&&eventType(e.kind)!==kind)return false;
    if(!source)return true;
    return String(e.machine).toUpperCase()===source.toUpperCase() ||
      String(e.machine).toUpperCase().endsWith(source.toUpperCase());
  });
  $('events-body').innerHTML=filtered.map(e=>{
    const k=eventType(e.kind);
    return `<tr><td>${clock(e.ts)}</td><td><span class="tag ${k==='SIRENA'?'sir':k==='BIT'?'bad':''}">${safe(k)}</span></td><td>${safe(e.machine)}</td><td>${safe(e.text)}</td></tr>`;
  }).join('')||noRows(4,'Nessun evento corrisponde ai filtri');
  // The compact home preview always displays all recent operational events.
  $('overview-events').innerHTML=events.filter(e=>eventType(e.kind)!=='BIT').slice(0,20).map(e=>{
    const k=eventType(e.kind);
    return `<tr><td>${clock(e.ts)}</td><td>${safe(e.machine)}</td><td><span class="event-bullet ${k==='SIRENA'?'sir':''}"></span>${safe(k)}</td><td>${safe(e.text)}</td></tr>`;
  }).join('')||noRows(4,'In attesa di eventi macchina');
}
$('event-kind-filter').addEventListener('change',()=>renderEvents(lastEvents));
$('event-source-filter').addEventListener('change',()=>renderEvents(lastEvents));
let busy=false;
async function refresh(){if(busy)return;busy=true;try{const [sr,er]=await Promise.all([localRequest('plc-reader-snapshot'),localRequest('plc-reader-events')]);if(!sr.ok||!er.ok)throw Error('Server locale non disponibile');renderSnapshot(await sr.json());renderEvents(await er.json());}catch(err){$('header-connection').textContent='SERVER NON DISPONIBILE';$('link-dot').classList.add('off');$('last-sync').textContent='CONNESSIONE PERSA';}finally{busy=false;}}
$('marker-form').addEventListener('submit',async e=>{e.preventDefault();const machine=$('marker-machine').value,note=$('marker-note').value.trim();if(!note)return;try{const r=await localRequest('plc-reader-marker',{machine,note});if(!r.ok)throw Error('Errore');$('marker-note').value='';$('marker-result').textContent='Marcatore salvato nel CSV locale.';refresh();}catch(err){$('marker-result').textContent=err.message||'Impossibile salvare il marcatore.';}});
const hash=location.hash.slice(1);if(names[hash])showView(hash);refresh();setInterval(refresh,1000);
async function localRequest(channel,payload){const data=await ipcRenderer.invoke(channel,payload);return {ok:true,json:async()=>data};}
let sessionInitialized=false;
function updateSession(session){
  if(!session)return;
  if(!sessionInitialized){$('session-adapter').value=session.adapter||'';$('session-python').value=session.python||'';sessionInitialized=true;}
  $('session-start').disabled=session.running;
  $('session-stop').disabled=!session.running;
  $('session-banner').textContent=session.error|| (session.running?(latest.mode==='DEMO'?'Sessione DEMO · Segnali PLC simulati · Robot reali':'Sessione LIVE · Acquisizione PROFINET attiva'):'Acquisizione PLC arrestata · Robot in aggiornamento automatico');
  $('session-banner').classList.toggle('has-error',Boolean(session.error));
  $('session-banner').classList.toggle('is-demo',session.running&&latest.mode==='DEMO');
  $('marker-form').querySelector('button').disabled=!session.running;
}
$('session-open').addEventListener('click',()=>$('session-dialog').showModal());
$('session-close').addEventListener('click',()=>$('session-dialog').close());
$('session-form').addEventListener('submit',async event=>{
  event.preventDefault();$('session-feedback').textContent='Avvio in corso…';
  try{await ipcRenderer.invoke('plc-reader-control',{action:'start',mode:$('session-mode').value,adapter:$('session-adapter').value,python:$('session-python').value});$('session-feedback').textContent='';$('session-dialog').close();await refresh();}
  catch(error){$('session-feedback').textContent=error.message;}
});
$('session-stop').addEventListener('click',async()=>{await ipcRenderer.invoke('plc-reader-control',{action:'stop'});await refresh();});
$('session-folder').addEventListener('click',()=>ipcRenderer.invoke('plc-reader-control',{action:'folder'}));
const detectButton=document.createElement('button');detectButton.type='button';detectButton.className='subtle-btn';detectButton.textContent='Rileva schede di rete';
const adapterSelect=document.createElement('select');adapterSelect.hidden=true;adapterSelect.setAttribute('aria-label','Schede di acquisizione disponibili');
$('session-adapter').parentElement.append(adapterSelect,detectButton);
adapterSelect.addEventListener('change',()=>{$('session-adapter').value=adapterSelect.value;});
detectButton.addEventListener('click',async()=>{
  detectButton.disabled=true;$('session-feedback').textContent='Rilevamento schede…';
  try{const interfaces=await ipcRenderer.invoke('plc-reader-interfaces',{python:$('session-python').value});adapterSelect.replaceChildren(...interfaces.map(item=>new Option(item.name,item.id)));adapterSelect.hidden=false;if(interfaces.some(item=>item.id===$('session-adapter').value))adapterSelect.value=$('session-adapter').value;else if(interfaces.length)$('session-adapter').value=interfaces[0].id;$('session-feedback').textContent=interfaces.length+' schede disponibili';}
  catch(error){$('session-feedback').textContent=error.message;}
  finally{detectButton.disabled=false;}
});

