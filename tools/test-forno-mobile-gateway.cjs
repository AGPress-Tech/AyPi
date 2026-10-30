const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'aypi-mobile-forno-'));
Object.assign(process.env,{AYPI_BACKEND_PROFILE:'dev',AYPI_FP_GENERAL_DIR:folder,AYPI_LOG_DIR:folder,AYPI_DB_PATH:path.join(folder,'aypi.db')});
const {backendConfig}=require('../backend-dist/config');
backendConfig.mobileGateway.enabled=true;backendConfig.mobileGateway.host='127.0.0.1';backendConfig.mobileGateway.port=0;
// Autenticazione e storage simulati; router e controllo Bearer del gateway reali.
const sessions=require('../backend-dist/modules/mobile-gateway/session-repository');sessions.initializeMobileSessionStore=()=>{};
const security=require('../backend-dist/modules/mobile-gateway/security');security.resolveMobileAdminSession=req=>security.readBearerToken(req)==='mobile_test_token'?{adminName:'Test mobile',token:'mobile_test_token'}:null;
const shared=require('../backend-dist/modules/shared/service');shared.getAdmins=()=>[{name:'Test mobile'}];
const service=require('../backend-dist/modules/forno/service');
service.getFornoStatus=async()=>({enabled:true,running:true});
service.listFornoPrograms=async()=>({programs:['Ciclo 2'],scope:'current',mode:2,readAtMs:Date.now()});
service.getFornoProgramRecipe=async(name,allowTemporaryLoad)=>({name,allowTemporaryLoad});
service.fornoRequest=async(command,input)=>({command,...input});
const {startMobileGatewayServer}=require('../backend-dist/modules/mobile-gateway/server');
test('rollback: gateway mobile senza forno, router desktop con cicli e anteprima',async()=>{
    const gateway=await startMobileGatewayServer(),base='http://127.0.0.1:'+gateway.server.address().port;
    const request=(url,method='GET',body,token='mobile_test_token')=>fetch(base+url,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    const {Router}=require('../backend-dist/shared/http/router');
    const router=new Router();require('../backend-dist/modules/forno/routes').registerFornoRoutes(router);
    const desktop=require('node:http').createServer((req,res)=>router.handle(req,res));
    try{
        await new Promise(resolve=>desktop.listen(0,'127.0.0.1',resolve));
        assert.equal((await request('/api/forno/status','GET',undefined,'')).status,401);
        assert.equal((await request('/api/forno/status','GET',undefined,'invalid')).status,401);
        const health=await(await request('/health','GET',undefined,'')).json();
        assert(!health.modules.includes('forno'));assert(health.modules.includes('production-planner'));
        for(const [url,method] of [['/api/forno/status','GET'],['/api/forno/history','GET'],['/api/forno/programs/list','POST'],['/api/forno/programs/preview','POST'],['/api/forno/notes','POST']]){
            assert.equal((await request(url,method,method==='POST'?{}:undefined)).status,404,url);
        }
        const desktopBase='http://127.0.0.1:'+desktop.address().port;
        assert.deepEqual(await(await fetch(desktopBase+'/api/forno/status')).json(),{enabled:true,running:true});
        const list=await(await fetch(desktopBase+'/api/forno/programs/list',{method:'POST'})).json();assert.deepEqual(list.programs,['Ciclo 2']);
        const preview=await(await fetch(desktopBase+'/api/forno/programs/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Ciclo 2'})})).json();assert.equal(preview.name,'Ciclo 2');
    }finally{
        if(desktop.listening)await new Promise(resolve=>desktop.close(resolve));
        await gateway.stop();
    }
});
