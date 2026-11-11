const {ipcRenderer:ipc}=require('electron');
document.querySelectorAll<HTMLButtonElement>('[data-analysis]').forEach(button=>button.addEventListener('click',async()=>{
    button.disabled=true;
    try{const result=await ipc.invoke('analysis-navigate',{target:button.dataset.analysis});if(!result.ok)throw Error(result.error);}
    catch(error){const status=document.getElementById('status')!;status.hidden=false;status.textContent=(error as Error).message;}
    finally{button.disabled=false;}
}));
document.getElementById('close')!.addEventListener('click',()=>ipc.send('commercial-analysis-close'));
export {};
