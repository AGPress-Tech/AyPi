import type Chart from 'chart.js/auto';
import { randomUUID } from 'crypto';
import { EVENT_LABELS,type FornoViewSettings } from '../../../main/modules/forno/preferences';

export type OvenNote={id:string;timestampMs:number;text:string;author:string;createdAt:number;updatedAt:number;editedBy:string;revision:number};
export type OvenEvent={id:string;timestampMs:number;type:string;message:string;detail:any};
type Messages={notes:OvenNote[];events:OvenEvent[];truncated:boolean;revision?:number;unchanged?:boolean};
type Group={kind:'note'|'event';items:(OvenNote|OvenEvent)[];x:number;key:string};

export function setupAnnotations(chart:Chart<'line'>,options:{
    settings():FornoViewSettings;range():{start:number;end:number};formatTime(t:number):string;
    list(input:any):Promise<Messages>;sample(timestampMs:number):Promise<{timestampMs:number|null}>;
    save(input:any):Promise<OvenNote>;remove(input:{id:string;revision:number}):Promise<any>;
}) {
    const get=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
    const layer=get('annotation-layer'),popup=get('annotation-popup'),menu=get('note-context-menu'),notice=get('annotation-notice');
    const editor=get<HTMLDialogElement>('note-editor'),deleteDialog=get<HTMLDialogElement>('note-delete-dialog');
    const input=get<HTMLTextAreaElement>('note-text'),save=get<HTMLButtonElement>('note-save');
    const abort=new AbortController(),signal=abort.signal;
    let data:Messages={notes:[],events:[],truncated:false},revision=0,layoutKey='',active:Group|null=null;
    let selected:OvenNote|null=null,menuGroup:Group|null=null;
    let editing:OvenNote|null=null,editingTime:number|null=null,token='',editorGeneration=0,deleteGeneration=0;
    let busy=false,pending=false,disposed=false,lastSync=0,coverage:{start:number;end:number;filter:string;revision?:number}|null=null;
    let noticeTimer:ReturnType<typeof setTimeout>|undefined;
    let popupKey='';
    const markers=new Map<string,{button:HTMLElement;group:Group}>();
    function node(tag:string,className:string,text?:string){const n=document.createElement(tag);n.className=className;if(text!==undefined)n.textContent=text;return n;}
    function toast(text:string){notice.textContent=text;notice.hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>{notice.hidden=true;},5000);}
    function closePopup(){active=null;popup.hidden=true;}
    function closeMenu(){menu.hidden=true;}
    function showMenu(event:MouseEvent,group:Group,note:OvenNote|null) {
        event.preventDefault();event.stopPropagation();selected=note;menuGroup=group;
        get('note-context-open').hidden=!!note;get('note-context-edit').hidden=!note;get('note-context-delete').hidden=!note;
        menu.hidden=false;const box=menu.getBoundingClientRect();
        menu.style.left=Math.max(8,Math.min(event.clientX,innerWidth-box.width-8))+'px';menu.style.top=Math.max(8,Math.min(event.clientY,innerHeight-box.height-8))+'px';
        (note?get('note-context-edit'):get('note-context-open')).focus();
    }
    function renderPopup(group:Group) {
        const contentKey=group.kind+':'+group.items.map(item=>item.id+':'+('revision' in item?item.revision:0)).join(',');
        if(contentKey!==popupKey){
        popupKey=contentKey;
        popup.replaceChildren();
        const heading=node('div','annotation-popup-heading');heading.append(node('strong','',group.kind==='note'?'Note operatore':'Eventi del forno'));
        const close=node('button','icon-close','×');close.setAttribute('aria-label','Chiudi messaggio');close.addEventListener('click',closePopup);heading.append(close);popup.append(heading);
        const list=node('div','annotation-popup-list');
        for(const item of group.items) {
            const entry=node('article','annotation-entry');entry.append(node('time','',options.formatTime(item.timestampMs)));
            if(group.kind==='note') {
                const note=item as OvenNote;entry.dataset.noteId=note.id;
                entry.append(node('p','annotation-text',note.text),node('small','',note.author+(note.revision>1?' · modificata da '+note.editedBy:'')));
                entry.addEventListener('contextmenu',event=>showMenu(event,group,note));
            }else {
                const event=item as OvenEvent;entry.append(node('strong','annotation-event-kind',EVENT_LABELS[event.type]||event.type),node('p','annotation-text',event.message),node('small','','Rilevato dal backend'));
            }
            list.append(entry);
        }
        popup.append(list);
        }
        popup.hidden=false;
        const width=Math.min(320,chart.chartArea.width-16);
        popup.style.width=width+'px';popup.style.left=Math.max(chart.chartArea.left+4,Math.min(group.x+16,chart.chartArea.right-width-4))+'px';
        popup.style.top=(chart.chartArea.top+42)+'px';popup.style.maxHeight=Math.max(110,Math.min(250,chart.chartArea.height-48))+'px';
    }
    function draw() {
        if(disposed||!chart.scales.x)return;
        const settings=options.settings(),axis=chart.scales.x,a=chart.chartArea;
        const key=[revision,axis.min,axis.max,a.left,a.right,a.top,a.bottom,settings.showNotes,settings.showEvents,settings.eventTypes.join(',')].join('|');
        if(key===layoutKey)return;layoutKey=key;
        const groups=new Map<string,Group>();
        const add=(kind:'note'|'event',item:OvenNote|OvenEvent)=>{
            if(item.timestampMs<axis.min||item.timestampMs>axis.max)return;
            const x=axis.getPixelForValue(item.timestampMs),slot=Math.round((x-a.left)/24),id=kind+':'+slot;
            if(!groups.has(id))groups.set(id,{kind,items:[],x,key:''});groups.get(id)!.items.push(item);
        };
        if(settings.showNotes)for(const note of data.notes)add('note',note);
        if(settings.showEvents)for(const event of data.events)if(settings.eventTypes.includes(event.type))add('event',event);
        const seen=new Set<string>();let activeGroup:Group|null=null;
        for(const group of groups.values()) {
            group.key=group.kind+':'+group.items.map(i=>i.id).join(',');
            let record=markers.get(group.key);
            if(!record){record={button:node('button','message-marker '+group.kind),group};markers.set(group.key,record);layer.append(record.button);
                const current=record;
                record.button.addEventListener('click',()=>{const g=current.group;if(active?.key===g.key)closePopup();else{active=g;renderPopup(g);}});
                record.button.addEventListener('contextmenu',event=>{const g=current.group;showMenu(event,g,g.kind==='note'&&g.items.length===1?g.items[0] as OvenNote:null);});
                record.button.append(node('span','',group.kind==='note'?'✎':'◆'));if(group.items.length>1)record.button.append(node('sup','',String(group.items.length)));
            }
            record.group=group;seen.add(group.key);
            const marker=record.button;marker.dataset.kind=group.kind;marker.dataset.id=group.items[0].id;
            marker.setAttribute('aria-label',`${group.items.length} ${group.kind==='note'?'note':'eventi'} · ${options.formatTime(group.items[0].timestampMs)}`);
            marker.title=marker.getAttribute('aria-label')!;
            marker.style.left=Math.max(a.left,Math.min(group.x-10,a.right-23))+'px';marker.style.top=(a.top+(group.kind==='note'?5:30))+'px';
            if(active&&group.items.some(item=>active!.items.some(old=>old.id===item.id&&active!.kind===group.kind)))activeGroup=group;
        }
        for(const [key,record]of markers)if(!seen.has(key)){record.button.remove();markers.delete(key);}
        if(activeGroup){active=activeGroup;renderPopup(activeGroup);}else if(active)closePopup();
    }
    async function refresh(force=false) {
        if(disposed)return;
        const settings=options.settings(),range=options.range(),filter=[settings.showNotes,settings.showEvents,settings.eventTypes.join(',')].join('|');
        draw();
        if(!settings.showNotes&&!settings.showEvents){data={notes:[],events:[],truncated:false};revision++;draw();return;}
        if(!force&&coverage?.filter===filter&&coverage.start<=range.start&&coverage.end>=range.end&&Date.now()-lastSync<4500)return;
        if(busy){pending ||= force||!coverage||coverage.filter!==filter||coverage.start>range.start||coverage.end<range.end;return;}
        busy=true;const margin=Math.max(0,Math.min((range.end-range.start)/4,(366*86400000-(range.end-range.start))/2));
        const reusable=coverage?.filter===filter&&coverage.start<=range.start&&coverage.end>=range.end;
        const fromMs=reusable?coverage!.start:Math.max(0,Math.floor(range.start-margin)),toMs=reusable?coverage!.end:Math.ceil(range.end+margin);
        try {
            const response=await options.list({fromMs,toMs,showNotes:settings.showNotes,eventTypes:settings.showEvents?settings.eventTypes:[],revision:reusable?coverage?.revision:undefined});
            if(disposed)return;
            if(!response.unchanged){data=response;revision++;}lastSync=Date.now();coverage={start:fromMs,end:toMs,filter,revision:response.revision};draw();
            if(response.truncated)toast('Molti messaggi nel periodo: aumenta lo zoom per consultarli tutti.');
        }catch(error){lastSync=Date.now();coverage={start:fromMs,end:toMs,filter};toast('Note/eventi non disponibili: '+String((error as Error).message||error));}
        finally{busy=false;if(pending&&!disposed){pending=false;void refresh(true);}}
    }
    async function createAt(timestampMs:number) {
        closeMenu();editing=null;editingTime=null;token=randomUUID();input.value='';get('note-error').textContent='';get('note-editor-title').textContent='Nuova nota';get('note-time').textContent='Associazione al campione registrato…';save.disabled=true;
        const generation=++editorGeneration;editor.showModal();
        try{const sample=await options.sample(timestampMs);if(generation!==editorGeneration||!editor.open)return;if(sample.timestampMs===null)throw new Error('Nessun campione registrato vicino a questo istante.');editingTime=sample.timestampMs;get('note-time').textContent=options.formatTime(editingTime);save.disabled=false;input.focus();}
        catch(error){if(generation===editorGeneration)get('note-error').textContent=String((error as Error).message||error);}
    }
    function edit(note:OvenNote) {
        closeMenu();editing={...note};editingTime=note.timestampMs;input.value=note.text;get('note-error').textContent='';get('note-editor-title').textContent='Modifica nota';get('note-time').textContent=options.formatTime(note.timestampMs)+' · '+note.author;save.disabled=false;++editorGeneration;editor.showModal();input.focus();
    }
    get('note-form').addEventListener('submit',async event=>{
        event.preventDefault();if(editingTime===null||save.disabled)return;save.disabled=true;get('note-error').textContent='';
        const generation=editorGeneration;
        try{const saved=await options.save(editing?{id:editing.id,revision:editing.revision,text:input.value}:{timestampMs:editingTime,text:input.value,clientToken:token});if(disposed)return;data.notes=data.notes.filter(n=>n.id!==saved.id);data.notes.push(saved);revision++;if(generation===editorGeneration)editor.close();draw();toast(options.settings().showNotes?'Nota salvata':'Nota salvata · le note sono nascoste nelle opzioni');void refresh(true);}
        catch(error){if(generation===editorGeneration)get('note-error').textContent=String((error as Error).message||error);else toast('Salvataggio nota non riuscito: '+String(error));}
        finally{if(generation===editorGeneration)save.disabled=false;}
    },{signal});
    editor.addEventListener('close',()=>{editorGeneration++;},{signal});
    get('note-context-open').addEventListener('click',()=>{if(menuGroup){active=menuGroup;renderPopup(menuGroup);}closeMenu();},{signal});
    get('note-context-edit').addEventListener('click',()=>{if(selected)edit(selected);},{signal});
    get('note-context-delete').addEventListener('click',()=>{
        closeMenu();if(!selected)return;++deleteGeneration;get<HTMLButtonElement>('note-delete-confirm').disabled=false;get('note-delete-preview').textContent=options.formatTime(selected.timestampMs)+' · '+selected.author+'\n'+selected.text;get('note-delete-error').textContent='';deleteDialog.showModal();
    },{signal});
    get('note-delete-form').addEventListener('submit',async event=>{
        event.preventDefault();if(!selected)return;const target={...selected},button=get<HTMLButtonElement>('note-delete-confirm'),generation=deleteGeneration;if(button.disabled)return;button.disabled=true;
        try{await options.remove({id:target.id,revision:target.revision});data.notes=data.notes.filter(n=>n.id!==target.id);revision++;if(generation===deleteGeneration)deleteDialog.close();closePopup();draw();toast('Nota eliminata');void refresh(true);}
        catch(error){if(generation===deleteGeneration)get('note-delete-error').textContent=String((error as Error).message||error);}finally{if(generation===deleteGeneration)button.disabled=false;}
    },{signal});
    deleteDialog.addEventListener('close',()=>{deleteGeneration++;},{signal});
    popup.addEventListener('contextmenu',event=>{
        if(!active)return;
        showMenu(event,active,active.kind==='note'&&active.items.length===1?active.items[0] as OvenNote:null);
    },{signal});
    document.addEventListener('pointerdown',event=>{if(!menu.hidden&&!menu.contains(event.target as Node))closeMenu();},{signal,capture:true});
    document.addEventListener('keydown',event=>{if(event.key==='Escape')closeMenu();},{signal});
    const poll=setInterval(()=>{if(!document.hidden&&!editor.open&&!deleteDialog.open)void refresh();},5000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh(true);},{signal});
    return {draw,refresh,createAt,dispose(){disposed=true;abort.abort();clearInterval(poll);clearTimeout(noticeTimer);layer.replaceChildren();popup.hidden=true;menu.hidden=true;}};
}
