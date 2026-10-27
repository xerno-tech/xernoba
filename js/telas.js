// Midori Xernoba — telas de transmissão: grade, volume, minimizar, painel de conexão, cinema, rabiscos e reações
/* ---- Telas na grade ---- */
function criarTela(id, titulo, local) {
  const t = document.createElement('div');
  t.className = 'tela';
  t.innerHTML = `<video autoplay playsinline ${local ? 'muted' : ''}></video>
    <div class="aviso">Conectando…</div>
    ${local ? '<span class="selo">VOCÊ · AO VIVO</span>' : ''}
    <div class="ctrl"><span class="n"></span>
      ${local ? '<span class="mut" style="font-size:12px">sem som pra você</span>' : '<button data-a="mute" title="Mutar esta transmissão">🔊</button><input type="range" min="0" max="2" step="0.05" value="1" title="Volume (até 200%)"><span class="pct">100%</span>'}
      <button data-a="lapis" title="Rabiscar na tela">✏️</button>
      <button data-a="mini" title="Minimizar">🗕</button>
      <button data-a="info" title="Painel de conexão">ⓘ</button>
      <button data-a="cinema" title="Modo cinema (tela cheia com o chat por cima)">🍿</button>
      <button data-a="chatCinema" title="Mostrar/esconder o chat (C)">💬</button>
      <button data-a="cinemaTodas" title="Cinema com todas as telas / só esta (G)">⊞</button>
      <button data-a="cheia" title="Tela cheia">⛶</button>${local ? '' : '<button data-a="fechar" title="Fechar">✕</button>'}
    </div>`;
  t.querySelector('.n').textContent = titulo;
  t._alvo = local ? null : id;
  t._dono = local ? euId : id;   // de quem é a transmissão (para rabiscos)
  prepararRabisco(t);
  const fal = document.createElement('div'); fal.className = 'falantes'; t.appendChild(fal);
  ultimoFalantes = '';   // força desenhar quem está falando nesta tela nova
  if (!local) {
    const bar = document.createElement('div'); bar.className = 'reacoes';
    for (const e of REACOES) {
      const b = document.createElement('button'); b.textContent = e; b.title = 'Reagir';
      b.onclick = ev => { ev.stopPropagation(); if (hubConn && hubConn.open) hubConn.send({ tipo: 'reacao', alvo: id, emoji: e }); };
      bar.appendChild(b);
    }
    t.appendChild(bar);
  }
  const v = t.querySelector('video');
  const r = t.querySelector('input[type=range]');
  t._chave = titulo;
  if (r) {
    r.value = Math.min(2, Number(ler('vol-' + titulo) || '1'));
    t._mudo = ler('mute-' + titulo) === '1';
    r.oninput = () => { salvar('vol-' + titulo, r.value); if (t._mudo && Number(r.value) > 0) definirMudo(t, false); aplicarSom(t); };
    t.querySelector('[data-a=mute]').onclick = e => { e.stopPropagation(); definirMudo(t, !t._mudo); };
    aplicarSom(t);
  }
  t.querySelector('[data-a=mini]').onclick = e => { e.stopPropagation(); minimizar(t, !t.classList.contains('mini')); };
  t.querySelector('[data-a=cheia]').onclick = () => document.fullscreenElement ? document.exitFullscreen() : t.requestFullscreen();
  t.querySelector('[data-a=info]').onclick = e => { e.stopPropagation(); alternarPainel(t, id, local); };
  t.querySelector('[data-a=cinema]').onclick = e => { e.stopPropagation(); entrarCinema(t); };
  t.querySelector('[data-a=chatCinema]').onclick = e => { e.stopPropagation(); alternarChatCinema(); };
  t.querySelector('[data-a=cinemaTodas]').onclick = e => { e.stopPropagation(); alternarCinemaTodas(t); };
  const f = t.querySelector('[data-a=fechar]'); if (f) f.onclick = () => pararDeAssistir(id);
  v.ondblclick = () => t.querySelector('[data-a=cheia]').click();
  v.onclick = () => { if (t.classList.contains('mini')) minimizar(t, false); else if (layout === 'destaque') focar(t); };
  if (local) $('grade').prepend(t); else $('grade').appendChild(t);
  atualizarVazio(); atualizarFoco();
  return t;
}
// ---- som de cada transmissão: passa por um ganho para poder ir até 200% ----
let ctxTelas = null;
function ligarSom(t, s) {
  if (!s.getAudioTracks().length) return;
  try {
    ctxTelas = ctxTelas || new AudioContext();
    ctxTelas.resume().catch(() => {});
    if (t._fonte) try { t._fonte.disconnect(); } catch (e) {}
    t._fonte = ctxTelas.createMediaStreamSource(s);
    t._ganho = t._ganho || ctxTelas.createGain();
    t._fonte.connect(t._ganho); t._ganho.connect(ctxTelas.destination);
    t.querySelector('video').muted = true;   // o som sai pelo ganho, não pelo vídeo
    aplicarSom(t);
  } catch (e) { t._ganho = null; }
}
function aplicarSom(t) {
  const r = t.querySelector('input[type=range]'); if (!r) return;
  const vol = Number(r.value), v = t.querySelector('video');
  const efetivo = t._mudo ? 0 : vol;
  if (t._ganho) t._ganho.gain.value = efetivo;
  else { v.muted = t._mudo; v.volume = Math.min(1, vol); }
  t.querySelector('.pct').textContent = t._mudo ? 'mudo' : Math.round(vol * 100) + '%';
  r.classList.toggle('alto', vol > 1);
  const b = t.querySelector('[data-a=mute]');
  b.textContent = t._mudo || vol === 0 ? '🔇' : '🔊';
  b.classList.toggle('mudo', !!t._mudo);
  b.title = t._mudo ? 'Desmutar' : 'Mutar esta transmissão';
}
function definirMudo(t, valor, temporario) {
  t._mudo = valor;
  if (!temporario) salvar('mute-' + t._chave, valor ? '1' : '0');
  aplicarSom(t);
}
document.addEventListener('click', () => { if (ctxTelas && ctxTelas.state !== 'running') ctxTelas.resume().catch(() => {}); });

// ---- minimizar ----
let muteMini = ler('muteMini') === '1';
function minimizar(t, sim) {
  const destino = sim ? $('faixaMini') : $('grade');
  t.classList.toggle('mini', sim);
  t.classList.remove('foco');
  t.style.width = t.style.height = '';   // a faixa usa o tamanho dela; o Flex-Grid recalcula ao voltar
  destino.appendChild(t);
  const v = t.querySelector('video'); v.play().catch(() => {});   // mover pausa o vídeo; volta a tocar
  const b = t.querySelector('[data-a=mini]'); b.textContent = sim ? '🗖' : '🗕'; b.title = sim ? 'Voltar ao tamanho normal' : 'Minimizar';
  if (t.querySelector('[data-a=mute]')) {
    if (sim && muteMini && !t._mudo) { t._mutadoPorMini = true; definirMudo(t, true, true); }
    if (!sim && t._mutadoPorMini) { t._mutadoPorMini = false; definirMudo(t, false, true); }
  }
  $('faixaMini').classList.toggle('oculto', !$('faixaMini').children.length);
  if (!sim && layout === 'destaque') focar(t);
  atualizarVazio();
}

function atualizarVazio() {
  $('vazio').classList.toggle('oculto', document.querySelectorAll('#palco .tela').length > 0);
  $('faixaMini').classList.toggle('oculto', !$('faixaMini').children.length);
  atualizarFoco();
  if (typeof arrumarFlex === 'function') requestAnimationFrame(arrumarFlex);
}
function focar(t) { $('grade').querySelectorAll('.tela').forEach(x => x.classList.toggle('foco', x === t)); }
function atualizarFoco() {
  const telas = [...$('grade').querySelectorAll('.tela')];
  if (layout !== 'destaque') { telas.forEach(x => x.classList.remove('foco')); return; }
  if (telas.some(x => x.classList.contains('foco'))) return;
  // prefere a tela de um amigo; se não tiver, a sua
  const alvo = telas.find(x => !x.querySelector('.selo')) || telas[0];
  if (alvo) focar(alvo);
}

function assistir(m) {
  if (assistindo.has(m.id)) return;
  const tela = criarTela(m.id, m.nome, false);
  const conn = peer.connect(m.id, { reliable: true, metadata: { tipo: 'assistir' } });
  const item = { conn, call: null, tela };
  assistindo.set(m.id, item);
  conn.on('close', () => { if (assistindo.get(m.id) === item) pararDeAssistir(m.id); });
  renderLista();
}
function pararDeAssistir(id) {
  const it = assistindo.get(id); if (!it) return;
  assistindo.delete(id);
  try { it.call && it.call.close(); } catch (e) {}
  try { it.conn.close(); } catch (e) {}
  if (it.tela._fonte) try { it.tela._fonte.disconnect(); it.tela._ganho.disconnect(); } catch (e) {}
  if (it.tela._painel) { clearInterval(it.tela._painel.tm); it.tela._painel = null; }
  telaSaiu(it.tela);
  it.tela.remove(); atualizarVazio(); renderLista();
}

/* =================== PAINEL DE CONEXÃO =================== */
function alternarPainel(t, id, local) {
  const b = t.querySelector('[data-a=info]');
  if (t._painel) { clearInterval(t._painel.tm); t._painel.el.remove(); t._painel = null; b.classList.remove('ativo'); return; }
  const el = document.createElement('div'); el.className = 'painelInfo'; el.innerHTML = '<div class="tit"><span class="bola"></span>Medindo…</div>';
  t.appendChild(el); b.classList.add('ativo');
  const ant = {};   // leituras anteriores, para calcular por segundo
  const ler1 = async () => {
    const pcs = local ? [...assistentes.values()].map(a => a.call && a.call.peerConnection).filter(Boolean)
                      : [((assistindo.get(id) || {}).call || {}).peerConnection].filter(Boolean);
    let w = 0, h = 0, fps = 0, bytes = 0, perd = 0, pacotes = 0, rtts = [], via = new Set();
    let captura = 0, limite = new Set(), placa = null, formato = '';
    for (const pc of pcs) {
      let st; try { st = await pc.getStats(); } catch (e) { continue; }
      const cand = {};
      st.forEach(r => { if (r.type === 'local-candidate' || r.type === 'remote-candidate') cand[r.id] = r; });
      st.forEach(r => {
        if (local && r.type === 'media-source' && r.kind === 'video') captura = Math.max(captura, r.framesPerSecond || 0);
        if (r.kind === 'video' && r.type === (local ? 'outbound-rtp' : 'inbound-rtp')) {
          if (r.qualityLimitationReason) limite.add(r.qualityLimitationReason);
          const ef = local ? r.powerEfficientEncoder : r.powerEfficientDecoder;
          if (ef != null) placa = placa || ef;
          const cod = r.codecId && st.get(r.codecId);
          if (cod && cod.mimeType) formato = cod.mimeType.replace(/^video\//, '');
          w = Math.max(w, r.frameWidth || 0); h = Math.max(h, r.frameHeight || 0); fps = Math.max(fps, r.framesPerSecond || 0);
          bytes += local ? (r.bytesSent || 0) : (r.bytesReceived || 0);
          if (!local) { perd += r.packetsLost || 0; pacotes += (r.packetsReceived || 0) + (r.packetsLost || 0); }
        }
        if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') {
          if (r.currentRoundTripTime != null) rtts.push(r.currentRoundTripTime * 1000);
          const lc = cand[r.localCandidateId], rc = cand[r.remoteCandidateId];
          via.add((lc && lc.candidateType === 'relay') || (rc && rc.candidateType === 'relay') ? 'retransmissão' : 'direta');
        }
      });
    }
    const agora = performance.now();
    const mbps = ant.t ? ((bytes - ant.bytes) * 8 / ((agora - ant.t) / 1000)) / 1e6 : 0;
    const perdaPct = ant.t && pacotes - ant.pacotes > 0 ? 100 * (perd - ant.perd) / (pacotes - ant.pacotes) : 0;
    Object.assign(ant, { t: agora, bytes, perd, pacotes });
    const rtt = rtts.length ? Math.round(rtts.reduce((a, b) => a + b) / rtts.length) : null;
    const estado = !pcs.length ? '' : (rtt == null || rtt < 120) && perdaPct < 1 && fps >= 24 ? 'bom' : (rtt != null && rtt > 300) || perdaPct > 5 || (fps && fps < 12) ? 'ruim' : 'medio';
    const lin = (k, v) => `<div class="lin"><span>${k}</span><span>${v}</span></div>`;
    el.innerHTML = `<div class="tit"><span class="bola ${estado}"></span>${local ? (pcs.length ? `Enviando para ${pcs.length}` : 'Ninguém assistindo ainda') : 'Recebendo'}</div>`
      + (pcs.length ? lin('Imagem', w ? `${w}×${h}` : '—') + lin('Quadros', fps ? `${Math.round(fps)} fps` : '—')
        + lin(local ? 'Enviando' : 'Chegando', `${mbps.toFixed(1)} Mbps`) + lin('Atraso', rtt != null ? `${rtt} ms` : '—')
        + (local ? '' : lin('Perda', `${perdaPct.toFixed(1)}%`)) + lin('Conexão', [...via].join(' / ') || '—')
        + (local && captura ? lin('Captura', `${Math.round(captura)} fps`) : '')
        + (local ? lin('Limitado por', limite.has('cpu') ? '<b class="alerta">processador</b>' : limite.has('bandwidth') ? '<b class="alerta">internet</b>' : 'nada') : '')
        + (formato ? lin(local ? 'Compressão' : 'Formato', formato + (placa == null ? '' : placa ? ' · placa de vídeo' : ' · processador')) : '') : '');
  };
  ler1();
  t._painel = { el, tm: setInterval(ler1, 1000) };
}

/* =================== MODO CINEMA =================== */
// tela cheia com o chat de verdade por cima; ao sair, ele volta para a barra lateral.
// Pode ser só uma tela, ou a grade com todas as telas (botão ⊞ ou tecla G).
let telaCinema = null;    // o que está em cinema: uma tela ou a grade inteira
let telaBaseCinema = null;   // a tela de onde o cinema foi aberto (para voltar a "só esta")
let cinemaTodas = ler('cinemaTodas') === '1';
let chatCinemaVisivel = ler('chatCinema') !== '0';
let trocandoCinema = false;   // saindo da tela cheia de propósito para entrar em outra
async function ligarCinema(alvo) {
  if (document.fullscreenElement && document.fullscreenElement !== alvo) {
    trocandoCinema = true;
    try { await sairTelaCheia(); } finally { trocandoCinema = false; }
  }
  try { await alvo.requestFullscreen(); } catch (e) { toast('O navegador não deixou entrar em tela cheia.', 'aviso'); sairCinema(); return false; }
  if (telaCinema && telaCinema !== alvo) telaCinema.classList.remove('cinema', 'semChatCinema');
  telaCinema = alvo; alvo.classList.add('cinema'); alvo.classList.toggle('semChatCinema', !chatCinemaVisivel);
  alvo.appendChild($('chat'));
  const box = $('msgs'); box.scrollTop = box.scrollHeight;
  arrumarFlex();
  return true;
}
async function entrarCinema(t) {
  if (telaCinema) return sairCinema();
  telaBaseCinema = t;
  await ligarCinema(cinemaTodas ? $('grade') : t);
}
function alternarCinemaTodas(t) {
  cinemaTodas = !cinemaTodas; salvar('cinemaTodas', cinemaTodas ? '1' : '0');
  if (!telaCinema) return;
  const base = (t && t.isConnected && t) || (telaBaseCinema && telaBaseCinema.isConnected && telaBaseCinema) || $('grade').querySelector('.tela');
  if (!cinemaTodas && !base) return sairCinema();
  ligarCinema(cinemaTodas ? $('grade') : base);
}
function alternarChatCinema() {
  chatCinemaVisivel = !chatCinemaVisivel; salvar('chatCinema', chatCinemaVisivel ? '1' : '0');
  if (telaCinema) telaCinema.classList.toggle('semChatCinema', !chatCinemaVisivel);
}
function sairCinema() {
  if (!telaCinema) return;
  telaCinema.classList.remove('cinema', 'semChatCinema');
  $('membros').appendChild($('chat'));
  telaCinema = null; telaBaseCinema = null;
  sairTelaCheia();
  const box = $('msgs'); box.scrollTop = box.scrollHeight;
  arrumarFlex();
}
// trocar entre "só esta" e "todas" empilha telas cheias; sair desfaz todas
async function sairTelaCheia() {
  for (let i = 0; i < 10 && document.fullscreenElement; i++) try { await document.exitFullscreen(); } catch (e) { break; }
}
// uma tela saindo: se era ela em cinema, sai; se era a grade e não sobrou nenhuma, sai também
function telaSaiu(t) {
  if (telaCinema === t) return sairCinema();
  if (telaCinema === $('grade')) queueMicrotask(() => { if (!$('grade').querySelector('.tela')) sairCinema(); });
}
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && telaCinema && !trocandoCinema) sairCinema(); });
document.addEventListener('keydown', e => {
  if (!telaCinema || document.activeElement === $('inChat')) return;
  if (e.key === 'Escape') sairCinema();
  else if (e.key === 'c' || e.key === 'C') alternarChatCinema();
  else if (e.key === 'g' || e.key === 'G') alternarCinemaTodas(null);
});

/* =================== RABISCOS =================== */
// As coordenadas vão de 0 a 1 em relação à imagem do vídeo (sem as faixas pretas),
// para o desenho cair no mesmo lugar em telas de tamanhos diferentes.
function areaVideo(t) {
  const v = t.querySelector('video'), r = t.getBoundingClientRect();
  const vw = v.videoWidth || 16, vh = v.videoHeight || 9;
  const esc_ = Math.min(r.width / vw, r.height / vh);
  const w = vw * esc_, h = vh * esc_;
  return { x: r.left + (r.width - w) / 2, y: r.top + (r.height - h) / 2, w, h, r };
}
function prepararRabisco(t) {
  const cv = document.createElement('canvas'); cv.className = 'rabisco';
  t.insertBefore(cv, t.querySelector('.aviso'));
  t._riscos = [];   // { autor, cor, pts: [[x,y]...], ate }
  const b = t.querySelector('[data-a=lapis]');
  b.onclick = e => { e.stopPropagation(); const on = !t.classList.contains('desenhando'); t.classList.toggle('desenhando', on); b.classList.toggle('ativo', on); };
  t._pararDesenho = () => { t.classList.remove('desenhando'); b.classList.remove('ativo'); };
  let desenhando = false, pend = [], novo = false, tm = null;
  const enviar = () => {
    if (!pend.length || !hubConn || !hubConn.open) { pend = []; return; }
    hubConn.send({ tipo: 'risco', alvo: t._dono, pts: pend, novo }); pend = []; novo = false;
  };
  const ponto = e => { const a = areaVideo(t); return [+(((e.clientX - a.x) / a.w).toFixed(4)), +(((e.clientY - a.y) / a.h).toFixed(4))]; };
  cv.addEventListener('pointerdown', e => { e.stopPropagation(); desenhando = true; novo = true; cv.setPointerCapture(e.pointerId); pend.push(ponto(e)); enviar(); tm = setInterval(enviar, 40); });
  cv.addEventListener('pointermove', e => { if (desenhando) pend.push(ponto(e)); });
  const fim = () => { if (!desenhando) return; desenhando = false; clearInterval(tm); enviar(); };
  cv.addEventListener('pointerup', fim); cv.addEventListener('pointercancel', fim);
  cv.addEventListener('click', e => e.stopPropagation());
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelectorAll('.tela.desenhando').forEach(t => t._pararDesenho && t._pararDesenho()); });
function telaDe(dono) { return dono === euId ? telaLocal : (assistindo.get(dono) || {}).tela; }
function receberRisco(d) {
  const t = telaDe(d.alvo); if (!t || !t._riscos) return;
  let r = t._riscos.findLast ? t._riscos.findLast(x => x.autor === d.autor) : [...t._riscos].reverse().find(x => x.autor === d.autor);
  if (d.novo || !r) { r = { autor: d.autor, cor: d.cor, pts: [] }; t._riscos.push(r); if (t._riscos.length > 80) t._riscos.shift(); }
  r.pts.push(...d.pts); r.ate = Date.now() + 3500;
  desenharRiscos();
}
let animando = false;
function desenharRiscos() {
  if (animando) return; animando = true;
  const passo = () => {
    let algum = false;
    document.querySelectorAll('.tela').forEach(t => {
      const cv = t.querySelector('.rabisco'); if (!cv || !t._riscos) return;
      const r = t.getBoundingClientRect(), dpr = devicePixelRatio || 1;
      if (cv.width !== Math.round(r.width * dpr) || cv.height !== Math.round(r.height * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); }
      const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, r.width, r.height);
      const a = areaVideo(t), ox = a.x - a.r.left, oy = a.y - a.r.top, agora = Date.now();
      t._riscos = t._riscos.filter(x => x.ate > agora);
      for (const x of t._riscos) {
        algum = true;
        g.globalAlpha = Math.min(1, (x.ate - agora) / 1000);
        g.strokeStyle = x.cor; g.lineWidth = Math.max(3, a.w / 260); g.lineCap = g.lineJoin = 'round';
        g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 3;
        g.beginPath();
        x.pts.forEach(([px, py], i) => { const X = ox + px * a.w, Y = oy + py * a.h; i ? g.lineTo(X, Y) : g.moveTo(X, Y); });
        if (x.pts.length === 1) g.lineTo(ox + x.pts[0][0] * a.w + 0.1, oy + x.pts[0][1] * a.h);
        g.stroke();
      }
    });
    if (algum) requestAnimationFrame(passo); else animando = false;
  };
  requestAnimationFrame(passo);
}

// 12 min, 1h05…
function duracao(ms) {
  const min = Math.floor(Math.max(0, ms) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return min + ' min';
  return Math.floor(min / 60) + 'h' + String(min % 60).padStart(2, '0');
}

/* =================== REAÇÕES =================== */
function mostrarReacao(d) {
  const tela = d.alvo === euId ? telaLocal : (assistindo.get(d.alvo) || {}).tela;
  if (!tela || !REACOES.includes(d.emoji)) return;
  if (tela.querySelectorAll('.flutua').length > 25) return;
  const f = document.createElement('div'); f.className = 'flutua';
  const b = document.createElement('b'); b.textContent = d.emoji;
  const n = document.createElement('span'); n.textContent = d.nome || '';
  f.append(b, n);
  f.style.left = (10 + Math.random() * 75) + '%';
  tela.appendChild(f);
  setTimeout(() => f.remove(), 2500);
}
