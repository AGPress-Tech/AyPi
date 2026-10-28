// @ts-nocheck
export function createMesOperations(ctx) {
 const {randomUUID}=require('crypto');
 const esc=(v)=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
 const byId=(id)=>document.getElementById(id);
 let phaseId='',links=[],catalog=[],loading=false,manualRequestId='',manualSessionId='',manualKind='PIECES',manualBusy=false,openVersion=0;
 let picker=false,draft=[],candidate=null,draftLoaded=Promise.resolve(),draftChanged=false,draftVersion=0;
 const root=document.createElement('div');
 root.innerHTML=`<div class="dialog-backdrop" id="mes-manual-dialog" aria-hidden="true"><form class="dialog dialog--compact" id="mes-manual-form">
 <header class="dialog__header"><div><span class="eyebrow">DICHIARAZIONE OPERATORE</span><h2 id="mes-manual-title"></h2></div><button type="button" class="dialog__close" data-close-manual aria-label="Chiudi">×</button></header>
 <div class="mes-activation-body"><p id="mes-manual-context"></p><div class="mes-operator-picker"><label>Reparto<select id="mes-manual-department" required></select></label><label>Operatore<select id="mes-manual-operator" required></select></label></div>
 <label id="mes-manual-quantity-label">Pezzi prodotti<input id="mes-manual-quantity" type="number" min="1" step="1" inputmode="numeric"></label><label>Causale<input id="mes-manual-reason" maxlength="120"></label><label>Note<textarea id="mes-manual-note" maxlength="1000" rows="3"></textarea></label><p class="form-error" id="mes-manual-error" role="alert"></p></div>
 <footer class="dialog__footer"><button type="button" data-close-manual class="button button--ghost">Annulla</button><button type="submit" class="button button--primary" id="mes-manual-submit">Conferma dichiarazione</button></footer></form></div>
 <div class="dialog-backdrop" id="mes-sheets-dialog" aria-hidden="true"><section class="dialog dialog--mes-sheets" role="dialog" aria-modal="true" aria-labelledby="mes-sheets-title">
 <header class="dialog__header"><div><span class="eyebrow">DOCUMENTAZIONE DI PRODUZIONE</span><h2 id="mes-sheets-title">Schede di attrezzaggio</h2></div><button type="button" data-close-sheets class="dialog__close" aria-label="Chiudi">×</button></header>
 <div class="mes-sheets-body"><p id="mes-sheets-context"></p><p id="mes-sheets-feedback" role="status"></p><div id="mes-linked-sheets" class="mes-sheet-selection"></div><div class="mes-sheets-search"><label>Cerca scheda<input id="mes-sheet-search" type="search" placeholder="Articolo, macchina, metodo o ID"></label><label>Archivio<select id="mes-sheet-type"><option value="">Tutti gli archivi</option><option value="TRANSFER">Transfer</option><option value="CENTRI">Centri</option></select></label><button class="button button--ghost" id="mes-sheet-show-all" type="button">Mostra tutte</button></div><div class="mes-sheets-workspace"><section class="mes-sheet-results" aria-label="Schede disponibili"><div class="mes-sheet-list-heading"><span>Schede disponibili</span><small id="mes-sheet-result-count"></small></div><div class="mes-sheet-catalog" id="mes-sheet-catalog"></div></section><section id="mes-sheet-preview" class="mes-sheet-preview"><div class="mes-sheet-preview-empty"><strong>Anteprima scheda</strong><p>Apri un’anteprima per controllare i dettagli prima di scegliere.</p></div></section></div></div>
 <footer class="dialog__footer"><span id="mes-sheet-footer-hint">La scheda originale resta nel suo archivio.</span><button type="button" data-close-sheets class="button button--ghost">Chiudi</button></footer></section></div>`;
 document.body.appendChild(root);
 const pickerOk=document.createElement('button');pickerOk.type='button';pickerOk.className='button button--primary';pickerOk.textContent='OK';pickerOk.hidden=true;
 byId('mes-sheets-dialog').querySelector('footer').appendChild(pickerOk);
 const previewWindow=document.createElement('div');previewWindow.id='mes-sheet-preview-dialog';previewWindow.className='dialog-backdrop';previewWindow.setAttribute('aria-hidden','true');
 previewWindow.innerHTML='<section class="dialog dialog--sheet-document" role="dialog" aria-modal="true" aria-labelledby="mes-sheet-document-title"><header class="dialog__header"><div><span class="eyebrow">DOCUMENTAZIONE DI PRODUZIONE</span><h2 id="mes-sheet-document-title">Anteprima scheda attrezzaggio</h2></div><button type="button" class="dialog__close" data-close-sheet-preview aria-label="Chiudi">×</button></header><div class="mes-sheet-document-body"></div><footer class="dialog__footer"><span id="mes-sheet-document-feedback" role="status"></span><button type="button" class="button button--ghost" data-close-sheet-preview>Annulla</button><button type="button" class="button button--primary" id="mes-sheet-preview-attach">Allega</button></footer></section>';
 root.appendChild(previewWindow);previewWindow.querySelector('.mes-sheet-document-body').appendChild(byId('mes-sheet-preview'));
 const sheetMenu=document.createElement('div');sheetMenu.id='mes-sheet-context-menu';sheetMenu.className='mes-sheet-context-menu';sheetMenu.hidden=true;sheetMenu.setAttribute('role','menu');sheetMenu.innerHTML='<button type="button" role="menuitem" data-sheet-menu="preview">Anteprima</button><button type="button" role="menuitem" data-sheet-menu="attach">Allega</button>';root.appendChild(sheetMenu);
 let menuSheet=null,previewSheet=null,previewVersion=0;
 function closeSheetMenu(){sheetMenu.hidden=true;}
 function openSheetMenu(row,x,y){menuSheet=catalog.find(s=>s.recordId===row.dataset.catalogSheet&&s.type===row.dataset.sheetType);if(!menuSheet)return;sheetMenu.hidden=false;const rect=sheetMenu.getBoundingClientRect();sheetMenu.style.left=Math.max(8,Math.min(x,innerWidth-rect.width-8))+'px';sheetMenu.style.top=Math.max(8,Math.min(y,innerHeight-rect.height-8))+'px';sheetMenu.querySelector('button').focus();}
 byId('mes-sheet-catalog').oncontextmenu=e=>{const row=e.target.closest('[data-catalog-sheet]');if(!row)return;e.preventDefault();openSheetMenu(row,e.clientX,e.clientY);};
 byId('mes-sheet-catalog').onkeydown=e=>{const row=e.target.closest('[data-catalog-sheet]');if(!row)return;if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10')){e.preventDefault();const r=row.getBoundingClientRect();openSheetMenu(row,r.left+20,r.top+20);}if(e.key==='Enter'){e.preventDefault();showCatalogPreview(catalog.find(s=>s.recordId===row.dataset.catalogSheet&&s.type===row.dataset.sheetType));}};
 async function attachSheet(item){if(!item||loading)return;
  if(picker){candidate=item;draft=[item];draftChanged=true;renderDraft();ctx.closeDialog('mes-sheet-preview-dialog');ctx.closeDialog('mes-sheets-dialog');return;}
  loading=true;byId('mes-sheet-preview-attach').disabled=true;
  try{links=await ctx.invoke('mes-setup-link',{phaseId,body:{type:item.type,recordId:item.recordId}});renderLinks();ctx.closeDialog('mes-sheet-preview-dialog');feedback('Scheda allegata.');}catch(error){feedback(error.message||String(error),true);byId('mes-sheet-document-feedback').textContent=error.message||String(error);}finally{loading=false;byId('mes-sheet-preview-attach').disabled=false;}
 }
 async function showCatalogPreview(item){if(!item)return;const token=openVersion,version=++previewVersion;closeSheetMenu();feedback('Caricamento anteprima…');try{const result=await ctx.invoke('mes-setup-preview',{type:item.type,recordId:item.recordId});if(token!==openVersion||version!==previewVersion)return;preview(result);feedback('');}catch(error){feedback(error.message||String(error),true);}}
 sheetMenu.onclick=e=>{const action=e.target.closest('[data-sheet-menu]');if(!action)return;closeSheetMenu();if(action.dataset.sheetMenu==='preview')void showCatalogPreview(menuSheet);else void attachSheet(menuSheet);};
 byId('mes-sheet-preview-attach').onclick=()=>attachSheet(previewSheet);
 document.addEventListener('pointerdown',e=>{if(!sheetMenu.contains(e.target))closeSheetMenu();},true);
 byId('mes-sheet-catalog').addEventListener('scroll',closeSheetMenu);window.addEventListener('resize',closeSheetMenu);
 function resetPreview(){byId('mes-sheet-preview').hidden=false;byId('mes-sheet-preview').innerHTML='<div class="mes-sheet-preview-empty"><strong>Anteprima scheda</strong><p>Apri un’anteprima per controllare i dettagli prima di scegliere.</p></div>';}
 function renderDraft(){
  byId('job-setup-sheets').textContent=draft.length?draft.map(s=>s.recordId).join(', '):'Seleziona una scheda attrezzaggio…';
  byId('job-sheet-description').textContent=draft.map(s=>s.label).join(' · ');
 }
 function resetOrderSheet(id){const version=++draftVersion;draft=[];draftChanged=false;renderDraft();
  draftLoaded=id?ctx.invoke('mes-setup-links',{phaseId:id}).then(result=>{if(version===draftVersion&&!draftChanged){draft=result;renderDraft();}}).catch(error=>{if(version===draftVersion)byId('job-sheet-description').textContent='Impossibile caricare la scheda: '+error.message;throw error;}):Promise.resolve();
  void draftLoaded.catch(()=>{});
 }
 async function openOrderSheetPicker(article){
  try{await draftLoaded;}catch(error){ctx.notify('Impossibile leggere i collegamenti: riprova aprendo l’ordine.');return;}
  picker=true;candidate=draft[0]||null;pickerOk.hidden=true;const token=++openVersion;catalog=[];links=[];
  byId('mes-sheets-title').textContent='Seleziona scheda attrezzaggio';byId('mes-sheets-context').textContent='Tasto destro su una scheda per aprire l’anteprima o allegarla all’ordine.';byId('mes-sheet-footer-hint').textContent='La scelta verrà salvata con l’ordine.';
  byId('mes-sheet-search').value=article||'';byId('mes-sheet-type').value='';resetPreview();feedback('Caricamento schede…');renderPicker();ctx.openDialog('mes-sheets-dialog');
  try{const result=await ctx.invoke('mes-setup-catalog',{});if(token!==openVersion)return;catalog=result.rows||[];renderCatalog();feedback('');}catch(error){feedback(error.message||String(error),true);}
 }
 function renderPicker(){byId('mes-linked-sheets').innerHTML=`<div><small>Scheda selezionata</small><strong>${candidate?esc(candidate.label):'Nessuna scheda'}</strong>${candidate?`<span>ID: ${esc(candidate.recordId)}</span>`:''}</div><button type="button" class="button button--ghost" data-clear-sheet ${candidate?'':'disabled'}>Rimuovi scelta</button>`;renderCatalog();}
 pickerOk.onclick=()=>{draft=candidate?[candidate]:[];draftChanged=true;renderDraft();ctx.closeDialog('mes-sheets-dialog');};
 async function saveOrderSheet(id){await draftLoaded;if(!draftChanged)return;
  let current=await ctx.invoke('mes-setup-links',{phaseId:id});
  // Add the selected sheet first: an unavailable sheet must not erase the existing link.
  if(draft[0]&&!current.some(s=>s.recordId===draft[0].recordId&&s.type===draft[0].type))current=await ctx.invoke('mes-setup-link',{phaseId:id,body:{type:draft[0].type,recordId:draft[0].recordId}});
  for(const sheet of current)if(!draft.some(s=>s.recordId===sheet.recordId&&s.type===sheet.type))await ctx.invoke('mes-setup-unlink',{phaseId:id,linkId:sheet.linkId});
  draftChanged=false;
 }
 function renderOperators(preferred='') {
  const groups=ctx.groups(),department=byId('mes-manual-department').value,names=[...(groups[department]||[])].sort();
  byId('mes-manual-operator').innerHTML='<option value="">Seleziona operatore…</option>'+names.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join('');
  if(names.includes(preferred))byId('mes-manual-operator').value=preferred;
 }
 function openManual(sessionId,kind) {
  const session=ctx.sessions().find(s=>s.sessionId===sessionId);if(!session)return;
  manualSessionId=sessionId;manualKind=kind;manualRequestId=randomUUID();
  byId('mes-manual-title').textContent={START:'Avvia macchina',STOP:'Dichiara fermo macchina',PIECES:'Dichiara pezzi prodotti'}[kind];
  byId('mes-manual-context').textContent=`${ctx.machineName(session.machineId)} · ${session.orderNumber} · ${session.articleCode}. Data e ora verranno registrate alla conferma.`;
  const preferred=session.operatorNames?.[0]||'',groups=ctx.groups(),department=Object.keys(groups).find(d=>groups[d].includes(preferred))||'';
  byId('mes-manual-department').innerHTML='<option value="">Seleziona reparto…</option>'+Object.keys(groups).sort().map(d=>`<option value="${esc(d)}">${esc(d)}</option>`).join('');
  byId('mes-manual-department').value=department;renderOperators(preferred);
  byId('mes-manual-quantity-label').hidden=kind!=='PIECES';byId('mes-manual-quantity').required=kind==='PIECES';byId('mes-manual-quantity').value='';
  byId('mes-manual-reason').value={START:'AVVIO_MANUALE',STOP:'FERMO_MANUALE',PIECES:'PRODUZIONE_MANUALE'}[kind];byId('mes-manual-note').value='';byId('mes-manual-error').textContent='';ctx.openDialog('mes-manual-dialog');
 }
 byId('mes-manual-department').onchange=()=>renderOperators();
 byId('mes-manual-form').onsubmit=async e=>{
  e.preventDefault();if(manualBusy)return;
  const session=ctx.sessions().find(s=>s.sessionId===manualSessionId),operatorName=byId('mes-manual-operator').value;
  if(!session||!operatorName){byId('mes-manual-error').textContent='Seleziona un operatore e un ordine attivo.';return;}
  manualBusy=true;byId('mes-manual-submit').disabled=true;byId('mes-manual-submit').textContent='Registrazione…';
  try{await ctx.invoke('mes-manual-declare',{sessionId:manualSessionId,body:{declarationId:manualRequestId,baseRevision:session.revision,kind:manualKind,
   quantity:manualKind==='PIECES'?Number(byId('mes-manual-quantity').value):0,operatorName,reasonCode:byId('mes-manual-reason').value.trim(),note:byId('mes-manual-note').value.trim()}});
   ctx.closeDialog('mes-manual-dialog');await ctx.refresh();ctx.notify('Dichiarazione registrata.');
  }catch(error){byId('mes-manual-error').textContent=error.message||String(error);await ctx.refresh({quiet:true});}
  finally{manualBusy=false;byId('mes-manual-submit').disabled=false;byId('mes-manual-submit').textContent='Conferma dichiarazione';}
 };
 function feedback(text,error=false){byId('mes-sheets-feedback').textContent=text;byId('mes-sheets-feedback').classList.toggle('form-error',error);}
 function renderCatalog(){const search=byId('mes-sheet-search').value.toLowerCase(),type=byId('mes-sheet-type').value;
  const selected=new Set(links.map(l=>`${l.type}:${l.recordId}`));const list=catalog.filter(i=>(!type||i.type===type)&&(!search||`${i.label} ${i.article} ${i.recordId}`.toLowerCase().includes(search)));
  byId('mes-sheet-result-count').textContent=`${list.length} ${list.length===1?'scheda':'schede'}`;
  byId('mes-sheet-catalog').innerHTML=list.length?list.map(i=>{const active=picker?candidate?.recordId===i.recordId&&candidate?.type===i.type:selected.has(`${i.type}:${i.recordId}`);return `<div class="mes-sheet-row ${active?'is-selected':''}" tabindex="0" data-catalog-sheet="${esc(i.recordId)}" data-sheet-type="${i.type}" aria-label="${esc(i.label)}"><div><small class="mes-sheet-archive">${i.type==='TRANSFER'?'Transfer':'Centri'}</small><strong>${esc(i.label)}</strong><small class="mes-sheet-id" title="${esc(i.recordId)}">ID: ${esc(i.recordId)}</small></div>${active?'<span class="mes-sheet-selected-badge">Allegata</span>':''}</div>`;}).join(''):'<p class="mes-sheet-empty">Nessuna scheda trovata. Modifica i filtri o mostra tutte le schede.</p>';
 }
 function renderLinks(){byId('mes-linked-sheets').innerHTML=links.length?links.map(l=>`<div class="mes-sheet-row"><div><strong>${esc(l.type)} · ${esc(l.label)}</strong><small>Collegata da ${esc(l.linkedBy)} · ${esc(new Date(l.linkedAt).toLocaleString('it-IT'))}</small></div><button class="button button--ghost" type="button" data-view-sheet="${l.linkId}">Visualizza</button><button class="button button--ghost" type="button" data-unlink-sheet="${l.linkId}">Scollega</button></div>`).join(''):'<p>Nessuna scheda collegata. Selezionala dagli archivi qui sotto.</p>';renderCatalog();}
 async function openSheets(id){const selected=ctx.phase(id);if(!selected)return;phaseId=id;const token=++openVersion;links=[];catalog=[];
  picker=false;pickerOk.hidden=true;byId('mes-sheets-title').textContent='Schede di attrezzaggio';
  byId('mes-sheet-footer-hint').textContent='La scheda originale resta nel suo archivio.';
  byId('mes-sheets-context').textContent=`Ordine ${selected.order.orderNumber} · ${selected.phase.articleCode} · fase ${selected.phase.phaseCode}`;
  byId('mes-sheet-search').value=selected.phase.articleCode||'';byId('mes-sheet-type').value='';resetPreview();feedback('Caricamento schede…');renderLinks();ctx.openDialog('mes-sheets-dialog');
  try{const results=await Promise.all([ctx.invoke('mes-setup-links',{phaseId:id}),ctx.invoke('mes-setup-catalog',{})]);if(token!==openVersion)return;[links,catalog]=results;catalog=catalog.rows||[];renderLinks();feedback('');}
  catch(error){if(token===openVersion)feedback(error.message||String(error),true);}
 }
 const labels={codiceArticolo:'Articolo',fase:'Fase',codiceMacchina:'Macchina',macchina:'Macchina',metodoVariante:'Metodo / variante',metodo:'Metodo',lavorazione:'Lavorazione',cicloLavorazione:'Ciclo lavorazione',cicloLavoro:'Ciclo lavoro',spessori:'Spessori',vitiRondelle:'Viti / rondelle',spine:'Spine',programmaRobot:'Programma robot',mani:'Mani',morsetti:'Morsetti',numeroProgramma:'Programma',denominazioneArticolo:'Descrizione',note:'Note'};
 function preview(link){const sheet=link.sheet,tools=sheet.utensili||[],keys=[...new Set(tools.flatMap(t=>Object.keys(t)))].filter(k=>!['id','recordId'].includes(k));
  byId('mes-sheet-preview').innerHTML=`<h3>${esc(link.label)}</h3><p>ID: ${esc(link.recordId)}${link.linkedAt?' · Versione collegata il '+esc(new Date(link.linkedAt).toLocaleString('it-IT')):''}</p><dl class="mes-sheet-fields">${Object.entries(labels).filter(([key])=>sheet[key]).map(([key,label])=>`<dt>${label}</dt><dd>${esc(sheet[key])}</dd>`).join('')}</dl>${tools.length?`<h4>Utensili</h4><div class="mes-sheet-tools"><table><thead><tr>${keys.map(k=>`<th>${esc(k.replace(/([A-Z])/g,' $1'))}</th>`).join('')}</tr></thead><tbody>${tools.map(t=>`<tr>${keys.map(k=>`<td>${esc(typeof t[k]==='object'?JSON.stringify(t[k]):t[k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:''}<div class="mes-sheet-files">${link.linkId?(sheet.attachments||[]).map(a=>`<button class="button button--ghost" type="button" data-sheet-attachment="${esc(a.id)}" data-link-id="${link.linkId}">Apri ${esc(a.originalName||'allegato')}</button>`).join(''):''}</div>`;
  previewSheet=link;byId('mes-sheet-preview').hidden=false;byId('mes-sheet-document-feedback').textContent='';byId('mes-sheet-preview-attach').hidden=!!link.linkId;ctx.openDialog('mes-sheet-preview-dialog');
 }
 root.onclick=async e=>{
  if(e.target.closest('[data-close-sheet-preview]')){if(!loading)ctx.closeDialog('mes-sheet-preview-dialog');return;}
  if(e.target.closest('[data-close-manual]')){if(!manualBusy)ctx.closeDialog('mes-manual-dialog');return;}
  if(e.target.closest('[data-close-sheets]')){++openVersion;++previewVersion;closeSheetMenu();ctx.closeDialog('mes-sheets-dialog');return;}
  if(picker&&e.target.closest('[data-clear-sheet]')){candidate=null;draft=[];draftChanged=true;renderDraft();renderPicker();return;}
  const catalogPreview=e.target.closest('[data-preview-catalog]');
  if(catalogPreview){const token=openVersion;try{const item=await ctx.invoke('mes-setup-preview',{type:catalogPreview.dataset.sheetType,recordId:catalogPreview.dataset.previewCatalog});if(token===openVersion)preview(item);}catch(error){feedback(error.message||String(error),true);}return;}
  const view=e.target.closest('[data-view-sheet]');if(view){const link=links.find(l=>l.linkId===view.dataset.viewSheet);if(link)preview(link);return;}
  const link=e.target.closest('[data-link-sheet]'),unlink=e.target.closest('[data-unlink-sheet]'),attachment=e.target.closest('[data-sheet-attachment]');
  if(picker&&link){candidate=catalog.find(s=>s.recordId===link.dataset.linkSheet&&s.type===link.dataset.sheetType);renderPicker();return;}
  if(loading||(!link&&!unlink&&!attachment))return;
  if(unlink&&!await ctx.confirm('Scollegare la scheda da questa fase? La scheda originale resterà nel suo archivio.','Scollega'))return;
  loading=true;const button=link||unlink||attachment;button.disabled=true;
  try{if(attachment)await ctx.invoke('mes-setup-attachment-open',{linkId:attachment.dataset.linkId,attachmentId:attachment.dataset.sheetAttachment});
   else{links=await ctx.invoke(link?'mes-setup-link':'mes-setup-unlink',link?{phaseId,body:{type:link.dataset.sheetType,recordId:link.dataset.linkSheet}}:{phaseId,linkId:unlink.dataset.unlinkSheet});renderLinks();if(unlink)byId('mes-sheet-preview').hidden=true;feedback(link?'Scheda collegata.':'Collegamento rimosso.');}
  }catch(error){feedback(error.message||String(error),true);}finally{loading=false;button.disabled=false;}
 };
 byId('mes-sheet-search').oninput=renderCatalog;byId('mes-sheet-type').onchange=renderCatalog;byId('mes-sheet-show-all').onclick=()=>{byId('mes-sheet-search').value='';byId('mes-sheet-type').value='';renderCatalog();};
 document.addEventListener('keydown',e=>{if(e.key!=='Escape')return;if(!sheetMenu.hidden){e.preventDefault();e.stopImmediatePropagation();closeSheetMenu();return;}for(const id of ['mes-sheet-preview-dialog','mes-manual-dialog','mes-sheets-dialog'])if(byId(id).classList.contains('is-open')){e.preventDefault();e.stopImmediatePropagation();if(!manualBusy&&!loading){++previewVersion;ctx.closeDialog(id);}return;}},true);
 return {openManual,openSheets,resetOrderSheet,openOrderSheetPicker,saveOrderSheet};
}
