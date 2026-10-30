const fs=require('node:fs'),path=require('node:path'),esbuild=require('esbuild');
const root=path.resolve(__dirname,'..');
async function buildFornoMobile(output=path.join(root,'mobile/android-calendar/app/build/generated/fornoAssets/forno')){
    const dest=path.resolve(output),relative=path.relative(root,dest);
    if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('Output forno fuori dal workspace');
    const copy=(source,target)=>{const file=path.join(dest,target);fs.mkdirSync(path.dirname(file),{recursive:true});fs.copyFileSync(path.join(root,source),file);};
    for(const file of ['forno.css','utilities/aypi-module-brand.css','utilities/aypi-operations-ui.css'])copy('src/renderer/styles/'+file,'styles/'+file);
    copy('mobile/forno/mobile.css','styles/mobile.css');copy('src/renderer/scripts/utility-layout-bootstrap.js','scripts/utility-layout-bootstrap.js');
    let html=fs.readFileSync(path.join(root,'src/renderer/pages/forno.html'),'utf8');
    html=html.replace("default-src 'self' file:; script-src 'self' 'unsafe-inline' file:; style-src 'self' 'unsafe-inline' file:; img-src 'self' file: data:; connect-src 'self' file:; object-src 'none'; base-uri 'self'","default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'self'");
    html=html.replace('</head>','    <link rel="stylesheet" href="../styles/mobile.css">\n</head>');
    fs.mkdirSync(path.join(dest,'pages'),{recursive:true});fs.writeFileSync(path.join(dest,'pages/forno.html'),html);
    await esbuild.build({entryPoints:[path.join(root,'mobile/forno/entry.ts')],outfile:path.join(dest,'scripts/forno-scripts.js'),bundle:true,platform:'browser',format:'iife',target:'chrome100',minify:true,plugins:[{name:'forno-mobile-adapters',setup(build){
        build.onResolve({filter:/^(electron|crypto)$/},args=>({path:path.join(root,'mobile/forno',args.path+'.ts')}));
        build.onResolve({filter:/\/forno\/chart-interactions$/},()=>({path:path.join(root,'mobile/forno/chart-interactions.ts')}));
    }}]});
    return dest;
}
module.exports={buildFornoMobile};
if(require.main===module)buildFornoMobile().then(dest=>console.log('Forno Android: '+dest)).catch(error=>{console.error(error);process.exitCode=1;});
