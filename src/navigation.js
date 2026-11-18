const {videoId}=require('./core');
const VIEW='sing-along';
class SongNavigation {
  constructor(app){this.app=app;this.pending=new Map();this.sourceLeaves=new WeakMap();this.sourceRequests=new WeakSet();this.enabled=true;}
  async isSong(file){
    if(!file||file.extension!=='md')return false;
    const cache=this.app.metadataCache.getFileCache(file);
    if(cache)return !!videoId(cache.frontmatter?.sing_along_youtube);
    // Freshly created notes may not have reached the metadata cache yet.
    const content=await this.app.vault.cachedRead(file);
    const fm=content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const url=fm?.[1].match(/^sing_along_youtube:\s*["']?([^\s"']+)/m)?.[1];
    return !!videoId(url);
  }
  install(Leaf){
    const navigation=this,prototype=Leaf.prototype,original=prototype.openFile;
    const wrapped=async function(file,options){
      const sourceRequest=navigation.sourceRequests.delete(this);
      if(navigation.enabled&&!sourceRequest&&await navigation.isSong(file)){
        if(navigation.enabled)return navigation.open(file,this,options);
      }
      return original.call(this,file,options);
    };
    prototype.openFile=wrapped;
    return ()=>{this.enabled=false;if(prototype.openFile===wrapped)prototype.openFile=original;};
  }
  async open(file,preferred,options={}){
    if(!file)throw new Error('請先選一篇歌詞筆記。');
    if(this.pending.has(file.path))return this.pending.get(file.path);
    const operation=this.openOnce(file,preferred,options);
    this.pending.set(file.path,operation);
    try{return await operation;}finally{this.pending.delete(file.path);}
  }
  async openOnce(file,preferred,options){
    let leaf=this.app.workspace.getLeavesOfType(VIEW).find(l=>l.view.file?.path===file.path);
    if(!leaf){
      const type=preferred?.view.getViewType();
      // Keep every other song's connected player intact, even when a bookmark
      // asks the current player leaf to open a different file.
      leaf=type==='empty'||type==='markdown'&&preferred.view.file?.path===file.path?preferred:this.app.workspace.getLeaf('tab');
      await leaf.setViewState({type:VIEW,state:{path:file.path},active:options.active!==false});
    }
    if(options.active!==false){await this.app.workspace.revealLeaf(leaf);this.app.workspace.setActiveLeaf(leaf,{focus:true});}
    return leaf.view;
  }
  async routeMarkdown(leaf){
    const view=leaf?.view,file=view?.file;
    if(!this.enabled||view?.getViewType()!=='markdown'||this.sourceLeaves.get(leaf)===file?.path)return;
    if(await this.isSong(file)&&this.enabled&&leaf.view===view&&view.file===file)await this.open(file,leaf);
  }
  async editSource(view){
    const file=view?.file;if(!file)throw new Error('請先開啟一首歌。');
    const leaf=this.app.workspace.getLeavesOfType('markdown').find(l=>l.view.file?.path===file.path)||this.app.workspace.getLeaf('tab');
    this.sourceLeaves.set(leaf,file.path);this.sourceRequests.add(leaf);
    await leaf.openFile(file,{state:{mode:'source'},active:true});
    await this.app.workspace.revealLeaf(leaf);this.app.workspace.setActiveLeaf(leaf,{focus:true});
    return leaf;
  }
}
module.exports={SongNavigation};
