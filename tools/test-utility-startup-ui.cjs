// Exercise the production window factories without starting backend services.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs'), path = require('path'), vm = require('vm');
const assert = require('assert/strict'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
app.setPath('userData', path.join(root, '.tmp-utility-startup', String(Date.now())));
app.on('window-all-closed', () => { });
ipcMain.handle('batch-rename-load-presets', () => []);
const source = fs.readFileSync(path.join(root, 'src/main/modules/fileManager.ts'), 'utf8');
const names = ['FileList', 'BatchRename', 'QrGenerator', 'CompareFolders', 'Hierarchy'];
const parsed = ts.createSourceFile('fileManager.ts', source, ts.ScriptTarget.Latest, true);
const functions = parsed.statements.filter(node => ts.isFunctionDeclaration(node) &&
  ['showWindow', 'isWindowAlive', ...names.map(name => `open${name}Window`)].includes(node.name?.text));
const declarations = names.map(name => {
  const variable = name[0].toLowerCase() + name.slice(1) + 'Window';
  return `let ${variable} = null, ${variable}Theme = 'standard';`;
}).join('\n');
const code = ts.transpileModule(declarations + '\n' + functions.map(node => node.getText(parsed)).join('\n'),
  { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let current;
app.whenReady().then(async () => {
  try {
    const { revealThemedWindow } = require('../dist-ts/modules/file-manager/themed-window');
    for (const theme of ['bluearchive', 'standard']) for (const name of names) {
      const events = [];
      class TrackedWindow extends BrowserWindow {
        constructor(options) {
          super(options); current = this;
          this.webContents.on('did-finish-load', () => events.push('loaded'));
          this.on('show', () => events.push('show'));
        }
        maximize() { events.push('maximize'); return super.maximize(); }
      }
      const context = vm.createContext({
        BrowserWindow: TrackedWindow, path,
        __dirname: path.join(root, 'dist-ts/modules'),
        WINDOW_WEB_PREFERENCES: { nodeIntegration: true, contextIsolation: false },
        APP_ICON_PATH: undefined, revealThemedWindow, getScriptedSplashTheme: () => 'agpress',
        showMainWindow() { }
      });
      vm.runInContext(code, context);
      context.options = { theme };
      vm.runInContext(name === 'CompareFolders' ? 'openCompareFoldersWindow(null, null, options)' :
        `open${name}Window(null, options)`, context);
      const deadline = Date.now() + 15000;
      while (!events.includes('show') && Date.now() < deadline) await delay(20);
      assert(events.includes('show'), `${name}: window never shown`);
      assert(events.indexOf('loaded') < events.indexOf('maximize'), `${name}: maximized before load: ${events}`);
      assert(events.indexOf('loaded') < events.indexOf('show'), `${name}: visible before load: ${events}`);
      for (const size of [[1520, 960], [1000, 680]]) {
        current.unmaximize(); current.setContentSize(...size);
        await delay(60);
        const splash = await current.webContents.executeJavaScript(`(() => {
          const el = document.querySelector('.ba-utility-splash'), css = el && getComputedStyle(el);
          const rect = el?.getBoundingClientRect();
          return { visible: css?.display !== 'none' && css?.visibility === 'visible' && +css?.opacity === 1,
            themed: document.body.classList.contains('agpress-scripted-splash'),
            covers: rect?.width >= document.documentElement.clientWidth && rect?.height >= document.documentElement.clientHeight };
        })()`);
        assert(splash.visible && splash.covers, `${name}/${theme}/${size}: splash must cover the first view: ${JSON.stringify(splash)}`);
        assert.equal(splash.themed, theme === 'standard');
        await current.webContents.capturePage();
      }
      await current.webContents.executeJavaScript("document.querySelector('.ba-utility-splash').click()");
      assert(await current.webContents.executeJavaScript("!document.querySelector('.ba-utility-splash')"), `${name}: skip splash`);
      current.destroy(); current = null;
      console.log(`OK ${name}: ${theme}, load before maximize/show, splash at both sizes, click to skip`);
    }
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { current?.destroy(); app.exit(process.exitCode || 0); }
});

