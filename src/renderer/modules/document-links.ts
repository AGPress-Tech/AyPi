import type {AnalysisContext} from '../../main/modules/analysis-navigation-model';
const ipc=require('electron').ipcRenderer;
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!);
const num=(v:unknown)=>v==null?'—':new Intl.NumberFormat('it-IT',{maximumFractionDigits:4}).format(Number(v));
const date=(v:unknown)=>v?String(v).slice(0,10).split('-').reverse().join('/'):'—';
export function contextFromAnalysisElement(target:HTMLElement):AnalysisContext|null{
    const node=target.closest<HTMLElement>('td[data-analysis-article],td[data-analysis-customer-code],td[data-analysis-customer-name],[data-analysis-document-id]');
    if(!node)return null;const context:AnalysisContext={};
    if(node.dataset.analysisArticle)context.article=node.dataset.analysisArticle;
    if(node.dataset.analysisCustomerCode)context.customerCode=node.dataset.analysisCustomerCode;
    if(node.dataset.analysisCustomerName)context.customerName=node.dataset.analysisCustomerName;
    if(node.dataset.analysisDocumentId){context.documentId=node.dataset.analysisDocumentId;context.documentNo=node.dataset.analysisDocumentNo;context.documentKind=node.dataset.analysisDocumentKind as 'order'|'offer';}
    return Object.keys(context).length?context:null;
}
export async function loadDocumentLinks(host:HTMLElement,kind:'order'|'offer',id:number){
    host.classList.add('analysis-linked-documents');host.textContent='Caricamento documenti collegati…';
    try{
        const result=await ipc.invoke('analysis-document-links',{kind,id});if(!result.ok)throw Error(result.error);
        if(!host.isConnected)return;
        const groups=new Map<string,any[]>();for(const r of result.rows){const key=r.kind+':'+r.documentId,rs=groups.get(key)??[];rs.push(r);groups.set(key,rs);}
        host.innerHTML=[...groups.values()].map((rs,index)=>{
            const row=rs[0];
            return `<details class="linked-document" ${groups.size===1?'open':''}><summary data-analysis-document-id="${row.documentId}" data-analysis-document-no="${esc(row.documentNo)}" data-analysis-document-kind="${row.kind}">${row.kind==='offer'?'Offerta':'Ordine'} ${esc(row.documentNo)} · ${esc(date(row.documentDate))} <span>${rs.length} righe</span></summary><button type="button" data-linked-index="${index}">Apri in Analisi ${row.kind==='offer'?'offerte':'venduto'} ↗</button><div class="table-scroll"><table class="linked-documents-table"><thead><tr><th>Articolo</th><th>Descrizione</th><th>Quantità</th><th>U.M.</th><th>Prezzo netto</th><th>Imponibile</th><th>Valuta</th></tr></thead><tbody>${rs.map(r=>`<tr data-analysis-article="${esc(r.article)}" ${r.customerType==='Contatto'?'':`data-analysis-customer-code="${esc(r.customerCode)}" data-analysis-customer-name="${esc(r.customerName)}"`}><td data-analysis-article="${esc(r.article)}">${esc(r.article)}</td><td>${esc(r.description)}</td><td class="numeric">${num(r.quantity)}</td><td>${esc(r.unit||'—')}</td><td class="numeric">${num(r.netPrice)}</td><td class="numeric">${num(r.netAmount)}</td><td>${esc(r.currency||'—')}</td></tr>`).join('')}</tbody></table></div></details>`;
        }).join('')||`Nessun${kind==='order'?'a offerta collegata':' ordine collegato'}.`;
        host.querySelectorAll<HTMLButtonElement>('[data-linked-index]').forEach(button=>button.addEventListener('click',async()=>{
            const rs=[...groups.values()][Number(button.dataset.linkedIndex)],r=rs[0];button.disabled=true;
            try{const response=await ipc.invoke('analysis-navigate',{target:r.kind==='offer'?'article-offers':'article-orders',context:{documentKind:r.kind,documentNo:String(r.documentNo),documentId:String(r.documentId)}});if(!response.ok)throw Error(response.error);}
            catch(error){host.append(Object.assign(document.createElement('p'),{textContent:(error as Error).message}));}
            finally{button.disabled=false;}
        }));
    }catch(error){if(host.isConnected){host.textContent=(error as Error).message;const retry=document.createElement('button');retry.textContent='Riprova';retry.onclick=()=>void loadDocumentLinks(host,kind,id);host.append(' ',retry);}}
}
export function toggleDocumentLinks(button:HTMLElement,kind:'order'|'offer',id:number){
    const row=button.closest('tr')!;
    const current=row.nextElementSibling;
    if(current?.classList.contains('document-links-row')){current.remove();button.setAttribute('aria-expanded','false');button.textContent='▸';return;}
    const child=document.createElement('tr');child.className='document-links-row';const cell=document.createElement('td');cell.colSpan=row.children.length;child.append(cell);row.after(child);
    button.setAttribute('aria-expanded','true');button.textContent='▾';void loadDocumentLinks(cell,kind,id);
}
