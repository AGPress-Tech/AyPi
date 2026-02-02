function getGuidePrefix(){
  const path = window.location.pathname || '';
  // current structure: root pages + /aypi-calendar/ subfolder
  return path.includes('/aypi-calendar/') ? '../' : './';
}

async function includeSidebar(){
  const mount = document.querySelector('#sidebarMount');
  if(!mount) return;

  const prefix = getGuidePrefix();
  try{
    const res = await fetch(`${prefix}assets/sidebar.html`, { cache: 'no-store' });
    if(!res.ok) return;

    const html = await res.text();
    mount.insertAdjacentHTML('beforebegin', html);
    mount.remove();

    const sidebar = document.querySelector('.sidebar');
    if(!sidebar) return;

    // Apply correct relative hrefs
    sidebar.querySelectorAll('a[data-href]').forEach((a)=>{
      const raw = (a.dataset.href || '').trim();
      if(!raw) return;
      if(raw.startsWith('#') || raw.startsWith('mailto:') || raw.startsWith('tel:') || raw.match(/^[a-zA-Z]+:\/\//)){
        a.setAttribute('href', raw);
        return;
      }
      a.setAttribute('href', `${prefix}${raw}`);
    });
  }catch(_){}
}

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
  const params = new URLSearchParams(window.location.search || '');
  const preset = params.get('q');
  if(preset){
    input.value = preset;
  }
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
  if(preset){
    input.dispatchEvent(new Event('input'));
  }
}

function applyEmbedMode(){
  const params = new URLSearchParams(window.location.search || '');
  const isEmbed = params.get('embed') === '1';
  if(isEmbed){
    document.body.classList.add('embed');
  }
  const theme = params.get('theme');
  if(theme === 'dark' || theme === 'aypi' || theme === 'light'){
    document.body.classList.add(`theme-${theme}`);
  }
  if(isEmbed){
    const extraParams = new URLSearchParams();
    extraParams.set('embed', '1');
    if(theme){
      extraParams.set('theme', theme);
    }
    const q = params.get('q');
    if(q){
      extraParams.set('q', q);
    }
    document.querySelectorAll('.nav a[href]').forEach((link)=>{
      const href = link.getAttribute('href');
      if(!href || href.startsWith('http')) return;
      const parts = href.split('?');
      const base = parts[0];
      const next = new URLSearchParams(parts[1] || '');
      extraParams.forEach((val, key)=> next.set(key, val));
      link.setAttribute('href', `${base}?${next.toString()}`);
    });
  }
}

function setupAutoShots(){
  const path = window.location.pathname;
  const file = path.split('/').pop() || 'index.html';
  const base = file.replace(/\.html?$/i,'');
  const prefix = getGuidePrefix();
  const candidates = [
    `${prefix}assets/shots/${base}.png`,
    `${prefix}assets/shots/${base}.jpg`,
    `${prefix}assets/shots/${base}.jpeg`,
  ];

  document.querySelectorAll('[data-shot="auto"]').forEach((wrap)=>{
    const img = wrap.querySelector('img');
    if(!img) return;
    let idx = 0;
    const tryNext = ()=>{
      if(idx >= candidates.length){
        wrap.classList.add('is-hidden');
        return;
      }
      img.src = candidates[idx++];
    };
    img.addEventListener('load', ()=>{
      wrap.classList.remove('is-hidden');
    }, { once: true });
    img.addEventListener('error', tryNext);
    tryNext();
  });
}

function restoreScroll(){
  try{
    const y = sessionStorage.getItem('aypiGuideScrollY');
    if(y){
      window.scrollTo(0, parseInt(y, 10) || 0);
    }
    const nav = document.querySelector('.nav');
    const navY = sessionStorage.getItem('aypiGuideNavScroll');
    if(nav && navY){
      nav.scrollTop = parseInt(navY, 10) || 0;
    }
  }catch(_){}
}

function rememberScroll(){
  try{
    sessionStorage.setItem('aypiGuideScrollY', String(window.scrollY || 0));
    const nav = document.querySelector('.nav');
    if(nav){
      sessionStorage.setItem('aypiGuideNavScroll', String(nav.scrollTop || 0));
    }
  }catch(_){}
}

function bindGuideClose(){
  const btn = document.querySelector('#guideCloseBtn');
  if(!btn) return;
  btn.addEventListener('click', ()=>{
    try{
      if(window.parent){
        window.parent.postMessage({ type: 'guide-close' }, '*');
      }
    }catch(_){}
  });
}

window.addEventListener('DOMContentLoaded', async ()=>{
  await includeSidebar();
  applyEmbedMode();
  setActiveNav();
  bindSearch();
  setupAutoShots();
  restoreScroll();
  bindGuideClose();
  document.querySelectorAll('.nav a[href]').forEach((link)=>{
    link.addEventListener('click', rememberScroll);
  });
});

window.addEventListener('beforeunload', rememberScroll);
