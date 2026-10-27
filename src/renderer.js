const state={folders:[],movies:[],currentView:'home',query:'',hero:null,details:null,activeMovie:null,previewTimers:new Map(),muted:false,volume:1,externalAudio:false,selectedAudioTrack:0};const $=id=>document.getElementById(id);const emptyState=$('emptyState'),libraryView=$('libraryView'),rows=$('rows'),heroBackdrop=$('heroBackdrop'),heroTitle=$('heroTitle'),heroMeta=$('heroMeta'),detailsDialog=$('detailsDialog'),playerOverlay=$('playerOverlay'),videoPlayer=$('videoPlayer'),audioPlayer=new Audio(),subtitleSelect=$('subtitleSelect'),audioSelect=$('audioSelect'),volumeSlider=$('volumeSlider');

function formatTime(seconds){if(!Number.isFinite(seconds)||seconds<0)return'0:00';const total=Math.floor(seconds),h=Math.floor(total/3600),m=Math.floor(total%3600/60),s=String(total%60).padStart(2,'0');return h?h+':'+String(m).padStart(2,'0')+':'+s:m+':'+s}
function formatBytes(bytes){if(!bytes)return'';const u=['B','KB','MB','GB','TB'];let n=bytes,i=0;while(n>=1024&&i<u.length-1){n/=1024;i++}return n.toFixed(i>1?1:0)+' '+u[i]}
function resolution(movie){const v=movie.streams?.video?.[0];if(!v?.height)return'';if(v.height>=2100)return'4K';if(v.height>=1400)return'1440p';if(v.height>=1000)return'1080p';if(v.height>=700)return'720p';return v.height+'p'}
function fpsLabel(movie){const fps=movie.streams?.video?.[0]?.fps;if(!fps)return'';return Math.round(fps)+' FPS'}
function mediaBadges(movie){const result=[];const res=resolution(movie);if(res)result.push(res);if(movie.hdr)result.push(movie.hdr);const codec=movie.streams?.video?.[0]?.codec;if(codec)result.push(codec.toUpperCase());const fps=fpsLabel(movie);if(fps)result.push(fps);if((movie.streams?.audio?.length||0)>1)result.push(movie.streams.audio.length+' AUDIO');if((movie.playableSubtitles?.length||0)>0)result.push('CC');return result}
function meta(movie){return[movie.year,formatTime(movie.duration),movie.extension?.replace('.','').toUpperCase(),formatBytes(movie.size)].filter(Boolean).join('  •  ')}
function img(movie,index=0){return movie.frames?.[index]||''}
function escapeHtml(value=''){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
function badgeMarkup(movie,limit=5){return mediaBadges(movie).slice(0,limit).map((b,i)=>'<span class="media-badge '+(i===0?'accent':'')+'">'+escapeHtml(b)+'</span>').join('')}
function humanLanguage(code){const names={es:'Español',spa:'Español',en:'Inglés',eng:'Inglés',fr:'Francés',de:'Alemán',it:'Italiano',pt:'Portugués',ja:'Japonés',und:'Sin idioma'};return names[String(code||'und').toLowerCase()]||String(code||'und').toUpperCase()}

function setData(next){state.folders=next.folders||[];state.movies=next.movies||[];render();if($('foldersDialog').open)renderFolders()}
function renderFolders(){const list=$('folderList');list.innerHTML='';if(!state.folders.length){list.innerHTML='<li class="folder-empty">Aún no hay carpetas en tu biblioteca.</li>';return}state.folders.forEach(folder=>{const item=document.createElement('li');item.className='folder-item';const info=document.createElement('div');info.className='folder-info';info.title=folder;const name=document.createElement('span');name.className='folder-name';name.textContent=folder.split(/[\\/]/).filter(Boolean).pop()||folder;const where=document.createElement('span');where.className='folder-path';where.textContent=folder;info.append(name,where);const remove=document.createElement('button');remove.className='folder-remove';remove.textContent='Quitar';remove.setAttribute('aria-label','Quitar '+folder);remove.addEventListener('click',async()=>{remove.disabled=true;setData(await window.myMovies.removeFolder(folder))});item.append(info,remove);list.appendChild(item)})}
function openFolders(){renderFolders();$('foldersDialog').showModal()}
function filteredMovies(){let items=[...state.movies];if(state.currentView==='favorites')items=items.filter(m=>m.favorite);if(state.currentView==='recent')items.sort((a,b)=>b.modifiedAt-a.modifiedAt);if(state.query){const q=state.query.toLowerCase();items=items.filter(m=>(m.title+' '+m.filename+' '+m.folder).toLowerCase().includes(q))}return items}

function render(){
  const hasLibrary=state.folders.length>0;emptyState.classList.toggle('hidden',hasLibrary);libraryView.classList.toggle('hidden',!hasLibrary);if(!hasLibrary)return;
  const items=filteredMovies();state.hero=items[0]||state.movies[0]||null;renderHero(state.hero);
  const titles={home:'Tu selección',favorites:'Mi lista',recent:'Agregadas recientemente'};$('viewTitle').textContent=state.query?'Resultados para “'+state.query+'”':titles[state.currentView]||'Tu selección';
  const totalHours=state.movies.reduce((s,m)=>s+(m.duration||0),0)/3600;const hdrCount=state.movies.filter(m=>m.hdr).length;
  $('libraryStats').innerHTML='<span class="stat-pill">'+state.movies.length+' títulos</span><span class="stat-pill">'+Math.round(totalHours)+' h</span>'+(hdrCount?'<span class="stat-pill">'+hdrCount+' HDR</span>':'')+'<span class="stat-pill">'+state.folders.length+' carpeta'+(state.folders.length===1?'':'s')+'</span>';
  rows.innerHTML='';if(!items.length){rows.innerHTML='<div style="padding:100px 4vw;color:#8e9199"><span class="section-kicker">SIN RESULTADOS</span><h2 style="color:white;font-size:34px;margin:10px 0">No encontramos nada aquí.</h2><p>Prueba otra vista, otra búsqueda o vuelve a analizar tus carpetas.</p></div>';return}
  const continueWatching=items.filter(m=>m.progress?.seconds>30&&m.progress.seconds<(m.duration||Infinity)*.95),favorites=items.filter(m=>m.favorite),long=items.filter(m=>m.duration>=5400),recent=[...items].sort((a,b)=>b.modifiedAt-a.modifiedAt).slice(0,24),highQuality=items.filter(m=>['4K','1440p','1080p'].includes(resolution(m))),hdr=items.filter(m=>m.hdr);
  const groups=[];if(continueWatching.length)groups.push(['Continuar viendo',continueWatching]);if(state.currentView==='home'&&recent.length)groups.push(['Recién añadidas',recent]);if(favorites.length&&state.currentView==='home')groups.push(['Mi lista',favorites]);if(hdr.length>2&&state.currentView==='home')groups.push(['HDR',hdr]);if(highQuality.length>3&&state.currentView==='home')groups.push(['Alta definición',highQuality]);groups.push([state.query?'Resultados':'Toda tu biblioteca',items]);if(long.length>3&&state.currentView==='home')groups.push(['Para una noche de cine',long]);
  const seen=new Set();groups.forEach(([title,movies])=>{const key=title+':'+movies.map(m=>m.id).join(',');if(seen.has(key))return;seen.add(key);rows.appendChild(makeRow(title,movies))})
}

function renderHero(movie){if(!movie){heroTitle.textContent='Tu biblioteca';heroMeta.textContent=state.scanning?'Analizando tu carpeta… las películas irán apareciendo aquí.':'Añade películas para comenzar.';heroBackdrop.style.backgroundImage='';$('heroBadges').innerHTML='';return}heroTitle.textContent=movie.title;heroMeta.textContent=meta(movie);$('heroBadges').innerHTML=badgeMarkup(movie);const frame=img(movie,1)||img(movie,0);heroBackdrop.style.backgroundImage=frame?'url("'+frame+'")':'linear-gradient(135deg,#451116,#0b0c0e)';$('heroIndex').textContent=String(Math.max(1,state.movies.indexOf(movie)+1)).padStart(2,'0')}
function makeRow(title,movies){const section=document.createElement('section');section.className='row';section.innerHTML='<div class="row-header"><h2>'+escapeHtml(title)+'</h2><span class="row-count">'+movies.length+'</span></div>';const rail=document.createElement('div');rail.className='rail';movies.forEach(movie=>rail.appendChild(makeCard(movie)));section.appendChild(rail);return section}

function makeCard(movie){
  const card=document.createElement('article');card.className='movie-card';card.tabIndex=0;card.setAttribute('aria-label',movie.title);
  const image=document.createElement('img');image.src=img(movie,0);image.alt=movie.title;image.loading='lazy';card.appendChild(image);
  const gradient=document.createElement('div');gradient.className='card-gradient';card.appendChild(gradient);
  const quality=[resolution(movie),movie.hdr].filter(Boolean).join(' · ')||movie.extension?.replace('.','').toUpperCase()||'VIDEO';
  const top=document.createElement('div');top.className='card-top';top.innerHTML='<span class="quality-badge">'+escapeHtml(quality)+'</span>'+(movie.favorite?'<span class="favorite-dot">♥</span>':'');card.appendChild(top);
  const info=document.createElement('div');info.className='card-info';const duration=movie.duration?formatTime(movie.duration):'Vídeo';info.innerHTML='<div class="card-title">'+escapeHtml(movie.title)+'</div><div class="card-meta"><span>'+escapeHtml(duration)+'</span><span class="dot">•</span><span>'+escapeHtml(movie.streams?.audio?.length?movie.streams.audio.length+' audio':'Local')+'</span></div><div class="card-hover-actions"><button class="mini-action primary-action" data-play title="Reproducir">▶</button><button class="mini-action" data-favorite title="Mi lista">'+(movie.favorite?'✓':'＋')+'</button><button class="mini-action" data-info title="Más información">ⓘ</button></div>';card.appendChild(info);
  if(movie.progress?.duration){const p=Math.max(0,Math.min(100,movie.progress.seconds/movie.progress.duration*100)),progress=document.createElement('div');progress.className='progress';progress.innerHTML='<span style="width:'+p+'%"></span>';card.appendChild(progress)}
  card.addEventListener('click',()=>openDetails(movie));card.addEventListener('dblclick',()=>playMovie(movie));card.addEventListener('keydown',e=>{if(e.key==='Enter')openDetails(movie)});
  info.querySelector('[data-play]').addEventListener('click',e=>{e.stopPropagation();playMovie(movie)});info.querySelector('[data-info]').addEventListener('click',e=>{e.stopPropagation();openDetails(movie)});info.querySelector('[data-favorite]').addEventListener('click',async e=>{e.stopPropagation();const result=await window.myMovies.toggleFavorite(movie.id);movie.favorite=result.favorite;render()});
  let frameIndex=0;card.addEventListener('mouseenter',()=>{if(!movie.frames?.length)return;clearInterval(state.previewTimers.get(movie.id));const timer=setInterval(()=>{frameIndex=(frameIndex+1)%movie.frames.length;image.src=movie.frames[frameIndex]},950);state.previewTimers.set(movie.id,timer)});card.addEventListener('mouseleave',()=>{clearInterval(state.previewTimers.get(movie.id));state.previewTimers.delete(movie.id);image.src=img(movie,0)});return card
}

function openDetails(movie){
  state.details=movie;$('detailsTitle').textContent=movie.title;$('detailsMeta').textContent=meta(movie);$('detailsBadges').innerHTML=badgeMarkup(movie);$('detailsPath').textContent=movie.path;$('detailsBackdrop').style.backgroundImage=img(movie,2)?'url("'+img(movie,2)+'")':'';
  $('audioInfo').textContent=movie.streams?.audio?.length?movie.streams.audio.map((a,i)=>(i+1)+'. '+humanLanguage(a.language)+' · '+a.codec+(a.layout?' · '+a.layout:'')).join('\n'):'No se detectaron pistas';
  $('subtitleInfo').textContent=movie.playableSubtitles?.length?movie.playableSubtitles.map(s=>humanLanguage(s.language)+' · '+s.source+' · '+s.label).join('\n'):'Sin subtítulos reproducibles detectados';
  const v=movie.streams?.video?.[0];$('formatInfo').textContent=[movie.format,movie.extension?.toUpperCase(),formatBytes(movie.size),v?.fps?Math.round(v.fps)+' FPS':'',movie.hdr||''].filter(Boolean).join('\n');$('favoriteButton').textContent=movie.favorite?'✓':'＋';detailsDialog.showModal()
}

function showPlaybackNotice(message,type='info'){const el=$('playbackNotice');el.textContent=message;el.className='playback-notice '+type;clearTimeout(showPlaybackNotice.timer);showPlaybackNotice.timer=setTimeout(()=>el.classList.add('hidden'),5200)}
async function playMovie(movie){
  state.activeMovie=movie;
  state.audioRequest++;
  state.externalAudio=false;
  state.selectedAudioTrack=movie.defaultAudioTrack||0;
  audioPlayer.pause();
  audioPlayer.removeAttribute('src');
  audioPlayer.load();
  videoPlayer.muted=state.muted;
  videoPlayer.volume=state.volume;
  audioPlayer.volume=state.volume;
  if(detailsDialog.open)detailsDialog.close();
  $('playerTitle').textContent=movie.title;
  playerOverlay.classList.remove('hidden');
  document.body.style.overflow='hidden';
  await prepareSubtitles(movie);
  if(state.activeMovie?.id!==movie.id)return;
  videoPlayer.addEventListener('loadedmetadata',()=>{resumeOnce();prepareAudioTracks(movie)},{once:true});
  videoPlayer.src=movie.mediaUrl;
  const audioCodec=movie.streams?.audio?.[state.selectedAudioTrack]?.codec;
  const needsExternalAudio=movie.requiresAudioTranscode&&!['aac','mp3','opus','vorbis','flac'].includes(String(audioCodec||'').toLowerCase());
  if(needsExternalAudio){
    const saved=movie.progress;
    const resumeAt=saved?.seconds&&saved.seconds<(movie.duration||Infinity)*.95?saved.seconds:0;
    await startExternalAudio(movie,state.selectedAudioTrack,resumeAt,true);
    return;
  }
  try{await videoPlayer.play()}catch{showPlaybackNotice('No se pudo iniciar este archivo. Puede usar un codec que Chromium no decodifica de forma nativa.','error')}
  updatePlayIcon();
}
state.audioRequest=0;state.audioOffset=0;state.audioRestartedAt=0;state.audioGateResume=false;state.wantPlaying=false;state.audioStalledSince=0;
function waitForAudioReady(){
  return new Promise((resolve,reject)=>{
    const finish=ok=>{clearTimeout(timer);audioPlayer.removeEventListener('canplay',onReady);audioPlayer.removeEventListener('error',onFail);ok?resolve():reject(new Error('No se pudo reproducir la pista de audio convertida.'))};
    const onReady=()=>finish(true),onFail=()=>finish(false);
    const timer=setTimeout(()=>finish(false),20000);
    audioPlayer.addEventListener('canplay',onReady);
    audioPlayer.addEventListener('error',onFail);
  });
}
function waitForAudioClock(){
  return new Promise(resolve=>{
    const started=performance.now();
    const tick=()=>{if(audioPlayer.currentTime>=0.03||performance.now()-started>800)resolve();else setTimeout(tick,10)};
    tick();
  });
}
// Streams the chosen track (transcoded to AAC by the main process) starting at startAt.
// The video waits, like normal buffering, until the audio can play, then both start together.
async function startExternalAudio(movie,trackIndex,startAt,autoplay){
  const request=++state.audioRequest;
  state.audioStarting=false;
  const stale=()=>request!==state.audioRequest||state.activeMovie?.id!==movie.id;
  // A chained restart (several quick seeks) must keep the intent to play even though an earlier gate paused the video.
  const resume=autoplay??(state.audioGateResume||(!videoPlayer.paused&&!videoPlayer.ended));
  state.audioGateResume=resume;
  state.externalAudio=true;
  state.selectedAudioTrack=trackIndex;
  videoPlayer.muted=true;
  // Our own pause (the wait for the audio) must not be undone by the keep-playing-when-hidden rule.
  if(!videoPlayer.paused){state.internalPause=true;videoPlayer.pause()}
  audioPlayer.pause();
  prepareAudioTracks(movie);
  showPlaybackNotice('Preparando el audio…');
  const at=Math.max(0,Number.isFinite(startAt)?startAt:videoPlayer.currentTime||0);
  try{
    const url=await window.myMovies.audioStreamUrl(movie.id,trackIndex,at);
    if(stale())return;
    const ready=waitForAudioReady();
    state.audioOffset=at;
    audioPlayer.src=url;
    audioPlayer.volume=state.volume;
    audioPlayer.muted=state.muted;
    await ready;
    if(stale())return;
    state.audioRestartedAt=Date.now();
    $('playbackNotice').classList.add('hidden');
    if(resume){
      // Audio first, and wait until its clock is really advancing: play() resolves before the output
      // pipeline (~100-300 ms) delivers sound, so starting both together left the audio behind.
      state.audioStarting=true;
      try{
        await audioPlayer.play();
        if(stale())return;
        await waitForAudioClock();
        if(stale())return;
        await videoPlayer.play().catch(error=>{if(!stale()&&error.name!=='AbortError')showPlaybackNotice('No se pudo iniciar este archivo. Puede usar un codec que Chromium no decodifica de forma nativa.','error')});
      }finally{if(!stale())state.audioStarting=false}
    }
    // A newer request owns the shared flags now: touching them here would erase its intent to play.
    if(stale())return;
    state.audioGateResume=false;
    updatePlayIcon();
  }catch(error){
    if(stale())return;
    state.audioGateResume=false;
    state.externalAudio=false;
    videoPlayer.muted=state.muted;
    showPlaybackNotice(error.message||'No se pudo preparar el audio de esta película.','error');
    if(resume)videoPlayer.play().catch(()=>{});
  }
}
function restartExternalAudio(){if(state.externalAudio&&state.activeMovie)startExternalAudio(state.activeMovie,state.selectedAudioTrack,videoPlayer.currentTime)}
// The audio stream ended or failed while the movie is still playing (e.g. ffmpeg was killed):
// re-attach it at the video position instead of leaving the rest of the movie silent.
function recoverExternalAudio(){
  if(!state.externalAudio||!state.activeMovie||state.audioStarting||videoPlayer.paused||videoPlayer.ended)return;
  if(videoPlayer.duration-videoPlayer.currentTime<2)return;
  if(Date.now()-state.audioRestartedAt<2000)return;
  restartExternalAudio();
}
// Keeps the separate audio element locked to the video clock.
// - Small drift is trimmed continuously by nudging the audio playbackRate (max +-6%, pitch preserved).
// - A stalled audio stream (e.g. a slow disk) is handled like buffering: both are re-attached together.
// - The stream cannot seek, so a large drift restarts it at the video position.
function syncExternalAudio(){
  if(!state.externalAudio||state.audioStarting||!audioPlayer.getAttribute('src'))return;
  if(videoPlayer.error){
    if(audioPlayer.paused&&audioPlayer.readyState>=HTMLMediaElement.HAVE_CURRENT_DATA)audioPlayer.play().catch(()=>{});
    return;
  }
  if(videoPlayer.paused||videoPlayer.seeking||videoPlayer.readyState<HTMLMediaElement.HAVE_FUTURE_DATA){audioPlayer.pause();state.audioStalledSince=0;return}
  if(audioPlayer.readyState<HTMLMediaElement.HAVE_FUTURE_DATA){
    if(!state.audioStalledSince)state.audioStalledSince=Date.now();
    else if(Date.now()-state.audioStalledSince>500&&Date.now()-state.audioRestartedAt>2000){state.audioStalledSince=0;restartExternalAudio()}
    return;
  }
  state.audioStalledSince=0;
  if(audioPlayer.ended){recoverExternalAudio();return}
  if(audioPlayer.paused){audioPlayer.play().catch(()=>{});return}
  const drift=audioPlayer.currentTime+state.audioOffset-videoPlayer.currentTime;
  if(Math.abs(drift)>1&&Date.now()-state.audioRestartedAt>3000){restartExternalAudio();return}
  const rate=Math.abs(drift)<=0.02?1:1-Math.max(-0.06,Math.min(0.06,drift*0.6));
  if(Math.abs(audioPlayer.playbackRate-rate)>0.002)audioPlayer.playbackRate=rate;
}
function resumeOnce(){const p=state.activeMovie?.progress;if(p?.seconds&&p.seconds<videoPlayer.duration*.95)videoPlayer.currentTime=p.seconds}
async function prepareSubtitles(movie){[...videoPlayer.querySelectorAll('track')].forEach(t=>t.remove());subtitleSelect.innerHTML='<option value="">Subtítulos: desactivados</option>';(movie.playableSubtitles||[]).forEach((sub,index)=>{const track=document.createElement('track');track.kind='subtitles';track.label=sub.label;track.srclang=sub.language||'und';track.src=sub.url;videoPlayer.appendChild(track);const option=document.createElement('option');option.value=String(index);option.textContent=humanLanguage(sub.language)+' · '+sub.label;subtitleSelect.appendChild(option)});$('subtitleButton').classList.toggle('disabled',!(movie.playableSubtitles||[]).length)}
function prepareAudioTracks(movie){audioSelect.innerHTML='';const tracks=videoPlayer.audioTracks;if(state.externalAudio||!tracks||!tracks.length){if(!state.externalAudio&&movie.streams?.audio?.length<2){audioSelect.classList.add('hidden');return}movie.streams.audio.forEach((meta,index)=>{const option=document.createElement('option');option.value=String(index);option.textContent='Audio · '+humanLanguage(meta.language)+(meta.codec?' · '+meta.codec.toUpperCase():'');audioSelect.appendChild(option)});audioSelect.value=String(state.selectedAudioTrack);audioSelect.classList.toggle('hidden',movie.streams.audio.length<2);return}let selected=-1;for(let i=0;i<tracks.length;i++){const option=document.createElement('option');option.value=String(i);const meta=movie.streams?.audio?.[i];option.textContent='Audio · '+humanLanguage(meta?.language)+(meta?.codec?' · '+meta.codec.toUpperCase():'');audioSelect.appendChild(option);if(tracks[i].enabled)selected=i}if(selected<0){tracks[0].enabled=true;selected=0}audioSelect.value=String(selected);audioSelect.classList.toggle('hidden',tracks.length<2)}
function closePlayer(){if(!state.activeMovie)return;state.audioRequest++;state.audioGateResume=false;saveProgress();videoPlayer.pause();audioPlayer.pause();audioPlayer.removeAttribute('src');audioPlayer.load();state.externalAudio=false;videoPlayer.muted=state.muted;videoPlayer.removeAttribute('src');videoPlayer.load();playerOverlay.classList.add('hidden');$('playbackNotice').classList.add('hidden');document.body.style.overflow='';state.activeMovie=null;render()}
function saveProgress(){if(!state.activeMovie||!Number.isFinite(videoPlayer.currentTime))return;window.myMovies.setProgress(state.activeMovie.id,videoPlayer.currentTime,videoPlayer.duration||state.activeMovie.duration);state.activeMovie.progress={seconds:videoPlayer.currentTime,duration:videoPlayer.duration||state.activeMovie.duration}}
function updatePlayIcon(){$('playPause').textContent=videoPlayer.paused?'▶':'❚❚'}
function updateMuteButton(){$('muteButton').textContent=state.muted?'🔇':'🔊'}
function updateTime(){if(!Number.isFinite(videoPlayer.duration)||!videoPlayer.duration)return;$('seekBar').value=String(videoPlayer.currentTime/videoPlayer.duration*1000);$('timeLabel').textContent=formatTime(videoPlayer.currentTime)+' / '+formatTime(videoPlayer.duration)}

$('libraryButton').addEventListener('click',openFolders);$('addFolderButton').addEventListener('click',async()=>setData(await window.myMovies.chooseLibrary()));document.querySelector('[data-close-folders]').addEventListener('click',()=>$('foldersDialog').close());$('emptyLibraryButton').addEventListener('click',async()=>setData(await window.myMovies.chooseLibrary()));$('rescanButton').addEventListener('click',async()=>setData(await window.myMovies.rescan()));$('searchInput').addEventListener('input',e=>{state.query=e.target.value.trim();render()});
document.querySelectorAll('.nav-link').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('.nav-link').forEach(b=>b.classList.remove('active'));button.classList.add('active');state.currentView=button.dataset.view;render()}));
$('heroPlay').addEventListener('click',()=>state.hero&&playMovie(state.hero));$('heroInfo').addEventListener('click',()=>state.hero&&openDetails(state.hero));$('detailsPlay').addEventListener('click',()=>state.details&&playMovie(state.details));
$('favoriteButton').addEventListener('click',async()=>{if(!state.details)return;const result=await window.myMovies.toggleFavorite(state.details.id);state.details.favorite=result.favorite;$('favoriteButton').textContent=result.favorite?'✓':'＋'});$('revealButton').addEventListener('click',()=>state.details&&window.myMovies.revealFile(state.details.id));document.querySelector('[data-close-dialog]').addEventListener('click',()=>detailsDialog.close());
$('playerClose').addEventListener('click',event=>{event.preventDefault();closePlayer()});$('playerClose').addEventListener('pointerup',event=>{if(event.button===0)closePlayer()});$('playPause').addEventListener('click',()=>{if(videoPlayer.paused)videoPlayer.play();else{state.wantPlaying=false;videoPlayer.pause()}});$('backTen').addEventListener('click',()=>videoPlayer.currentTime=Math.max(0,videoPlayer.currentTime-10));$('forwardTen').addEventListener('click',()=>videoPlayer.currentTime=Math.min(videoPlayer.duration||Infinity,videoPlayer.currentTime+10));$('muteButton').addEventListener('click',()=>{state.muted=!state.muted;videoPlayer.muted=state.externalAudio||state.muted;audioPlayer.muted=state.muted;updateMuteButton()});volumeSlider.addEventListener('input',()=>{state.volume=Number(volumeSlider.value);state.muted=state.volume===0;videoPlayer.volume=state.volume;videoPlayer.muted=state.externalAudio||state.muted;audioPlayer.volume=state.volume;audioPlayer.muted=state.muted;updateMuteButton()});$('fullscreenButton').addEventListener('click',()=>document.fullscreenElement?document.exitFullscreen():playerOverlay.requestFullscreen());$('seekBar').addEventListener('input',e=>{if(videoPlayer.duration)videoPlayer.currentTime=Number(e.target.value)/1000*videoPlayer.duration});
subtitleSelect.addEventListener('change',()=>{const tracks=videoPlayer.textTracks;for(let i=0;i<tracks.length;i++)tracks[i].mode='disabled';if(subtitleSelect.value!==''){const index=Number(subtitleSelect.value);if(tracks[index])tracks[index].mode='showing'}});$('subtitleButton').addEventListener('click',()=>{if(!subtitleSelect.options.length||subtitleSelect.options.length===1)return;subtitleSelect.focus();subtitleSelect.showPicker?.()});audioSelect.addEventListener('change',()=>{const trackIndex=Number(audioSelect.value);if(state.externalAudio||!videoPlayer.audioTracks?.length){if(state.activeMovie)startExternalAudio(state.activeMovie,trackIndex);return}const tracks=videoPlayer.audioTracks;for(let i=0;i<tracks.length;i++)tracks[i].enabled=i===trackIndex});
videoPlayer.addEventListener('play',()=>{state.wantPlaying=true;updatePlayIcon();syncExternalAudio()});videoPlayer.addEventListener('pause',()=>{if(state.internalPause){state.internalPause=false;updatePlayIcon();audioPlayer.pause();return}if(document.hidden&&state.activeMovie&&state.wantPlaying&&!videoPlayer.ended){videoPlayer.play().catch(()=>{});return}updatePlayIcon();audioPlayer.pause()});videoPlayer.addEventListener('seeking',syncExternalAudio);videoPlayer.addEventListener('timeupdate',()=>{updateTime();syncExternalAudio()});videoPlayer.addEventListener('ended',()=>{state.wantPlaying=false;audioPlayer.pause();saveProgress()});videoPlayer.addEventListener('error',()=>{if(!state.activeMovie)return;const codec=state.activeMovie.streams?.video?.[0]?.codec?.toUpperCase()||'desconocido';showPlaybackNotice('Este archivo no pudo reproducirse con el motor integrado. Codec de video detectado: '+codec+'.','error')});audioPlayer.addEventListener('error',()=>{if(state.externalAudio&&state.activeMovie&&!state.audioStarting)recoverExternalAudio()});audioPlayer.addEventListener('ended',recoverExternalAudio);setInterval(()=>{if(state.activeMovie&&!videoPlayer.paused)saveProgress()},10000);
setInterval(()=>{if(state.externalAudio)syncExternalAudio()},200);videoPlayer.addEventListener('waiting',()=>{if(state.externalAudio)audioPlayer.pause()});videoPlayer.addEventListener('playing',syncExternalAudio);videoPlayer.addEventListener('seeking',()=>{if(!state.externalAudio)return;clearTimeout(state.seekTimer);state.seekTimer=setTimeout(()=>{const drift=audioPlayer.currentTime+state.audioOffset-videoPlayer.currentTime;if(Math.abs(drift)>1)restartExternalAudio()},150)});
let hideControlsTimer;playerOverlay.addEventListener('mousemove',()=>{playerOverlay.classList.remove('controls-hidden');clearTimeout(hideControlsTimer);hideControlsTimer=setTimeout(()=>{if(!videoPlayer.paused)playerOverlay.classList.add('controls-hidden')},2600)});
window.addEventListener('scroll',()=>{$('topbar').classList.toggle('scrolled',window.scrollY>24)},{passive:true});
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('searchInput').focus();$('searchInput').select();return}if(playerOverlay.classList.contains('hidden'))return;if(e.key==='Escape'&&!document.fullscreenElement)closePlayer();if(e.code==='Space'){e.preventDefault();if(videoPlayer.paused)videoPlayer.play();else{state.wantPlaying=false;videoPlayer.pause()}}if(e.key==='ArrowLeft')videoPlayer.currentTime=Math.max(0,videoPlayer.currentTime-10);if(e.key==='ArrowRight')videoPlayer.currentTime=Math.min(videoPlayer.duration||Infinity,videoPlayer.currentTime+10)});
window.myMovies.onLibraryUpdated(setData);
window.myMovies.onScanProgress(p=>{const status=$('scanStatus');state.scanning=!p.complete;status.classList.remove('hidden');status.textContent=p.complete?'✓ Biblioteca actualizada':!p.total?'Buscando videos…':(p.cached?'Comprobando ':'Analizando ')+p.done+' / '+p.total+(p.title?' · '+p.title:'');if(p.complete){window.myMovies.getState().then(setData);setTimeout(()=>status.classList.add('hidden'),1800)}});
window.myMovies.getState().then(setData);