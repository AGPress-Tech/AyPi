import { mountForgeLanding } from '../../src/renderer/scripts/forge/landing';

const theme = new URLSearchParams(location.search).get('theme') === 'bluearchive'
    ? 'bluearchive' : 'standard';
document.documentElement.dataset.forgeTheme = theme;
mountForgeLanding(document.getElementById('forge-landing-root')!, theme);
