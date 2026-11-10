import {SortCriterion,changeSorting} from '../../main/modules/analysis-sorting';
export type SortColumn={key:string;label:string;summaryLabel?:string};
export function bindSortingHeaders(table:HTMLTableElement,columns:readonly SortColumn[],sort:readonly SortCriterion[],change:(next:SortCriterion[])=>void){
    table.querySelectorAll<HTMLTableCellElement>('thead th').forEach((th,index)=>{
        const column=columns[index];if(!column)return;
        const priority=sort.findIndex(item=>item.key===column.key),criterion=sort[priority];
        th.classList.add('sortable-header');th.dataset.sortKey=column.key;
        th.setAttribute('aria-sort',priority<0?'none':priority===0?(criterion.direction==='asc'?'ascending':'descending'):'other');
        const button=document.createElement('button');button.type='button';button.className='sort-header-button';
        button.append(document.createTextNode(column.label));
        const marker=document.createElement('span');marker.className='sort-marker';marker.setAttribute('aria-hidden','true');marker.textContent=criterion?`${criterion.direction==='asc'?'↑':'↓'}${priority+1}`:'↕';button.append(marker);
        const state=criterion?`Priorità ${priority+1}, ${criterion.direction==='asc'?'crescente':'decrescente'}. `:'';
        button.title=state+'Clic: aggiungi o inverti. Ctrl+clic: rimuovi questo ordinamento.';
        button.setAttribute('aria-label',`${column.summaryLabel||column.label}. ${button.title}`);
        th.replaceChildren(button);th.onclick=event=>change(changeSorting(sort,column.key,event.ctrlKey||event.metaKey));
    });
}
export function updateSortingBar(table:HTMLTableElement,columns:readonly SortColumn[],sort:readonly SortCriterion[],change:(next:SortCriterion[])=>void,note=''){
    const id=table.id+'Sorting';let bar=document.getElementById(id);
    if(!bar){bar=document.createElement('div');bar.id=id;bar.className='sorting-bar';table.parentElement!.insertAdjacentElement('beforebegin',bar);}
    const summary=document.createElement('span');summary.className='sorting-summary';summary.setAttribute('aria-live','polite');
    summary.textContent=sort.length?'Ordina: '+sort.map((item,i)=>{const col=columns.find(c=>c.key===item.key);return `${i+1}. ${col?.summaryLabel||col?.label||item.key} ${item.direction==='asc'?'↑':'↓'}`}).join(' → '):'Clic sulle intestazioni per ordinare · Ctrl+clic per rimuovere';
    if(note)summary.title=note;
    const reset=document.createElement('button');reset.type='button';reset.className='clear-sorting';reset.textContent='Rimuovi ordinamenti';reset.disabled=!sort.length;reset.onclick=()=>change([]);
    bar.replaceChildren(summary,reset);
}
