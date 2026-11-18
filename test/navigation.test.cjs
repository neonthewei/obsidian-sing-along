const {test}=require('node:test');const assert=require('node:assert/strict');
const {SongNavigation}=require('../src/navigation');
function setup(){
 const files=new Map(['a','b','ordinary'].map(name=>[name,{path:name+'.md',extension:'md'}]));
 const leaves=[];const active=[];
 class Leaf{
  constructor(){this.view={getViewType:()=> 'empty'};leaves.push(this);}
  async openFile(file){this.view={getViewType:()=> 'markdown',file};return this.view;}
  async setViewState(state){await Promise.resolve();this.view={getViewType:()=>state.type,file:[...files.values()].find(f=>f.path===state.state.path),position:0};}
 }
 const app={metadataCache:{getFileCache:file=>({frontmatter:{sing_along_youtube:file.path==='ordinary.md'?undefined:'https://youtu.be/M7lc1UVf-VE'}})},vault:{},workspace:{getLeavesOfType:type=>leaves.filter(l=>l.view.getViewType()===type),getLeaf:()=>new Leaf(),revealLeaf:async()=>{},setActiveLeaf:leaf=>active.push(leaf)}};
 const nav=new SongNavigation(app);const dispose=nav.install(Leaf);return {files,leaves,Leaf,app,nav,dispose};
}
test('opening a different song preserves the first player and reopening reuses its state',async()=>{
 const x=setup();try{const leaf=new x.Leaf();const a=await leaf.openFile(x.files.get('a'));a.position=42;const b=await leaf.openFile(x.files.get('b'));assert.notEqual(a,b);assert.equal(x.leaves.filter(l=>l.view.getViewType()==='sing-along').length,2);const again=await x.nav.open(x.files.get('a'));assert.equal(again,a);assert.equal(again.position,42);assert.equal(b.file.path,'b.md');}finally{x.dispose();}
});
test('concurrent requests for one song create a single connected view',async()=>{
 const x=setup();try{const [a,b]=await Promise.all([x.nav.open(x.files.get('a')),x.nav.open(x.files.get('a'))]);assert.equal(a,b);assert.equal(x.leaves.length,1);}finally{x.dispose();}
});
test('ordinary notes and explicit source editing stay Markdown without replacing the player',async()=>{
 const x=setup();try{const ordinary=new x.Leaf();await ordinary.openFile(x.files.get('ordinary'));assert.equal(ordinary.view.getViewType(),'markdown');const song=await x.nav.open(x.files.get('a'));song.position=51;const source=await x.nav.editSource(song);await x.nav.routeMarkdown(source);assert.equal(source.view.getViewType(),'markdown');assert.equal(source.view.file.path,'a.md');assert.equal(song.position,51);assert.equal(await source.openFile(x.files.get('a')),song);await x.nav.routeMarkdown(source);assert.equal(source.view.getViewType(),'markdown');const opened=await source.openFile(x.files.get('b'));assert.equal(opened.getViewType(),'sing-along');assert.equal(opened.file.path,'b.md');}finally{x.dispose();}
});
test('disabling restores regular file opening',async()=>{
 const x=setup();x.dispose();const leaf=new x.Leaf();await leaf.openFile(x.files.get('a'));assert.equal(leaf.view.getViewType(),'markdown');
});
