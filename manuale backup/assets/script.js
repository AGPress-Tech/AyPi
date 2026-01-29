function setActiveNav(){
  const path = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav a').forEach(a=>{
    const href = a.getAttribute('href');
    if(!href) return;
    const file = href.split('/').pop();
    if(file === path) a.classList.add('active');
  });
}

function bindSearch(){
  const input = document.querySelector('#navSearch');
  if(!input) return;
  input.addEventListener('input', ()=>{
    const q = input.value.trim().toLowerCase();
    document.querySelectorAll('.nav a[data-title]').forEach(a=>{
      const t = a.dataset.title.toLowerCase();
      a.style.display = (!q || t.includes(q)) ? '' : 'none';
    });
    document.querySelectorAll('.nav .section').forEach(sec=>{
      // hide section labels if all links until next section are hidden
      let el = sec.nextElementSibling;
      let anyVisible = false;
      while(el && !el.classList.contains('section')){
        if(el.tagName === 'A' && el.style.display !== 'none') anyVisible = true;
        el = el.nextElementSibling;
      }
      sec.style.display = anyVisible ? '' : 'none';
    });
  });
}

function copyLink(){
  navigator.clipboard?.writeText(window.location.href);
  const btn = document.querySelector('#copyLinkBtn');
  if(btn){
    const old = btn.textContent;
    btn.textContent = 'Copiato';
    setTimeout(()=>btn.textContent = old, 900);
  }
}

window.addEventListener('DOMContentLoaded', ()=>{
  setActiveNav();
  bindSearch();
  const btn = document.querySelector('#copyLinkBtn');
  if(btn) btn.addEventListener('click', copyLink);
});
