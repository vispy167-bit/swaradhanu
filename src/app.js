/* Swaradhanu: browser-only Web Audio practice engine. Microphone audio is never recorded or uploaded. */
const A4 = 440;
const CHROMATIC = ["A", "A♯/B♭", "B", "C", "C♯/D♭", "D", "D♯/E♭", "E", "F", "F♯/G♭", "G", "G♯/A♭"];
const STANDARD_SCALES = { C:-9, 'C#':-8, D:-7, 'D#':-6, E:-5, F:-4, 'F#':-3, G:-2, 'G#':-1, A:0, 'A#':1, B:2 }; // semitones relative to A4 = 440 Hz
const SWARS = [{n:"Sa",s:0},{n:"Re",s:2},{n:"Ga",s:4},{n:"Ma",s:5},{n:"Pa",s:7},{n:"Dha",s:9},{n:"Ni",s:11},{n:"Sa′",s:12}];
const DEVANAGARI_SWARS = { Sa:'सा', Re:'रे', Ga:'ग', Ma:'म', Pa:'प', Dha:'ध', Ni:'नि', 'Sa′':'सा′' };
const $ = id => document.getElementById(id);
const ui = { key:$('keySelect'), octave:$('octaveSelect'), duration:$('duration'), durationOut:$('durationOut'), start:$('startBtn'), check:$('checkBtn'), swars:$('swarButtons'), active:$('activeSwar'), target:$('targetHz'), verdict:$('verdict'), guessed:$('detectedSwar'), needle:$('tunerNeedle'), bubble:$('tunerBubble'), detected:$('detectedHz'), feedback:$('voiceFeedback'), ratio:$('ratioText'), saptak:$('saptakName'), note:$('noteName'), status:$('audioStatus'), cents:$('centsText'), graph:$('pitchGraph'), progress:$('cycleProgress'), timer:$('cycleTime') };
let audioCtx, analyser, micStream, micSource, noiseNode, droneNodes = [], cycleTimer, raf, phase = 'idle', swarIndex = 0, history = [], lastAnalysis = 0, practiceOrder = 'aaroha', lastDetected = -1, graphTarget = -1, smoothedNeedle = 0;
function setMicButton(listening=false){ui.check.innerHTML=listening?'■ Mic':'▶ Mic';ui.check.classList.add('mic-button');ui.check.classList.toggle('running',listening);}
setMicButton();

const themeBtn = $('themeBtn');
const installBtn=document.createElement('button');
installBtn.className='install-button';installBtn.textContent='Install';installBtn.hidden=true;themeBtn.before(installBtn);
const pwaStyles=document.createElement('link');pwaStyles.rel='stylesheet';pwaStyles.href='pwa.css';document.head.append(pwaStyles);
const headerStyles=document.createElement('link');headerStyles.rel='stylesheet';headerStyles.href='header-controls.css';document.head.append(headerStyles);
let deferredInstall;
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstall=event;installBtn.hidden=false;});
installBtn.onclick=async()=>{if(!deferredInstall)return;deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;installBtn.hidden=true;};
window.addEventListener('appinstalled',()=>{installBtn.hidden=true;});
if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js'));
function setTheme(theme){document.body.classList.toggle('light',theme==='light');themeBtn.textContent=theme==='light'?'◐':'☼';localStorage.setItem('swaradhanu-theme',theme);}
setTheme(localStorage.getItem('swaradhanu-theme') || 'dark');
themeBtn.onclick=()=>setTheme(document.body.classList.contains('light')?'dark':'light');

// Standard natural concert-pitch scales: C4 through B4, with A4 exactly 440 Hz.
const scales = Object.fromEntries(Object.entries(STANDARD_SCALES).map(([name, semitones]) => {
  const madhya = A4 * Math.pow(2, semitones / 12);
  return [name, { name, semitones, mandra:madhya/2, madhya, taar:madhya*2 }];
}));
Object.keys(scales).forEach(name => ui.key.add(new Option(`Scale ${name} — ${scales[name].madhya.toFixed(2)} Hz`, name)));
ui.key.value = 'A';

function selectedBase() { return scales[ui.key.value][ui.octave.value]; }
function targetFrequency() { return selectedBase() * Math.pow(2, SWARS[swarIndex].s / 12); }
// Compare a detected note against the nearest equivalent octave of the selected swar.
// This lets a player use Mandra, Madhya, or Taar without having to know its Hz value.
function nearestSaptakTarget(actual, selected) {
  const shift = Math.max(-1, Math.min(1, Math.round(Math.log2(actual / selected))));
  const names = ['MANDRA SAPTAK', 'MADHYA SAPTAK', 'TAAR SAPTAK'];
  const selectedZone = { mandra:0, madhya:1, taar:2 }[ui.octave.value];
  const zone = Math.max(0, Math.min(2, selectedZone + shift));
  return { frequency:selected*Math.pow(2,shift), zone:names[zone] };
}
function showSaptak(label, automatic=false) {
  const zone=label.startsWith('MANDRA')?'mandra':label.startsWith('TAAR')?'taar':'madhya';
  ui.saptak.textContent=automatic?`AUTO · ${label}`:label;
  ui.saptak.parentElement.classList.remove('mandra','madhya','taar');
  ui.saptak.parentElement.classList.add(zone);
  const card=ui.saptak.closest('.active-card');
  card.classList.remove('mandra','madhya','taar');
  card.classList.add(zone);
}
function identifyPlayedSwar(actual) {
  const reference=scales[ui.key.value].madhya; let best=null;
  for(let zone=-1;zone<=1;zone++) for(const swar of SWARS.slice(0,7)){
    const frequency=reference*Math.pow(2,zone)*Math.pow(2,swar.s/12);
    const distance=Math.abs(1200*Math.log2(actual/frequency));
    if(!best||distance<best.distance) best={swar,zone,frequency,distance};
  }
  return best;
}
function noteLabel() {
  const absolute = scales[ui.key.value].semitones + SWARS[swarIndex].s;
  const note = CHROMATIC[((absolute % 12) + 12) % 12];
  const octave = Math.floor((69 + absolute) / 12) - 1 + (ui.octave.value === 'mandra' ? -1 : ui.octave.value === 'taar' ? 1 : 0);
  return `${note}${octave}`;
}
function renderSwars() { /* The current swar is advanced automatically by the practice sequence. */ }
function updateTarget() {
  const hz = targetFrequency();
  graphTarget = hz;
  ui.active.innerHTML = `${SWARS[swarIndex].n} <span>| ${DEVANAGARI_SWARS[SWARS[swarIndex].n]}</span>`;
  ui.target.textContent = `${hz.toFixed(2)} Hz`;
  ui.ratio.textContent = Math.pow(2, SWARS[swarIndex].s / 12).toFixed(3);
  showSaptak(`${ui.octave.value.toUpperCase()} SAPTAK`);
  ui.note.textContent = `Active: ${noteLabel()} (${hz.toFixed(1)} Hz)`;
  ui.verdict.textContent = 'SELECTED TARGET'; ui.verdict.className = '';
}
ui.duration.oninput=()=>ui.durationOut.value=`${ui.duration.value} s`;
ui.key.onchange=updateTarget; ui.octave.onchange=()=>{document.querySelectorAll('[data-octave]').forEach(b=>b.classList.toggle('active',b.dataset.octave===ui.octave.value));updateTarget();};
document.querySelectorAll('[data-octave]').forEach(b=>b.onclick=()=>{ui.octave.value=b.dataset.octave;ui.octave.onchange();});
document.querySelectorAll('[data-order]').forEach(b=>b.onclick=()=>{practiceOrder=b.dataset.order;document.querySelectorAll('[data-order]').forEach(x=>x.classList.toggle('active',x===b));});
renderSwars(); updateTarget();

function ensureAudio() {
  if (!audioCtx) audioCtx = new AudioContext();
  return audioCtx.resume();
}
function makeFluteDrone(freq) {
  const now=audioCtx.currentTime, master=audioCtx.createGain(); master.gain.setValueAtTime(.0001,now); master.connect(audioCtx.destination);
  // PeriodicWave: fundamental forward, progressively soft odd harmonics give a hollow bamboo colour.
  const real=new Float32Array(8), imag=new Float32Array(8); imag[1]=1; imag[3]=.22; imag[5]=.08; imag[7]=.025;
  const wave=audioCtx.createPeriodicWave(real,imag,{disableNormalization:false});
  const osc=audioCtx.createOscillator(); osc.setPeriodicWave(wave); osc.frequency.value=freq; osc.detune.value=-3;
  const breath=audioCtx.createOscillator(), breathGain=audioCtx.createGain(); breath.frequency.value=5.1; breathGain.gain.value=.035; breath.connect(breathGain).connect(master.gain);
  // A low, filtered white-noise layer creates a little moving air without obscuring the pitch.
  const buffer=audioCtx.createBuffer(1,audioCtx.sampleRate*2,audioCtx.sampleRate), data=buffer.getChannelData(0); for(let i=0;i<data.length;i++) data[i]=Math.random()*2-1;
  const noise=audioCtx.createBufferSource(), filter=audioCtx.createBiquadFilter(), ng=audioCtx.createGain(); noise.buffer=buffer; noise.loop=true; filter.type='bandpass'; filter.frequency.value=2100; filter.Q.value=.8; ng.gain.value=.011; noise.connect(filter).connect(ng).connect(master);
  osc.connect(master); osc.start(now); breath.start(now); noise.start(now); master.gain.exponentialRampToValueAtTime(.21,now+.32);
  droneNodes=[osc,breath,noise,master];
}
function stopDrone(fade=.35) {
  if(!droneNodes.length)return; const [osc,breath,noise,master]=droneNodes, now=audioCtx.currentTime; master.gain.cancelScheduledValues(now); master.gain.setTargetAtTime(.0001,now,fade/5); setTimeout(()=>{[osc,breath,noise].forEach(n=>{try{n.stop()}catch{}}); master.disconnect();},fade*1000+80); droneNodes=[];
}
async function startMic() {
  if (micStream) return;
  try { micStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}}); micSource=audioCtx.createMediaStreamSource(micStream); analyser=audioCtx.createAnalyser(); analyser.fftSize=4096; analyser.smoothingTimeConstant=.05; micSource.connect(analyser); }
  catch(e) { ui.status.innerHTML='<i></i> Mic permission needed'; ui.verdict.textContent='ALLOW MICROPHONE ACCESS'; ui.verdict.className='warn'; throw e; }
}
function stopMic() { if(micStream){micStream.getTracks().forEach(t=>t.stop()); micSource.disconnect(); micStream=null; analyser=null;} }
function setPhase(next) {
  phase=next; const secs=+ui.duration.value;
  if(next==='drone') { stopMic(); makeFluteDrone(targetFrequency()); ui.status.innerHTML=`<i></i> Playing ${SWARS[swarIndex].n}`; }
  else { stopDrone(); ui.status.innerHTML='<i></i> Mic: Listening'; startMic().catch(()=>stopPractice()); }
  const begun=performance.now(); clearInterval(cycleTimer); cycleTimer=setInterval(()=>{const left=Math.max(0,secs-(performance.now()-begun)/1000); ui.timer.textContent=`${phase==='drone'?'PLAY':'LISTEN'} ${String(Math.ceil(left)).padStart(2,'0')}s`; ui.progress.style.width=`${(1-left/secs)*100}%`; if(!left){clearInterval(cycleTimer);if(phase==='drone')setPhase('listen');else{advanceSwar();setPhase('drone');}}},100);
}
function advanceSwar(){swarIndex=practiceOrder==='aaroha'?(swarIndex+1)%SWARS.length:(swarIndex-1+SWARS.length)%SWARS.length;history=[];smoothedNeedle=0;updateTarget();}
async function startPractice(){await ensureAudio(); swarIndex=practiceOrder==='aaroha'?0:SWARS.length-1;smoothedNeedle=0;updateTarget();setMicButton();ui.start.textContent='■ Stop practice';ui.start.classList.add('running');ui.start.onclick=stopPractice; history=[]; setPhase('drone'); if(!raf) pitchLoop();}
function stopPractice(){clearInterval(cycleTimer);stopDrone();stopMic();phase='idle';setMicButton();ui.start.textContent='▶ Start drone practice cycle';ui.start.classList.remove('running');ui.start.onclick=startPractice;ui.status.innerHTML='<i></i> Mic: Listen<br>Mode';ui.progress.style.width='0%';ui.timer.textContent='00:00';}
ui.start.onclick=startPractice;

// Immediate mode is useful when you simply want an answer for one selected swar.
async function togglePitchCheck() {
  if (phase === 'check') { stopMic(); phase='idle'; setMicButton(); ui.status.innerHTML='<i></i> Mic: Listen<br>Mode'; ui.verdict.textContent='SELECTED TARGET'; ui.verdict.className=''; return; }
  if (phase !== 'idle') stopPractice();
  await ensureAudio(); history=[]; phase='check'; setMicButton(true); ui.status.innerHTML='<i></i> Mic: Checking'; ui.verdict.textContent='LISTENING…'; ui.verdict.className='';
  try { await startMic(); if(!raf) pitchLoop(); } catch { phase='idle'; setMicButton(); }
}
ui.check.onclick=togglePitchCheck;

// YIN compares the waveform to delayed copies of itself. It is more stable than a
// plain autocorrelation peak when a voice or bansuri note is quiet or breathy.
function yinPitch(buf, sampleRate) {
  let rms=0; for(let i=0;i<buf.length;i++) rms+=buf[i]*buf[i];
  if(Math.sqrt(rms/buf.length)<.0007) return -1; // accepts quiet phone microphone input
  const minTau=Math.floor(sampleRate/1200), maxTau=Math.min(Math.floor(sampleRate/65), Math.floor(buf.length/2));
  const diff=new Float32Array(maxTau+1), cmnd=new Float32Array(maxTau+1); let running=0, tau=-1;
  for(let t=1;t<=maxTau;t++){
    let sum=0; for(let i=0;i<buf.length-t;i++){const d=buf[i]-buf[i+t]; sum+=d*d;}
    diff[t]=sum; running+=sum;
    cmnd[t]=t*sum/(running || 1); // cumulative mean normalized difference
  }
  for(let t=minTau;t<maxTau;t++) if(cmnd[t]<.22){ while(t+1<maxTau && cmnd[t+1]<cmnd[t])t++; tau=t; break; }
  if(tau<0) return -1;
  // Refine the selected valley to get fractional-sample accuracy.
  let x0=cmnd[Math.max(1,tau-1)], x1=cmnd[tau], x2=cmnd[Math.min(maxTau,tau+1)];
  const adjust=(x2-x0)/(2*(2*x1-x2-x0) || 1); tau+=Math.max(-.5,Math.min(.5,adjust));
  return sampleRate/tau;
}
function pitchLoop(){
  raf=requestAnimationFrame(pitchLoop); let f=targetFrequency(), now=performance.now();
  // Analyse about 12 times/sec: smoother display and much less CPU work on phones.
  if(analyser&&(phase==='listen'||phase==='check')&&now-lastAnalysis>80){
    lastAnalysis=now; const b=new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(b); const detected=yinPitch(b,audioCtx.sampleRate);
    if(detected>60&&detected<1600){
      history.push(detected); if(history.length>120)history.shift();
      const recent=history.slice(-9).sort((a,b)=>a-b), stable=recent[Math.floor(recent.length/2)];
      const octaveMatch=nearestSaptakTarget(stable,f), guessed=identifyPlayedSwar(stable); f=octaveMatch.frequency; graphTarget=f;
      const zoneName=['MANDRA SAPTAK','MADHYA SAPTAK','TAAR SAPTAK'][guessed.zone+1];
      showSaptak(zoneName,true); ui.guessed.textContent=`YOU PLAYED: ${guessed.swar.n.toUpperCase()} · ${zoneName}`;
      const hzError=stable-f, abs=Math.abs(hzError); lastDetected=stable;
      ui.detected.textContent=`${stable.toFixed(1)} Hz`; ui.cents.textContent=`${hzError>0?'+':''}${hzError.toFixed(1)} Hz`; ui.feedback.textContent=`${hzError>0?'+':''}${hzError.toFixed(1)} Hz`;
      if(abs<=10){ui.verdict.textContent='✓ PERFECT · WITHIN ±10 Hz';ui.verdict.className='good';}
      else if(hzError<0){ui.verdict.textContent='↓ FLAT · RAISE PITCH';ui.verdict.className='warn';}
      else {ui.verdict.textContent='↑ SHARP · LOWER PITCH';ui.verdict.className='warn';}
      drawMeter(hzError); moveNeedle(hzError);
    } else { ui.cents.textContent='--.- Hz'; ui.detected.textContent='--.- Hz'; ui.feedback.textContent='waiting'; ui.guessed.textContent='HOLD A STEADY NOTE NEAR THE MICROPHONE'; ui.verdict.textContent='PLAY A STEADY NOTE'; ui.verdict.className=''; }
  }
  drawGraph(graphTarget>0?graphTarget:f);
}
function canvas(c){const rect=c.getBoundingClientRect(),ratio=devicePixelRatio||1;if(c.width!==Math.round(rect.width*ratio)){c.width=Math.round(rect.width*ratio);c.height=Math.round(rect.height*ratio)}const x=c.getContext('2d');x.setTransform(ratio,0,0,ratio,0,0);return [x,rect.width,rect.height]}
function drawMeter(){}
function moveNeedle(hzError){
  const desired=Math.max(-60,Math.min(60,hzError));
  smoothedNeedle+=(desired-smoothedNeedle)*.16;
  // Direct endpoint calculation locks the pivot at the centre of the SVG dial.
  const radians=(smoothedNeedle*.8)*Math.PI/180, radius=93;
  ui.needle.removeAttribute('transform');
  ui.needle.setAttribute('x2',(130+Math.sin(radians)*radius).toFixed(2));
  ui.needle.setAttribute('y2',(130-Math.cos(radians)*radius).toFixed(2));
  const state=Math.abs(smoothedNeedle)<=10?'in-tune':smoothedNeedle<0?'flat':'sharp';
  ui.bubble.textContent=state==='in-tune'?'✓ PERFECT (±10 Hz)':state==='flat'?'↓ FLAT':'↑ SHARP';
  ui.bubble.className=`tuner-bubble ${state}`;
}
function drawGraph(target){const [c,w,h]=canvas(ui.graph),css=getComputedStyle(document.body);c.clearRect(0,0,w,h);c.fillStyle=css.getPropertyValue('--graph');c.fillRect(0,0,w,h);const span=60,min=target-span,max=target+span;for(let i=0;i<5;i++){const v=min+(max-min)*i/4,y=h-(v-min)/(max-min)*h;c.strokeStyle='#d8865544';c.lineWidth=1;c.beginPath();c.moveTo(0,y);c.lineTo(w,y);c.stroke();c.fillStyle=css.getPropertyValue('--graphline');c.font='9px monospace';c.fillText(`${v.toFixed(1)}`,7,y-4)}const ty=h-(target-min)/(max-min)*h;c.setLineDash([5,5]);c.strokeStyle='#d28b3d';c.lineWidth=2;c.beginPath();c.moveTo(0,ty);c.lineTo(w,ty);c.stroke();c.setLineDash([]);c.fillStyle='#a56422';c.font='bold 9px monospace';c.fillText(`TARGET ${target.toFixed(2)} Hz`,w-124,Math.max(10,ty-5));if(history.length>1){c.strokeStyle='#2779e6';c.lineWidth=2;c.beginPath();history.forEach((v,i)=>{const x=i/(Math.max(history.length-1,1))*w,y=h-(Math.max(min,Math.min(max,v))-min)/(max-min)*h;i?c.lineTo(x,y):c.moveTo(x,y)});c.stroke();}if(lastDetected>0){c.fillStyle='#1763ca';c.font='bold 9px monospace';c.fillText(`MIC ${lastDetected.toFixed(2)} Hz`,w-104,18);}}
drawMeter();moveNeedle(0);drawGraph(targetFrequency());
