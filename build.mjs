import {build} from 'esbuild';
import {mkdir,copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
const root=dirname(fileURLToPath(import.meta.url));
const dist=resolve(root,'dist');await mkdir(dist,{recursive:true});
await build({entryPoints:[resolve(root,'src/main.js')],outfile:resolve(dist,'main.js'),bundle:true,format:'cjs',platform:'node',target:'es2022',external:['obsidian','electron'],loader:{'.py':'text','.lock':'text'},logLevel:'info'});
for(const name of ['manifest.json','styles.css'])await copyFile(resolve(root,name),resolve(dist,name));
if(process.argv.includes('--install')){
  const plugin=process.env.OBSIDIAN_PLUGIN_DIR?resolve(process.env.OBSIDIAN_PLUGIN_DIR):resolve(root,'../../.obsidian/plugins/sing-along');await mkdir(plugin,{recursive:true});
  for(const name of ['main.js','manifest.json','styles.css'])await copyFile(resolve(dist,name),resolve(plugin,name));
  console.log('Installed:',plugin);
}
