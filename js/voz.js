// Midori Xernoba — voz: entrar na voz, microfone, volume de cada pessoa e quem está falando
/* =================== VOZ =================== */
// As vozes tocam nesta mesma página. Assim, ao transmitir a tela inteira,
// o Chrome tira esse som da transmissão e ninguém se ouve de volta.
let emVoz = false, mudo = ler('mudo') === '1', mic = null, ctxVoz = null, micId = ler('micId');
let semFiltro = ler('semFiltro') === '1';
const vozes = new Map();   // id -> { call, audio, para }
const falandoDesde = new Map();   // quem falou há pouco (segura 0,6 s para não piscar)
let ultimoFalantes = '';
function atualizarFalantes() {
  const ids = [...falandoDesde.keys()].filter(id => emVoz);
  const chave = ids.join(',');
  if (chave === ultimoFalantes) return;
  ultimoFalantes = chave;
  const html = ids.map(id => {
    const m = membros.find(x => x.id === id) || { id, nome: id === euId ? nome : '?' };
    return `<div class="falante">${avatarHTML(m)}<span>${esc(m.nome)}</span></div>`;
  }).join('');
  document.querySelectorAll('.tela .falantes').forEach(f => f.innerHTML = html);
}
function medirFala(stream, id) {
  if (!ctxVoz) return () => {};
  const fonte = ctxVoz.createMediaStreamSource(stream);
  const an = ctxVoz.createAnalyser(); an.fftSize = 512; fonte.connect(an);
  const buf = new Uint8Array(an.fftSize);
  const tm = setInterval(() => {
    an.getByteTimeDomainData(buf);
    let pico = 0; for (const x of buf) pico = Math.max(pico, Math.abs(x - 128));
    const fala = pico > 10 && !(id === euId && mudo);
    document.querySelectorAll(`#lista [data-av="${CSS.escape(id)}"]`).forEach(a => a.classList.toggle('falando', fala));
    if (fala) falandoDesde.set(id, Date.now()); else if (falandoDesde.has(id) && Date.now() - falandoDesde.get(id) > 600) falandoDesde.delete(id);
    atualizarFalantes();
  }, 150);
  return () => { clearInterval(tm); try { fonte.disconnect(); } catch (e) {} };
}
function ligarVoz(id, call) {
  const antiga = vozes.get(id);
  if (antiga && antiga.call !== call) fecharVoz(id);
  const item = { call, audio: null, para: null };
  vozes.set(id, item);
  call.on('stream', s => {
    if (item.audio) return;
    // a voz passa por um ganho para poder ir até 200%; o elemento de áudio fica mudo
    // (o Chrome precisa dele ligado para o som da chamada fluir)
    const a = new Audio(); a.autoplay = true; a.srcObject = s; a.muted = true;
    a.play().catch(() => {});
    const m = membros.find(x => x.id === id);
    const vol = Number(ler('volVoz-' + (m ? m.nome : '')) || 1);
    try {
      const g = ctxVoz.createGain(); g.gain.value = vol;
      item.fonteVoz = ctxVoz.createMediaStreamSource(s); item.fonteVoz.connect(g); g.connect(ctxVoz.destination);
      item.ganho = g;
    } catch (e) { a.muted = false; a.volume = Math.min(1, vol); }
    item.audio = a; item.para = medirFala(s, id);
  });
  const fim = () => { if (vozes.get(id) === item) fecharVoz(id); };
  call.on('close', fim); call.on('error', fim);
}
function fecharVoz(id) {
  const v = vozes.get(id); if (!v) return;
  vozes.delete(id);
  try { v.call.close(); } catch (e) {}
  if (v.audio) { v.audio.srcObject = null; }
  try { v.fonteVoz && v.fonteVoz.disconnect(); v.ganho && v.ganho.disconnect(); } catch (e) {}
  if (v.para) v.para();
  document.querySelectorAll(`[data-av="${CSS.escape(id)}"]`).forEach(a => a.classList.remove('falando'));
  falandoDesde.delete(id); atualizarFalantes();
}
function sincronizarVoz() {
  if (!emVoz || !mic) return;
  const naVoz = new Set(membros.filter(m => m.voz && m.id !== euId).map(m => m.id));
  for (const id of [...vozes.keys()]) if (!naVoz.has(id)) fecharVoz(id);
  // só um dos dois liga, para não abrir duas conexões
  for (const id of naVoz) if (!vozes.has(id) && euId < id) {
    ligarVoz(id, peer.call(id, mic, { metadata: { tipo: 'voz' } }));
  }
}
function atualizarBotoesVoz() {
  $('btnVoz').classList.toggle('oculto', emVoz);
  $('btnMic').classList.toggle('oculto', !emVoz);
  $('btnSairVoz').classList.toggle('oculto', !emVoz);
  $('btnMicCfg').classList.toggle('oculto', !emVoz);
  if (!emVoz) $('popMic').classList.add('oculto');
  $('btnMic').textContent = mudo ? '🔇 Mudo' : '🎙️ Microfone';
  $('btnMic').classList.toggle('mudo', mudo);
}
let pararMinhaFala = null;
// exige o microfone escolhido: se ele não abrir, dá erro em vez de pegar outro escondido
const pedirMic = id => navigator.mediaDevices.getUserMedia({ audio: {
  deviceId: id ? { exact: id } : undefined,
  echoCancellation: !semFiltro, noiseSuppression: !semFiltro, autoGainControl: !semFiltro } });
const ERROS_MIC = {
  NotReadableError: 'o Windows ou outro programa está segurando esse microfone',
  OverconstrainedError: 'esse microfone não foi encontrado (desconectado?)',
  NotAllowedError: 'o navegador não tem permissão para o microfone',
  NotFoundError: 'nenhum microfone encontrado'
};
const erroMic = e => ERROS_MIC[e.name] || e.message;
function mostrarEmUso() {
  const t = mic && mic.getAudioTracks()[0];
  $('micEmUso').textContent = t ? (t.label || 'sem nome') + (t.muted ? ' (sem sinal)' : '') : '—';
}

// lista de microfones
async function listarMics() {
  const sel = $('selMic');
  const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');
  const atual = mic && mic.getAudioTracks()[0] ? mic.getAudioTracks()[0].getSettings().deviceId : micId;
  sel.innerHTML = '';
  devs.forEach((d, i) => {
    const o = document.createElement('option');
    o.value = d.deviceId;
    o.textContent = d.deviceId === 'default' ? 'Padrão do Windows' + (d.label ? ' · ' + d.label.replace(/^(Default|Padrão)\s*-\s*/i, '') : '')
                  : d.deviceId === 'communications' ? 'Comunicação do Windows' + (d.label ? ' · ' + d.label.replace(/^(Communications|Comunicações)\s*-\s*/i, '') : '')
                  : (d.label || `Microfone ${i + 1}`);
    sel.appendChild(o);
  });
  if (atual && [...sel.options].some(o => o.value === atual)) sel.value = atual;
}
// barrinha de nível no painel
let tNivel = null, anNivel = null, fonteNivel = null;
function medirNivel() {
  clearInterval(tNivel); try { fonteNivel && fonteNivel.disconnect(); } catch (e) {}
  if (!mic || !ctxVoz) return;
  fonteNivel = ctxVoz.createMediaStreamSource(mic);
  anNivel = ctxVoz.createAnalyser(); anNivel.fftSize = 512; fonteNivel.connect(anNivel);
  const buf = new Uint8Array(512);
  tNivel = setInterval(() => {
    if ($('popMic').classList.contains('oculto')) return;
    anNivel.getByteTimeDomainData(buf);
    let pico = 0; for (const x of buf) pico = Math.max(pico, Math.abs(x - 128));
    $('nivelMic').firstElementChild.style.width = Math.min(100, pico * 1.6) + '%';
  }, 80);
}
async function trocarMic(id) {
  let novo;
  try { novo = await pedirMic(id); }
  catch (e) {
    toast('Não deu para abrir esse microfone: ' + esc(erroMic(e)) + '. Continua o anterior.', 'erro', 9000);
    await listarMics(); return;
  }
  const faixa = novo.getAudioTracks()[0];
  faixa.enabled = !mudo;
  for (const v of vozes.values()) {
    const pc = v.call && v.call.peerConnection; if (!pc) continue;
    for (const snd of pc.getSenders()) if (snd.track && snd.track.kind === 'audio') try { await snd.replaceTrack(faixa); } catch (e) {}
  }
  if (mic) mic.getTracks().forEach(t => t.stop());
  mic = novo;
  micId = id; salvar('micId', id);
  if (pararMinhaFala) pararMinhaFala();
  pararMinhaFala = medirFala(mic, euId);
  medirNivel(); mostrarEmUso();
  faixa.onmute = faixa.onunmute = mostrarEmUso;
  toast('🎙️ Microfone trocado: ' + esc($('selMic').selectedOptions[0] ? $('selMic').selectedOptions[0].textContent : ''));
}
$('selMic').onchange = () => trocarMic($('selMic').value);
$('btnMicCfg').onclick = async () => {
  const pop = $('popMic');
  const abrir = pop.classList.contains('oculto');
  pop.classList.toggle('oculto', !abrir);
  if (abrir) { if (ctxVoz) ctxVoz.resume().catch(() => {}); await listarMics(); mostrarEmUso(); }
};
$('chkSemFiltro').checked = semFiltro;
$('chkSemFiltro').onchange = () => {
  semFiltro = $('chkSemFiltro').checked; salvar('semFiltro', semFiltro ? '1' : '0');
  if (mic) trocarMic($('selMic').value || micId);
};
$('btnMicOk').onclick = () => $('popMic').classList.add('oculto');
document.addEventListener('click', e => { if (!$('vozBox').contains(e.target)) $('popMic').classList.add('oculto'); });
navigator.mediaDevices.addEventListener('devicechange', () => { if (!$('popMic').classList.contains('oculto')) listarMics(); });

async function entrarVoz() {
  const primeiraVez = !micId;
  try {
    mic = await pedirMic(micId);
  } catch (e) {
    // o microfone salvo não abriu: tenta o padrão e avisa
    try { mic = await pedirMic(null); toast('O microfone salvo não abriu (' + esc(erroMic(e)) + '). Entrei com o padrão; troque no ⚙️.', 'aviso', 9000); }
    catch (e2) { toast('Não deu para usar o microfone: ' + esc(erroMic(e2)) + '. Confira o cadeado ao lado do endereço.', 'erro', 9000); return; }
  }
  mic.getAudioTracks()[0].onmute = mic.getAudioTracks()[0].onunmute = mostrarEmUso;
  ctxVoz = ctxVoz || new AudioContext();
  ctxVoz.resume().catch(() => {});
  mic.getAudioTracks().forEach(t => t.enabled = !mudo);
  pararMinhaFala = medirFala(mic, euId);
  emVoz = true;
  atualizarBotoesVoz(); enviarEstado(); renderLista();
  medirNivel(); mostrarEmUso();
  if (primeiraVez) {
    micId = mic.getAudioTracks()[0].getSettings().deviceId || 'default'; salvar('micId', micId);
    await listarMics(); $('popMic').classList.remove('oculto');
  }
  toast('🎙️ Você entrou na voz. Se alguém transmitir a tela inteira, as vozes daqui não vão junto.');
}
function sairVoz() {
  emVoz = false;
  for (const id of [...vozes.keys()]) fecharVoz(id);
  if (mic) mic.getTracks().forEach(t => t.stop());
  mic = null;
  if (pararMinhaFala) { pararMinhaFala(); pararMinhaFala = null; }
  clearInterval(tNivel);
  atualizarBotoesVoz(); enviarEstado(); renderLista();
}
$('btnVoz').onclick = entrarVoz;
$('btnSairVoz').onclick = sairVoz;
$('btnMic').onclick = () => {
  if (silenciadoAdmin && mudo) { toast('🔇 Um admin silenciou você. Espere ele liberar.', 'aviso'); return; }
  mudo = !mudo; salvar('mudo', mudo ? '1' : '0');
  if (mic) mic.getAudioTracks().forEach(t => t.enabled = !mudo);
  atualizarBotoesVoz(); enviarEstado(); renderLista();
};
atualizarBotoesVoz();
