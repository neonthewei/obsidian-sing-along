const {Plugin, ItemView, TFile, Notice, parseYaml, WorkspaceLeaf} = require('obsidian');
const {parseTime, formatTime, videoId, parseLyrics, updateTiming, clearTiming, rangeFor, activeAt} = require('./core');
const {YoutubePlayer} = require('./player');
const {SongNavigation} = require('./navigation');
const {ensureWorker} = require('./worker');
const {spawn} = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const VIEW = 'sing-along';
const ERRORS = {2:'影片網址無效。',5:'YouTube 無法播放這支影片。',100:'影片已移除或設為私人。',101:'這支影片不允許嵌入，請換一個版本。',150:'這支影片不允許嵌入，請換一個版本。',153:'YouTube 未接受播放器識別，請重新連接影片。'};
function button(parent, text, action, cls='') {
  const b=parent.createEl('button',{text,cls});
  b.addEventListener('click',()=>Promise.resolve().then(action).catch(e=>new Notice(e.message)));
  return b;
}
function input(parent, placeholder, label) {
  const e=parent.createEl('input',{type:'text',placeholder});e.setAttribute('aria-label',label);return e;
}
class SingView extends ItemView {
  constructor(leaf,plugin) {
    super(leaf);this.plugin=plugin;this.file=null;this.cues=[];this.selected=0;this.active=-1;this.loop=false;this.follow=true;this.snapshot=null;this.closed=false;this.generation=0;this.busy=false;this.writing=false;
  }
  getViewType(){return VIEW;}
  getDisplayText(){return this.file?String(this.app.metadataCache.getFileCache(this.file)?.frontmatter?.display_title||this.file.basename):'逐句學唱';}
  onPaneMenu(menu,source){super.onPaneMenu(menu,source);menu.addItem(item=>item.setTitle('編輯歌詞原文').setIcon('file-pen-line').onClick(()=>this.plugin.navigation.editSource(this).catch(e=>new Notice(e.message))));}
  getIcon(){return 'mic-vocal';}
  getState(){return {path:this.file?.path};}
  async setState(state,result){if(state.path)await this.loadSong(state.path);await super.setState(state,result);}
  async onOpen(){
    this.closed=false;this.render();
    this.registerInterval(window.setInterval(()=>this.tick(),200));
    this.miniResizeObserver=new ResizeObserver(()=>this.scheduleMiniPlayer());
    this.miniResizeObserver.observe(this.contentEl);
    this.register(()=>{this.miniResizeObserver.disconnect();window.cancelAnimationFrame(this.miniFrame);window.clearTimeout(this.centerTimer);});
    this.registerEvent(this.app.vault.on('modify',file=>{
      if(file===this.file&&!this.writing){window.clearTimeout(this.refreshTimer);this.refreshTimer=window.setTimeout(()=>this.reload().catch(e=>this.setStatus(e.message)),250);}
    }));
    this.registerEvent(this.app.vault.on('rename',file=>{if(file===this.file)this.app.workspace.requestSaveLayout();}));
    this.registerEvent(this.app.vault.on('delete',file=>{if(file===this.file){this.file=null;this.cues=[];this.stopPlayer();this.render();}}));
    this.register(()=>window.clearTimeout(this.refreshTimer));
    this.registerDomEvent(this.contentEl.ownerDocument,'keydown',event=>{
      if(this.app.workspace.activeLeaf?.view!==this&&!this.contentEl.contains(event.target))return;
      if(event.target.closest?.('input,textarea,select,[contenteditable="true"]'))return;
      this.handleShortcut(event);
    },{capture:true});
  }
  handleShortcut(event){
    if(event.ctrlKey||event.altKey||event.isComposing)return false;
    let task;
    if(event.metaKey){if(event.key==='ArrowUp')task=()=>this.jumpSection(-1);else if(event.key==='ArrowDown')task=()=>this.jumpSection(1);else if(event.key?.toLowerCase()==='r')task=()=>this.toggleLoop('section');else return false;}
    else if(event.code==='Space'||event.key===' ')task=()=>this.togglePlay();
    else if(event.key==='ArrowDown')task=()=>this.select(this.selected+1,true);
    else if(event.key==='ArrowUp')task=()=>this.select(this.selected-1,true);
    else if(event.key?.toLowerCase()==='r')task=()=>this.toggleLoop('line');
    if(!task)return false;
    event.preventDefault?.();event.stopPropagation?.();
    if(!event.repeat)Promise.resolve().then(task).catch(e=>new Notice(e.message));
    return true;
  }

  async jumpSection(direction){
    if(!this.cues.length)return;
    const starts=this.cues.map((cue,index)=>index===0||cue.section!==this.cues[index-1].section?index:-1).filter(index=>index>=0);
    let current=0;for(let i=0;i<starts.length;i++)if(starts[i]<=this.selected)current=i;
    const target=Math.max(0,Math.min(starts.length-1,current+direction));
    await this.select(starts[target],true);
  }
  async onClose(){window.clearTimeout(this.centerTimer);window.cancelAnimationFrame(this.miniFrame);this.alignJob?.kill();this.alignJob=null;this.closed=true;this.generation++;this.stopPlayer();window.clearTimeout(this.refreshTimer);}
  stopPlayer(){this.contentEl.removeClass('is-mini-player');this.player?.destroy();this.player=null;this.snapshot=null;this.video=null;this.loop=false;}
  render(){
    const el=this.contentEl;el.empty();el.addClass('sing-along');el.tabIndex=0;
    const heading=el.createDiv({cls:'sa-heading'});
    const rawTitle=this.file ? String(this.app.metadataCache.getFileCache(this.file)?.frontmatter?.display_title || this.file.basename) : '';
    const song=rawTitle.match(/^(.*?)〈([^〉]+)〉/);
    const title=song ? `${song[1].trim()}〈${song[2]}〉歌詞` : rawTitle ? `${rawTitle.replace(/(?:分段)?歌詞.*|學唱筆記.*/,'').trim()}歌詞` : '逐句學唱';
    heading.createEl('h2',{text:title});
    const layout=el.createDiv({cls:'sa-layout'});const deck=layout.createDiv({cls:'sa-deck'});
    this.registerDomEvent(layout,'scroll',()=>{this.scheduleMiniPlayer();if(this.centeringCue!=null){window.clearTimeout(this.centerTimer);this.centerTimer=window.setTimeout(()=>this.finishCentering(),140);}},{passive:true});
    this.registerDomEvent(layout,'wheel',()=>{this.centeringCue=null;window.clearTimeout(this.centerTimer);},{passive:true});
    const dock=el.createDiv({cls:'sa-dock'});this.dockEl=dock;
    const connect=deck.createEl('form',{cls:'sa-connect'});
    this.urlInput=input(connect,'貼上 YouTube 網址','YouTube 網址');
    this.connectButton=connect.createEl('button',{text:'連接並自動對齊',type:'submit'});
    connect.addEventListener('submit',event=>{event.preventDefault();this.connect(this.urlInput.value).catch(e=>new Notice(e.message));});
    this.videoEl=deck.createDiv({cls:'sa-video'});
    this.videoEl.createDiv({cls:'sa-placeholder',text:'貼上想練唱的 YouTube 影片，從第一句開始。'});
    const controls=dock.createDiv({cls:'sa-controls'});
    this.speed=controls.createEl('select',{cls:'sa-speed',attr:{'aria-label':'播放速度'}});
    this.speed.createEl('option',{text:'1×',value:'1'});
    this.speed.addEventListener('change',()=>this.perform('setPlaybackRate',Number(this.speed.value)).catch(e=>new Notice(e.message)));
    this.prevButton=button(controls,'上一句',()=>this.select(this.selected-1,true));
    this.playButton=button(controls,'播放',()=>this.togglePlay(),'mod-cta');
    this.nextButton=button(controls,'下一句',()=>this.select(this.selected+1,true));
    this.loopButton=button(controls,'循環本句',()=>this.toggleLoop());this.loopButton.setAttribute('aria-pressed','false');
    const score=layout.createDiv({cls:'sa-score'});
    const nav=score.createDiv({cls:'sa-score-nav'});this.count=nav.createEl('span');
    this.sections=el.createEl('nav',{cls:'sa-outline',attr:{'aria-label':'歌詞段落'}});
    this.lyricsEl=score.createDiv({cls:'sa-lyrics'});
    layout.prepend(heading);
    this.renderCues();this.updateSelection();this.updateControls();
  }
  async loadSong(path){
    const file=this.app.vault.getAbstractFileByPath(path);
    if(!(file instanceof TFile)||file.extension!=='md')throw new Error('請選一篇 Markdown 歌詞筆記。');
    const content=await this.app.vault.read(file);const cues=parseLyrics(content);
    const fm=content.match(/^---\r?\n([\s\S]*?)\r?\n---/);let id=null;
    try{id=videoId(fm?parseYaml(fm[1])?.sing_along_youtube:null);}catch{}
    if(!cues.length&&!id)throw new Error('找不到歌詞對照或 YouTube 網址。');
    if(this.closed)return;
    this.alignJob?.kill();this.alignJob=null;this.generation++;this.stopPlayer();this.file=file;this.cues=cues;this.selected=0;this.active=-1;this.render();
    if(id){this.urlInput.value='https://www.youtube.com/watch?v='+id;this.mountVideo(id);}
    this.setStatus(id?'正在準備影片。':'已讀取歌詞。貼上影片網址，連接後會自動對齊。');
    this.app.workspace.requestSaveLayout();
  }
  async reload(){
    if(!this.file||this.closed)return;
    const file=this.file, gen=this.generation;const content=await this.app.vault.read(file);
    if(this.closed||file!==this.file||gen!==this.generation)return;
    const key=this.cues[this.selected]?.key;this.cues=parseLyrics(content);
    this.selected=Math.max(0,this.cues.findIndex(c=>c.key===key));this.loop=false;this.active=-1;
    this.renderCues();this.updateSelection();this.updateControls();
  }
  async connect(url){
    if(!this.file)throw new Error('先開啟歌詞筆記，再執行「用目前筆記開啟逐句學唱」。');
    const id=videoId(url);if(!id)throw new Error('請貼上有效的 YouTube 影片網址。');
    const file=this.file;
    // Timings are specific to one video: changing the video requires clearing them explicitly.
    if(this.video&&id!==this.video&&this.cues.some(c=>c.start!==null))throw new Error('這份歌詞已有其他影片的時間點。請先複製筆記並清除時間標記，再連接另一個版本。');
    await this.app.fileManager.processFrontMatter(file,fm=>{fm.sing_along_youtube='https://www.youtube.com/watch?v='+id;});
    if(file!==this.file||this.closed)return;
    this.urlInput.value='https://www.youtube.com/watch?v='+id;this.mountVideo(id);this.setStatus('正在準備 YouTube 影片。');if(this.cues.length)await this.autoAlign();
  }
  mountVideo(id){
    this.stopPlayer();this.video=id;this.videoEl.empty();this.player=new YoutubePlayer(this.videoEl,id,event=>this.handleShortcut(event));this.loadingSince=Date.now();this.updateControls();this.scheduleMiniPlayer();
  }
  renderCues(){
    this.lyricsEl.empty();this.sections.empty();this.sectionButtons=[];this.rows=[];let section=null;
    this.count.setText(this.cues.length?`已對齊 ${this.cues.filter(c=>c.start!==null).length} / ${this.cues.length} 句`:'尚未加入歌詞');
    this.cues.forEach((cue,index)=>{
      if(cue.section!==section){section=cue.section;this.lyricsEl.createEl('h3',{text:section,cls:'sa-section'});const sectionName=section;const item=button(this.sections,section,()=>this.select(index,true),'sa-section-button');this.sectionButtons.push({el:item,section:sectionName});}
      const row=this.lyricsEl.createEl('button',{cls:'sa-cue'});row.type='button';
      const words=row.createSpan({cls:'sa-words'});words.createSpan({text:cue.romaji,cls:'sa-romaji'});words.createSpan({text:cue.japanese,cls:'sa-japanese'});words.createSpan({text:cue.translation,cls:'sa-translation'});
      row.addEventListener('click',()=>this.select(index,true).catch(e=>new Notice(e.message)));this.rows.push(row);
    });
    if(!this.cues.length)this.lyricsEl.createEl('p',{cls:'sa-help',text:'這份筆記已連接影片，尚未加入歌詞正文。'});
  }
  async select(index,seek=false){
    if(!this.cues.length)return;this.selected=Math.max(0,Math.min(index,this.cues.length-1));this.loop=false;
    this.updateSelection();this.updateControls();this.scrollTo(this.selected);
    const cue=this.cues[this.selected];
    if(seek&&cue.start!==null){await this.perform('seekTo',cue.start,true);await this.perform('playVideo');}
    else if(seek)this.setStatus('這句尚未對齊，請按「自動對齊歌詞」。');
  }
  updateSelection(){
    this.rows?.forEach((r,i)=>{r.classList.toggle('is-selected',i===this.selected&&this.loop!=='section');r.setAttribute('aria-pressed',String(i===this.selected));});
    const cue=this.cues[this.selected];
    this.sectionButtons?.forEach(item=>{const chosen=item.section===cue?.section;item.el.classList.toggle('is-current',chosen);if(chosen)item.el.setAttribute('aria-current','true');else item.el.removeAttribute('aria-current');});
  }
  updateControls(){
    this.rows?.forEach((row,index)=>row.classList.toggle('is-selected',index===this.selected&&this.loop!=='section'));
    const ready=!!this.snapshot?.ready&&!this.snapshot?.error;
    this.connectButton.disabled=!!this.alignJob;this.connectButton.setText(this.alignJob?'正在自動對齊…':this.cues.length?'連接並自動對齊':'連接影片');
    this.playButton.disabled=!ready;this.speed.disabled=!ready;
    this.prevButton.disabled=!this.cues.length||this.selected===0;this.nextButton.disabled=!this.cues.length||this.selected>=this.cues.length-1;
    this.loopButton.disabled=!ready||!rangeFor(this.cues,this.selected,this.snapshot?.duration);
    this.loopButton.setAttribute('aria-pressed',String(!!this.loop));this.loopButton.classList.toggle('is-on',this.loop);
    this.loopButton.setText(this.loop==='section'?'停止段落循環':this.loop?'停止循環':'循環本句');this.playButton.setText(this.snapshot?.state===1?'暫停':'播放');
  }
  setStatus(message){if(this.alignJob&&!message.startsWith('自動對齊'))return;this.statusMessage=message;}
  async perform(method,...args){
    if(!this.player||!this.snapshot?.ready||this.snapshot?.error)throw new Error('先連接影片，等播放器準備完成。');
    return this.player.command(method,...args);
  }
  async togglePlay(){await this.perform(this.snapshot?.state===1?'pauseVideo':'playVideo');}
  getLoopRange(mode=this.loop||'line'){
    if(mode==='line')return rangeFor(this.cues,this.selected,this.snapshot?.duration);
    const section=this.cues[this.selected]?.section;if(!section)return null;
    let first=this.selected,last=this.selected;
    while(first>0&&this.cues[first-1].section===section)first--;
    while(last+1<this.cues.length&&this.cues[last+1].section===section)last++;
    const start=this.cues[first]?.start,end=rangeFor(this.cues,last,this.snapshot?.duration)?.end;
    return start!=null&&end!=null&&end>start?{start,end}:null;
  }
  async toggleLoop(mode=this.loop||'line'){
    if(this.loop===mode){this.loop=false;if(this.active>=0){this.selected=this.active;this.updateSelection();}this.updateControls();return;}
    if(this.loop==='section'&&mode==='line'&&this.active>=0){this.selected=this.active;this.updateSelection();}
    const range=this.getLoopRange(mode);
    if(!range)throw new Error(mode==='section'?'這個段落尚未完成對齊。':'這句尚未完成對齊。');
    this.loop=mode;this.updateControls();await this.perform('seekTo',range.start,true);await this.perform('playVideo');
  }
  async applyAlignment(file,video,cues,result){
    if(this.closed||this.file!==file||this.video!==video)return;
    if(result.length!==cues.length)throw new Error('自動對齊結果句數不符，未寫入筆記。');
    this.writing=true;
    try {
      await this.app.vault.process(file,content=>{
        const fresh=parseLyrics(content);
        if(JSON.stringify(fresh.map(c=>c.key))!==JSON.stringify(cues.map(c=>c.key)))throw new Error('歌詞在對齊途中已修改，請重新執行。');
        let updated=content;for(const cue of fresh)updated=clearTiming(updated,cue.key);
        for(let i=0;i<cues.length;i++)updated=updateTiming(updated,cues[i].key,result[i].start,result[i].end);
        return updated;
      });
      await this.reload();
    }finally{this.writing=false;}
  }
  async autoAlign(){
    if(this.alignJob)throw new Error('自動對齊正在進行中。');
    if(!this.file||!this.video)throw new Error('先連接 YouTube 影片。');
    if(!this.cues.length)throw new Error('這份筆記尚未加入歌詞正文，沒有可對齊的句子。');
    if(this.closed)return;
    const file=this.file,video=this.video,cues=this.cues.map(c=>({...c}));
    const worker=ensureWorker();
    const uv=[path.join(os.homedir(),'.local/bin/uv'),'/opt/homebrew/bin/uv','/usr/local/bin/uv'].find(p=>fs.existsSync(p))||'uv';
    const env={...process.env,PATH:[path.join(os.homedir(),'.local/bin'),'/opt/homebrew/bin','/usr/local/bin',process.env.PATH].filter(Boolean).join(path.delimiter),PYTHONUNBUFFERED:'1'};
    const localPython=path.join(os.homedir(),'.cache/obsidian-sing-along/venv/bin/python');
    const executable=fs.existsSync(localPython)?localPython:uv;
    const args=fs.existsSync(localPython)?[worker]:['run','--python','3.11',worker];
    const child=spawn(executable,args,{env,stdio:['pipe','pipe','pipe']});
    this.alignJob=child;this.updateControls();this.setStatus('自動對齊：準備模型與音訊，首次執行需要幾分鐘。');
    try {
      const result=await new Promise((resolve,reject)=>{
        let output='',errors='';
        child.stdout.on('data',chunk=>{output+=chunk.toString();let newline;while((newline=output.indexOf('\n'))>=0){const line=output.slice(0,newline);output=output.slice(newline+1);try{const msg=JSON.parse(line);if(msg.progress&&file===this.file&&video===this.video)this.setStatus('自動對齊：'+msg.progress);if(msg.result)resolve(msg.result);if(msg.error)reject(new Error(msg.error));}catch{}}});
        child.stderr.on('data',chunk=>{errors=(errors+chunk.toString()).slice(-2000);});
        child.on('error',e=>reject(new Error('無法啟動本機對齊程式：'+e.message)));
        child.on('close',code=>reject(new Error(code===0?'自動對齊沒有產生結果。':'自動對齊失敗：'+errors.slice(-500))));
        child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({videoId:video,lines:cues.map(c=>c.japanese)}));
      });
      if(this.closed||this.file!==file||this.video!==video)return;
      if(result.length!==cues.length)throw new Error('自動對齊結果句數不符，未寫入筆記。');
      this.writing=true;
      try {
        await this.app.vault.process(file,content=>{
          const fresh=parseLyrics(content);if(JSON.stringify(fresh.map(c=>c.key))!==JSON.stringify(cues.map(c=>c.key)))throw new Error('歌詞在對齊途中已修改，請重新執行。');
          let updated=content;for(const cue of fresh)updated=clearTiming(updated,cue.key);
          for(let i=0;i<cues.length;i++)updated=updateTiming(updated,cues[i].key,result[i].start,result[i].end);
          return updated;
        });
        await this.reload();
      }finally{this.writing=false;}
      await this.app.fileManager.processFrontMatter(file,props=>{props.sing_along_alignment='audio-asr-refined-q4-v3';});
      this.alignJob=null;this.setStatus(`自動對齊完成：${result.length} 句。點歌詞即可跳播，選一句後可循環練唱。`);
    }catch(e){child.kill();if(this.alignJob===child)this.alignJob=null;this.setStatus(e.message);throw e;}finally{if(this.alignJob===child)this.alignJob=null;this.updateControls();}
  }
  scheduleMiniPlayer(){
    window.cancelAnimationFrame(this.miniFrame);
    this.miniFrame=window.requestAnimationFrame(()=>this.updateMiniPlayer());
  }
  updateMiniPlayer(){
    this.positionDock();
    if(this.closed||!this.sections)return;
    const scroller=this.contentEl.querySelector('.sa-layout');if(!scroller)return;
    const root=this.contentEl.getBoundingClientRect(),viewport=scroller.getBoundingClientRect();
    if(root.width===0||root.height===0)return;
    const slot=this.videoEl?.getBoundingClientRect();
    const mini=!!this.player?.el&&slot?.bottom<=viewport.top+1;
    const changed=this.contentEl.classList.contains('is-mini-player')!==mini;
    this.contentEl.classList.toggle('is-mini-player',mini);
    const scale=root.height/this.contentEl.offsetHeight||1;
    if(mini){
      const video=this.player.el;video.style.left='0px';video.style.top='0px';
      const origin=video.getBoundingClientRect();
      this.sections.style.maxHeight=`${Math.max(100,(root.height-origin.height-48)/scale)}px`;
      const groupHeight=origin.height+16+this.sections.getBoundingClientRect().height;
      const groupTop=Math.max(16,(root.height-groupHeight)/2);
      video.style.left=`${root.left+12-origin.left}px`;
      video.style.top=`${root.top+groupTop-origin.top}px`;
      this.sections.style.top=`${(groupTop+origin.height+16)/scale}px`;
    }else{
      this.player?.el.style.removeProperty('left');this.player?.el.style.removeProperty('top');
      this.sections.style.maxHeight=`${Math.max(100,(root.height-32)/scale)}px`;
      this.sections.style.top=`${Math.max(16,(root.height-this.sections.getBoundingClientRect().height)/2)/scale}px`;
    }
    if(changed)this.scheduleMiniPlayer();
  }
  positionDock(){
    const scroller=this.contentEl.querySelector('.sa-layout');if(!scroller||!this.dockEl)return;
    const viewport=scroller.getBoundingClientRect(),style=getComputedStyle(scroller);
    const left=viewport.left+parseFloat(style.paddingLeft),right=viewport.right-parseFloat(style.paddingRight)-(scroller.offsetWidth-scroller.clientWidth);
    this.dockEl.style.left='0px';const origin=this.dockEl.getBoundingClientRect();
    this.dockEl.style.left=`${(left+right)/2-(origin.left+origin.width/2)}px`;
  }
  scrollTo(index){
    const row=this.rows[index],scroller=this.contentEl.querySelector('.sa-layout');if(!row||!scroller)return;
    this.centeringCue=index;this.centerPass=0;
    const target=row.getBoundingClientRect().top-scroller.getBoundingClientRect().top+scroller.scrollTop-(scroller.clientHeight-row.getBoundingClientRect().height)/2;
    const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    scroller.scrollTo({top:Math.max(0,target),behavior:reduced?'auto':'smooth'});
    window.clearTimeout(this.centerTimer);this.centerTimer=window.setTimeout(()=>this.finishCentering(),180);
  }
  finishCentering(){
    const index=this.centeringCue,row=this.rows[index],scroller=this.contentEl.querySelector('.sa-layout');
    if(index==null||!row||!scroller||this.closed)return;
    const rect=row.getBoundingClientRect(),viewport=scroller.getBoundingClientRect();
    const delta=rect.top+rect.height/2-(viewport.top+scroller.clientHeight/2);
    if(Math.abs(delta)>1&&this.centerPass++<3){
      const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      scroller.scrollTo({top:Math.max(0,scroller.scrollTop+delta),behavior:reduced?'auto':'smooth'});
      window.clearTimeout(this.centerTimer);this.centerTimer=window.setTimeout(()=>this.finishCentering(),180);
    }else this.centeringCue=null;
  }
  async tick(){
    if(this.busy||this.closed||!this.player)return;this.busy=true;const player=this.player;
    try{
      const state=await player.snapshot();if(player!==this.player||this.closed)return;
      if(!state){if(Date.now()-this.loadingSince>20000)this.setStatus('影片仍在載入；請檢查網路，或重新連接影片。');return;}
      const wasReady=this.snapshot?.ready;this.snapshot=state;
      if(state.error){this.setStatus(ERRORS[state.error]||`YouTube 播放錯誤 ${state.error}`);this.updateControls();return;}
      if(state.ready&&!wasReady){this.speed.empty();for(const rate of state.rates||[1])this.speed.createEl('option',{value:String(rate),text:rate+'×'});this.setStatus('影片已準備好，點歌詞即可跳播。');}
      this.speed.value=String(state.rate||1);
      if(!state.ready&&Date.now()-this.loadingSince>20000)this.setStatus('YouTube 尚未回應；請檢查網路後重新連接。');
      if(state.blocked)this.setStatus('請直接點影片上的播放鍵，允許 YouTube 開始播放。');
      const range=this.loop?this.getLoopRange():null;
      if(range&&(state.state===1||state.state===0)&&(state.time>=range.end||state.time<range.start-0.3)){
        await player.command('seekTo',range.start,true);if(state.state===0)await player.command('playVideo');
      }
      const current=activeAt(this.cues,state.time,state.duration);
      if(current!==this.active){this.active=current;this.rows.forEach((r,i)=>{r.classList.toggle('is-playing',i===current);if(i===current)r.setAttribute('aria-current','true');else r.removeAttribute('aria-current');});if(this.follow&&current>=0){if(!this.loop){this.selected=current;this.updateSelection();}this.scrollTo(current);}}
      this.updateControls();
    }catch(e){if(player===this.player&&!this.closed)this.setStatus('播放器連線中斷，請重新連接影片。');}finally{this.busy=false;}
  }
}
module.exports=class SingAlongPlugin extends Plugin {
  async onload(){
    this.registerView(VIEW,leaf=>new SingView(leaf,this));
    this.navigation=new SongNavigation(this.app);
    this.register(this.navigation.install(WorkspaceLeaf));
    this.registerEvent(this.app.workspace.on('active-leaf-change',leaf=>this.navigation.routeMarkdown(leaf).catch(e=>new Notice(e.message))));
    this.app.workspace.onLayoutReady(()=>this.navigation.enabled&&this.navigation.routeMarkdown(this.app.workspace.activeLeaf).catch(e=>new Notice(e.message)));
    this.registerMarkdownCodeBlockProcessor('sing-along',(_source,el,ctx)=>{
      button(el,'▶ 開啟逐句學唱',()=>this.open(ctx.sourcePath),'mod-cta');
    });
    this.addRibbonIcon('mic-vocal','逐句學唱',()=>this.open().catch(e=>new Notice(e.message)));
    this.addCommand({id:'edit-current-song',name:'編輯目前歌詞原文',callback:()=>this.navigation.editSource(this.app.workspace.activeLeaf?.view).catch(e=>new Notice(e.message))});
    this.addCommand({id:'open-current-song',name:'用目前筆記開啟逐句學唱',callback:()=>this.open().catch(e=>new Notice(e.message))});
  }
  async open(sourcePath){
    const file=sourcePath?this.app.vault.getAbstractFileByPath(sourcePath):this.app.workspace.activeLeaf?.view.file||this.app.workspace.getActiveFile();
    return this.navigation.open(file);
  }
  onunload(){this.navigation.enabled=false;this.app.workspace.detachLeavesOfType(VIEW);}
};
