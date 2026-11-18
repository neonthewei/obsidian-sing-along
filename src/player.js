const {remote, shell} = require('electron');
function wrapper(id) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="strict-origin-when-cross-origin"><style>html,body,#player{margin:0;width:100%;height:100%;overflow:hidden;background:#000}</style></head><body><div id="player"></div><script>
  window.sing={ready:false,error:null,state:-1,time:0,duration:0,rate:1,rates:[1]};
  window.onYouTubeIframeAPIReady=()=>{window.player=new YT.Player('player',{width:'100%',height:'100%',videoId:${JSON.stringify(id)},playerVars:{playsinline:1,autoplay:0,controls:0,disablekb:1,fs:0,iv_load_policy:3},events:{onReady:()=>{sing.ready=true;sing.rates=player.getAvailablePlaybackRates()},onStateChange:e=>sing.state=e.data,onError:e=>sing.error=e.data,onPlaybackRateChange:e=>sing.rate=e.data,onAutoplayBlocked:()=>sing.blocked=true}})};
  window.snapshot=()=>{if(sing.ready){sing.time=player.getCurrentTime();sing.duration=player.getDuration();sing.state=player.getPlayerState()}return sing};
  </script><script src="https://www.youtube.com/iframe_api"></script></body></html>`;
}
class YoutubePlayer {
  constructor(container, id, onShortcut) {
    this.closed=false; this.loaded=false;this.chromeApplied=false;
    const partition='sing-along-'+crypto.randomUUID();
    this.session=remote.session.fromPartition(partition);
    this.session.setPermissionRequestHandler((_wc,_p,cb)=>cb(false));
    // Required desktop identity, confined to an in-memory session for this player only.
    this.session.webRequest.onBeforeSendHeaders({urls:['https://www.youtube.com/embed/*']},(details,cb)=>{
      const headers={...details.requestHeaders};
      for(const k of Object.keys(headers)) if(k.toLowerCase()==='referer')delete headers[k];
      headers.Referer='https://md.obsidian/';cb({requestHeaders:headers});
    });
    this.el=container.ownerDocument.createElement('webview');
    this.el.setAttribute('partition',partition);
    this.el.setAttribute('webpreferences','contextIsolation=yes,sandbox=yes');
    this.el.setAttribute('aria-label','YouTube 學唱影片');
    this.el.addEventListener('dom-ready',()=>{
      if(this.closed)return;
      this.loaded=true;
      const wc=remote.webContents.fromId(this.el.getWebContentsId());
      wc.setWindowOpenHandler(({url})=>{ if(/^https:\/\/(www\.)?(youtube\.com|youtu\.be)\//.test(url))void shell.openExternal(url);return {action:'deny'}; });
      wc.on('will-navigate',event=>event.preventDefault());
      wc.on('did-frame-finish-load',()=>{this.chromeApplied=false;});
      wc.on('before-input-event',(event,input)=>{
        if(input.type!=='keyDown'||input.control||input.alt)return;
        if(input.meta&&!['ArrowUp','ArrowDown','KeyR'].includes(input.code))return;
        if(!['Space','ArrowUp','ArrowDown','KeyR'].includes(input.code))return;
        event.preventDefault();onShortcut?.({key:input.key,code:input.code,repeat:input.isAutoRepeat,metaKey:input.meta});
      });
    });
    this.el.src='data:text/html;charset=utf-8,'+encodeURIComponent(wrapper(id));
    container.appendChild(this.el);
  }
  async snapshot() {
    if(this.closed||!this.loaded)return null;
    const state=await this.el.executeJavaScript('window.snapshot ? window.snapshot() : null');
    if(state?.ready&&!this.chromeApplied){try{await this.cleanChrome();}catch{}}
    return state;
  }
  async cleanChrome(){
    if(this.closed)return;
    const wc=remote.webContents.fromId(this.el.getWebContentsId());
    const frames=wc.mainFrame.frames.filter(frame=>frame.url.startsWith('https://www.youtube.com/embed/'));
    const mobile='html:has(#movie_player:not(.ad-showing)) .ytPlayerControlsContainerHost, html:has(#movie_player:not(.ad-showing)) ytm-custom-control';
    const desktop=['.ytp-chrome-top','.ytp-chrome-bottom','.ytp-gradient-top','.ytp-gradient-bottom','.ytp-watermark','.ytp-pause-overlay','.ytp-large-play-button'].map(selector=>'#movie_player:not(.ad-showing) '+selector).join(',');
    const css=mobile+','+desktop+'{display:none!important}';
    for(const frame of frames)await frame.executeJavaScript(`(()=>{let style=document.getElementById('sing-along-clean-player');if(!style){style=document.createElement('style');style.id='sing-along-clean-player';document.head.appendChild(style)}style.textContent=${JSON.stringify(css)};return true})()`);
    if(frames.length)this.chromeApplied=true;
  }
  async command(method,...args) {
    if(this.closed||!this.loaded)throw new Error('播放器尚未準備好。');
    if(!['playVideo','pauseVideo','seekTo','setPlaybackRate'].includes(method))throw new Error('未知的播放操作。');
    return this.el.executeJavaScript(`(()=>{if(!window.sing?.ready)return false;window.player[${JSON.stringify(method)}](...${JSON.stringify(args)});return true})()`,true);
  }
  destroy() {
    this.closed=true;this.loaded=false;this.el?.remove();
    this.session?.webRequest.onBeforeSendHeaders(null);
    this.session?.setPermissionRequestHandler(null);
  }
}
module.exports={YoutubePlayer};
