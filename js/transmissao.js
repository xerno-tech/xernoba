// Midori Xernoba — transmitir: escolher a fonte, capturar, qualidade e enviar para quem assiste
/* =================== TRANSMITIR =================== */
const selVideo = $('selVideo'), selAudio = $('selAudio');
let fonte = null, qual = ler('qual') || '6000';
let telaLocal = null, extras = [];
const pararExtras = () => { extras.forEach(t => t.stop()); extras = []; };

// --- dispositivos (para o modo Console) ---
async function listar() {
  const devs = await navigator.mediaDevices.enumerateDevices();
  const preencher = (sel, tipo, chave, primeiro) => {
    const atual = sel.value || ler(chave);
    sel.innerHTML = '';
    if (primeiro) { const o = document.createElement('option'); o.value = 'nenhum'; o.textContent = primeiro; sel.appendChild(o); }
    devs.filter(d => d.kind === tipo).forEach((d, i) => {
      const o = document.createElement('option'); o.value = d.deviceId; o.textContent = d.label || `Dispositivo ${i + 1}`; sel.appendChild(o);
    });
    if (atual && [...sel.options].some(o => o.value === atual)) sel.value = atual;
    return !!atual && sel.value === atual;
  };
  preencher(selVideo, 'videoinput', 'video');
  const tinhaSom = preencher(selAudio, 'audioinput', 'audio', 'Sem som');
  if (!tinhaSom) sugerirSom();
}
// escolhe o som que parece ser da mesma placa do vídeo (ex.: "USB2 Video" → "USB2 Digital Audio")
function sugerirSom() {
  const nomeV = (selVideo.selectedOptions[0] || {}).textContent || '';
  const idHw = (nomeV.match(/\(([0-9a-f]{4}:[0-9a-f]{4})\)/i) || [])[1];
  const palavra = (nomeV.match(/[A-Za-z0-9]{3,}/) || [])[0];
  const achado = [...selAudio.options].find(o => (idHw && o.textContent.includes(idHw)) || (palavra && o.textContent.includes(palavra)));
  if (achado) selAudio.value = achado.value;
}
selVideo.onchange = () => { sugerirSom(); };

// --- janela de transmitir ---
const modal = $('modal');
const TITULOS = { console: '🎮 Console', janela: '🕹️ Jogo do PC', tela: '🖥️ Tela inteira' };
const DICAS_QUAL = { 3000: '3 Mbps por pessoa assistindo. Para internet fraca ou muita gente vendo.', 6000: '6 Mbps por pessoa. Recomendado para a maioria.',
                     10000: '10 Mbps por pessoa. Precisa de internet boa.', 20000: '20 Mbps por pessoa. Só com internet muito boa e poucos assistindo.' };
const DICAS_PRIO = { fluidez: 'Mantém os quadros por segundo e baixa a nitidez. Melhor para jogos rápidos.',
                     nitidez: 'Mantém a imagem nítida e baixa os quadros. Melhor para texto, menus e jogos parados.' };
const RES = { 720: [1280, 720], 1080: [1920, 1080], 1440: [2560, 1440], 2160: [3840, 2160] };
let resol = ler('resol') || '1080', fps = ler('fps') || '60', prio = ler('prio') || 'fluidez';
const restricoesVideo = () => { const [w, h] = RES[resol]; return { width: { ideal: w, max: w }, height: { ideal: h, max: h }, frameRate: { ideal: Number(fps), max: Number(fps) } }; };
async function aplicarVideoAoVivo() {
  const vt = stream && stream.getVideoTracks()[0]; if (!vt) return;
  try { await vt.applyConstraints(restricoesVideo()); } catch (e) {}
  for (const a of assistentes.values()) aplicarBitrate(a.call);
  mostrarSaida();
}
function mostrarSaida() {
  const vt = stream && stream.getVideoTracks()[0]; if (!vt) return;
  const st = vt.getSettings();
  if (st.width) toast(`Enviando ${st.width}×${st.height} a ${Math.round(st.frameRate || 0)} fps.`, '', 4000);
}
seg('segRes', 'r', resol, v => { resol = v; salvar('resol', v); if (aoVivo) aplicarVideoAoVivo(); });
seg('segFps', 'f', fps, v => { fps = v; salvar('fps', v); if (aoVivo) aplicarVideoAoVivo(); });
seg('segPrio', 'p', prio, v => { prio = v; salvar('prio', v); $('dicaPrio').textContent = DICAS_PRIO[prio]; if (aoVivo) for (const a of assistentes.values()) aplicarBitrate(a.call); });
$('dicaPrio').textContent = DICAS_PRIO[prio];
function mostrarPasso(id) { for (const p of ['pFonte', 'pConfig']) $(p).classList.toggle('oculto', p !== id); modal.classList.remove('oculto'); }
function fecharModal() { modal.classList.add('oculto'); }
function abrirModal() { mostrarPasso('pFonte'); }
function atualizarQual() {
  document.querySelectorAll('#segQual button').forEach(b => b.classList.toggle('sel', b.dataset.q === qual));
  $('dicaQual').textContent = DICAS_QUAL[qual];
}
document.querySelectorAll('#segQual button').forEach(b => b.onclick = () => {
  qual = b.dataset.q; salvar('qual', qual); atualizarQual();
  if (aoVivo) for (const a of assistentes.values()) aplicarBitrate(a.call);
});
atualizarQual();

document.querySelectorAll('.opcao').forEach(b => b.onclick = async () => {
  fonte = b.dataset.fonte;
  $('tituloConfig').textContent = TITULOS[fonte];
  $('cfgConsole').classList.toggle('oculto', fonte !== 'console');
  $('cfgJanela').classList.toggle('oculto', fonte !== 'janela');
  $('cfgTela').classList.toggle('oculto', fonte !== 'tela');
  $('notaJogo').classList.toggle('oculto', fonte === 'console');
  mostrarPasso('pConfig');
  if (fonte === 'console' && (!selVideo.options.length || /^Dispositivo \d/.test(selVideo.options[0].textContent))) {
    try { const t = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }); t.getTracks().forEach(x => x.stop()); }
    catch (e) { toast('Sem permissão para a câmera/placa. Libere no ícone do cadeado ao lado do endereço.', 'erro'); }
    await listar();
  }
});
$('btnVoltar').onclick = () => mostrarPasso('pFonte');
document.querySelectorAll('[data-fechar]').forEach(b => b.onclick = fecharModal);
modal.onclick = e => { if (e.target === modal) fecharModal(); };
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.classList.contains('oculto')) fecharModal(); });

$('btnComecar').onclick = () => { fecharModal(); iniciarTransmissao(); };

// --- captura ---
const SEM_PROC = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
async function capturar() {
  if (fonte === 'console') {
    const comSom = selAudio.value && selAudio.value !== 'nenhum';
    const s = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: selVideo.value ? { exact: selVideo.value } : undefined, ...restricoesVideo() },
      audio: comSom ? { deviceId: { exact: selAudio.value }, ...SEM_PROC, channelCount: { ideal: 2 }, sampleRate: { ideal: 48000 } } : false
    });
    salvar('video', selVideo.value); salvar('audio', selAudio.value);
    return { s, faltaSom: false };
  }
  const VIDEO = restricoesVideo();
  if (fonte === 'janela') {
    const s = await navigator.mediaDevices.getDisplayMedia({
      video: VIDEO, audio: { ...SEM_PROC, restrictOwnAudio: true },
      systemAudio: 'exclude', windowAudio: 'window', monitorTypeSurfaces: 'exclude',
      selfBrowserSurface: 'exclude', surfaceSwitching: 'include'
    });
    // garantia: som do PC inteiro nunca vai
    if (s.getVideoTracks()[0].getSettings().displaySurface === 'monitor') s.getAudioTracks().forEach(t => { t.stop(); s.removeTrack(t); });
    return { s, faltaSom: !s.getAudioTracks().length };
  }
  // tela inteira: som do sistema, mas com o Chrome isolando o próprio áudio (as conversas ficam de fora)
  const s = await navigator.mediaDevices.getDisplayMedia({
    video: { ...VIDEO, displaySurface: 'monitor' },
    audio: { ...SEM_PROC, suppressLocalAudioPlayback: false, restrictOwnAudio: true },
    systemAudio: 'include', windowAudio: 'window', monitorTypeSurfaces: 'include',
    selfBrowserSurface: 'exclude', surfaceSwitching: 'include'
  });
  // só fica com o som se o Chrome confirmar que o isolamento está ligado
  let isolado = s.getAudioTracks().length > 0;
  for (const t of s.getAudioTracks()) {
    const ok = () => { try { return t.getSettings().restrictOwnAudio === true; } catch (e) { return false; } };
    if (!ok()) try { await t.applyConstraints({ restrictOwnAudio: { exact: true } }); } catch (e) {}
    if (!ok()) isolado = false;
  }
  if (s.getAudioTracks().length && !isolado) {
    s.getAudioTracks().forEach(t => { t.stop(); s.removeTrack(t); });
    toast('Seu Chrome não conseguiu isolar o som do sistema, então ele ficou de fora. Atualize o Chrome ou use <b>Adicionar som</b>.', 'aviso', 9000);
  }
  return { s, faltaSom: !s.getAudioTracks().length };
}

async function aplicarBitrate(call) {
  const pc = call && call.peerConnection; if (!pc) return;
  for (const snd of pc.getSenders()) {
    if (!snd.track || snd.track.kind !== 'video') continue;
    const p = snd.getParameters();
    if (!p.encodings || !p.encodings.length) p.encodings = [{}];
    p.encodings[0].maxBitrate = Number(qual) * 1000;
    p.degradationPreference = prio === 'nitidez' ? 'maintain-resolution' : 'maintain-framerate';
    try { await snd.setParameters(p); } catch (e) {}
  }
}
function enviarPara(id) {
  const a = assistentes.get(id); if (!a || !stream) return;
  if (a.call) try { a.call.close(); } catch (e) {}
  const call = peer.call(id, stream, { sdpTransform: sdpTransmissao, metadata: { tipo: 'video' } });
  a.call = call;
  const pc = call.peerConnection;
  if (pc) pc.addEventListener('connectionstatechange', () => { if (pc.connectionState === 'connected') aplicarBitrate(call); });
}
function atualizarAoVivo() {
  $('aoVivoBox').classList.toggle('oculto', !aoVivo);
  $('btnTransmitir').classList.toggle('oculto', aoVivo);
  const n = assistentes.size;
  $('pilula').textContent = `AO VIVO · ${duracao(Date.now() - inicioLive)} · ${n} assistindo`;
  atualizarSom();
  atualizarEspectadores();
}
setInterval(() => { if (aoVivo) atualizarAoVivo(); }, 30000);
// quem está assistindo a sua tela: fotos em cima da sua tela e nomes ao passar o mouse na pílula
function atualizarEspectadores() {
  const quem = [...assistentes.keys()].map(id => membros.find(m => m.id === id)).filter(Boolean);
  const nomes = quem.map(m => m.nome).join(', ');
  $('pilula').title = quem.length ? 'Assistindo: ' + nomes : 'Ninguém assistindo ainda';
  if (!telaLocal) return;
  let box = telaLocal.querySelector('.espectadores');
  if (!quem.length) { if (box) box.remove(); return; }
  if (!box) { box = document.createElement('div'); box.className = 'espectadores'; telaLocal.appendChild(box); }
  box.title = 'Assistindo: ' + nomes;
  box.innerHTML = '👀 ' + quem.slice(0, 5).map(m => avatarHTML(m)).join('') + `<span>${quem.length}</span>`;
}
$('pilula').onclick = () => {
  const quem = [...assistentes.keys()].map(id => membros.find(m => m.id === id)).filter(Boolean);
  toast(quem.length ? '👀 Assistindo você: <b>' + quem.map(m => esc(m.nome)).join(', ') + '</b>' : 'Ninguém está assistindo ainda.', '', 5000);
};
// miniatura da sua tela para a lista dos outros (a cada 30 s)
function enviarMiniatura() {
  if (!aoVivo || !telaLocal || !hubConn || !hubConn.open) return;
  const v = telaLocal.querySelector('video'); if (!v.videoWidth) return;
  const cv = document.createElement('canvas'); cv.width = 240; cv.height = 135;
  const g = cv.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, 240, 135);
  const k = Math.min(240 / v.videoWidth, 135 / v.videoHeight), w = v.videoWidth * k, h = v.videoHeight * k;
  g.drawImage(v, (240 - w) / 2, (135 - h) / 2, w, h);
  const img = cv.toDataURL('image/jpeg', 0.6);
  if (img.length < 40000) hubConn.send({ tipo: 'thumb', img });
}
setInterval(enviarMiniatura, 30000);

/* ---- Som: um botão só, em qualquer modo ---- */
let semSomOk = false;   // a pessoa escolheu ficar sem som
const temSom = () => !!stream && stream.getAudioTracks().some(t => t.readyState === 'live');
function atualizarSom() {
  const ok = temSom();
  const b = $('btnSom');
  b.textContent = ok ? (fonte === 'tela' ? '🔊 Som do PC' : '🔊 Som do jogo') : '🔇 Adicionar som';
  b.classList.toggle('semSom', !ok);
  $('faixaSom').classList.toggle('oculto', !aoVivo || ok || semSomOk);
}
async function adicionarSom() {
  if (!stream) return;
  try {
    const so = await navigator.mediaDevices.getDisplayMedia({
      video: true, audio: { ...SEM_PROC, restrictOwnAudio: true },
      systemAudio: 'exclude', windowAudio: 'window', monitorTypeSurfaces: 'exclude', selfBrowserSurface: 'exclude'
    });
    const at = so.getAudioTracks()[0];
    if (at) pararExtras();   // larga a janela de som anterior, se houver
    // a imagem desta janela não é usada; fica desligada (parar poderia encerrar o som)
    so.getVideoTracks().forEach(t => { t.enabled = false; if (at) extras.push(t); });
    if (!at) { so.getVideoTracks().forEach(t => t.stop()); toast('Não veio som: a opção <b>"Partilhar também o áudio da app"</b> ficou desligada. Clique em <b>Adicionar som</b> de novo.', 'aviso', 8000); return; }
    at.contentHint = 'music';
    at.onended = atualizarSom;   // se parar de compartilhar a janela, a faixa volta
    stream.getAudioTracks().forEach(t => { t.stop(); stream.removeTrack(t); });
    stream.addTrack(at);
    semSomOk = false;
    for (const id of assistentes.keys()) enviarPara(id);
    atualizarSom();
    toast('🔊 Som adicionado: vai só o som do jogo.');
  } catch (e) {
    if (e.name !== 'NotAllowedError') toast('Não deu para pegar o som: ' + esc(e.message), 'erro');
  }
}
$('btnSom').onclick = () => {
  if (fonte === 'console') document.querySelector('.opcao[data-fonte=console]').click();   // trocar o som da placa
  else adicionarSom();
};
$('btnFaixaSom').onclick = adicionarSom;
$('btnFaixaFechar').onclick = () => { semSomOk = true; atualizarSom(); };

async function iniciarTransmissao() {
  try {
    const { s, faltaSom } = await capturar();
    const vt = s.getVideoTracks()[0];
    if (vt) { vt.contentHint = 'motion'; vt.onended = () => pararTransmissao(); }
    s.getAudioTracks().forEach(t => { t.contentHint = 'music'; t.onended = atualizarSom; });
    if (stream) { stream.getVideoTracks().forEach(t => t.onended = null); stream.getTracks().forEach(t => { t.onended = null; t.stop(); }); }
    pararExtras();
    if (!aoVivo) inicioLive = Date.now();
    stream = s; aoVivo = true;
    semSomOk = fonte === 'console' && selAudio.value === 'nenhum';
    if (!telaLocal) telaLocal = criarTela('eu', nome, true);
    telaLocal.querySelector('video').srcObject = stream;
    telaLocal.querySelector('.aviso').classList.add('oculto');
    for (const id of assistentes.keys()) enviarPara(id);
    atualizarAoVivo();
    enviarEstado();
    if (!faltaSom) toast('Você está <b>ao vivo</b>. Seus amigos já podem clicar em Assistir.');
    setTimeout(enviarMiniatura, 2500);
    setTimeout(mostrarSaida, 1200);
  } catch (e) {
    if (e.name === 'NotAllowedError') return;   // cancelou a escolha
    toast('Não deu para começar: ' + esc(e.message) + (fonte === 'console' ? '<br>Feche OBS, VLC ou outra guia que esteja usando a placa.' : ''), 'erro', 9000);
  }
}
function pararTransmissao() {
  if (stream) { stream.getVideoTracks().forEach(t => t.onended = null); stream.getTracks().forEach(t => { t.onended = null; t.stop(); }); }
  pararExtras();
  stream = null; aoVivo = false;
  for (const a of assistentes.values()) if (a.call) try { a.call.close(); } catch (e) {}
  if (telaLocal) {
    if (telaCinema === telaLocal) sairCinema();
    if (telaLocal._painel) { clearInterval(telaLocal._painel.tm); telaLocal._painel = null; }
    telaLocal.remove(); telaLocal = null; atualizarVazio();
  }
  atualizarAoVivo();
  enviarEstado();
}

$('btnTransmitir').onclick = abrirModal;
$('btnTrocar').onclick = abrirModal;
$('btnParar').onclick = pararTransmissao;
navigator.mediaDevices.addEventListener('devicechange', listar);
$('btnLink').onclick = async () => {
  const url = location.origin + location.pathname + '?sala=' + sala;
  try { await navigator.clipboard.writeText(url); toast('Link da sala copiado. É só mandar para a galera.'); }
  catch (e) { prompt('Link da sala:', url); }
};
listar();
