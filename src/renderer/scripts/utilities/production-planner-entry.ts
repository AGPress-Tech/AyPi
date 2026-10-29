import { initBlueArchivePointerEffects } from '../shared/bluearchive-pointer-effects';

// L'interfaccia MES è subito visibile: nessun overlay o attesa introduttiva.
initBlueArchivePointerEffects(new URLSearchParams(location.search).get('theme') === 'bluearchive');
