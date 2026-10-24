// Midori Xernoba — chat: mensagens, imagens, links e prévias, menções, respostas, reações, "digitando" e leitura em voz alta
/* =================== CHAT =================== */
const vistas = new Set(); let naoLidas = 0;
const hora = ts => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
// ---- prévia de links (busca pelo servidor de login, com cache aqui também) ----
const previas = new Map();
function pedirPrevia(url) {
  if (!LOGIN_URL || !tokenLogin) return Promise.resolve(null);
  if (!previas.has(url)) previas.set(url, fetch(LOGIN_URL + '/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: tokenLogin, url }) })
    .then(r => r.json()).then(p => p && p.ok ? p : null).catch(() => null));
  return previas.get(url);
}
function cartaoPrevia(p) {
  const a = document.createElement('a'); a.className = 'previa'; a.target = '_blank'; a.rel = 'noopener noreferrer';
  try { const u = new URL(p.url); if (/^https?:$/.test(u.protocol)) a.href = u.href; } catch (e) {}
  if (/^#[0-9a-f]{3,8}$/i.test(p.cor || '')) a.style.borderLeftColor = p.cor;
  const tx = document.createElement('div'); tx.className = 'tx';
  const site = document.createElement('span'); site.className = 'site'; site.textContent = p.site || '';
  const tit = document.createElement('span'); tit.className = 'tit'; tit.textContent = p.titulo || '';
  tx.append(site, tit);
  if (p.descricao) { const d = document.createElement('span'); d.className = 'desc'; d.textContent = p.descricao; tx.append(d); }
  a.append(tx);
  if (/^https:\/\//.test(p.imagem || '')) {
    const im = document.createElement('img'); im.src = p.imagem; im.alt = ''; im.loading = 'lazy'; im.referrerPolicy = 'no-referrer';
    im.onerror = () => im.remove();
    // vídeos (YouTube, Twitch…) ganham a imagem grande embaixo, como no Discord
    if (/youtube\.com|youtu\.be|twitch\.tv|vimeo\.com/i.test(p.url)) { a.classList.add('grande'); a.append(im); } else a.append(im);
  }
  return a;
}
// texto com links clicáveis e @menções (montado elemento por elemento, nunca como HTML)
function preencherComLinks(el, texto) {
  const re = /\bhttps?:\/\/[^\s<>"']+/gi;
  let ult = 0, m;
  while ((m = re.exec(texto))) {
    let url = m[0].replace(/[.,!?;:)\]]+$/, '');   // tira pontuação grudada no fim
    if (m.index > ult) marcarMencoes(el, texto.slice(ult, m.index));
    const a = document.createElement('a');
    a.href = url; a.textContent = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    el.append(a);
    ult = m.index + url.length; re.lastIndex = ult;
  }
  if (ult < texto.length) marcarMencoes(el, texto.slice(ult));
}
// ---- menções ----
const nomesSala = () => [...new Set([nome, ...membros.map(m => m.nome)])].sort((a, b) => b.length - a.length);
const mencionaMe = m => {
  if (!m.nome || m.id === euId) return false;
  const t = ' ' + (m.texto || '').toLowerCase() + ' ';
  return t.includes('@todos') || t.includes('@' + nome.toLowerCase());
};
// marca @Nome e @todos dentro de um pedaço de texto
function marcarMencoes(el, texto) {
  const nomes = nomesSala();
  let i = 0, buf = '';
  while (i < texto.length) {
    if (texto[i] === '@') {
      const resto = texto.slice(i + 1).toLowerCase();
      const achado = ['todos', ...nomes].find(n => resto.startsWith(n.toLowerCase()) && !/[\p{L}\p{N}]/u.test(resto.charAt(n.length) || ' '));
      if (achado) {
        if (buf) { el.append(buf); buf = ''; }
        const sp = document.createElement('span'); sp.className = 'arroba' + (achado === nome || achado === 'todos' ? ' eu' : '');
        sp.textContent = '@' + texto.slice(i + 1, i + 1 + achado.length);
        el.append(sp); i += achado.length + 1; continue;
      }
    }
    buf += texto[i]; i++;
  }
  if (buf) el.append(buf);
}
// ---- reações nas mensagens ----
function atualizarChips(uid, reacoes) {
  const div = document.querySelector(`#msgs .msg[data-uid="${CSS.escape(uid)}"]`); if (!div) return;
  let ch = div.querySelector('.chips');
  const itens = Object.entries(reacoes || {}).filter(([, l]) => l.length);
  if (!itens.length) { if (ch) ch.remove(); return; }
  if (!ch) { ch = document.createElement('div'); ch.className = 'chips'; div.appendChild(ch); }
  ch.innerHTML = '';
  for (const [emoji, lista] of itens) {
    const b = document.createElement('button');
    b.textContent = `${emoji} ${lista.length}`;
    b.title = lista.map(x => x.nome).join(', ');
    if (lista.some(x => x.cid === cid)) b.className = 'meu';
    b.onclick = () => reagirMsg(uid, emoji);
    ch.appendChild(b);
  }
  const box = $('msgs'); if (box.scrollHeight - box.scrollTop - box.clientHeight < 60) box.scrollTop = box.scrollHeight;
}
function reagirMsg(uid, emoji) { if (hubConn && hubConn.open) hubConn.send({ tipo: 'reagirMsg', uid, emoji }); }
// ---- responder ----
let respondendo = null;
function responder(m) {
  respondendo = m.uid;
  $('txtResposta').innerHTML = '';
  $('txtResposta').append('↩ Respondendo a ', Object.assign(document.createElement('b'), { textContent: m.nome }), ': ' + ((m.texto || (m.img ? '🖼️ imagem' : '')).slice(0, 80)));
  $('barraResposta').classList.remove('oculto');
  $('inChat').focus();
}
function cancelarResposta() { respondendo = null; $('barraResposta').classList.add('oculto'); }
$('btnCancResp').onclick = cancelarResposta;

function addMsg(m, doHistorico) {
  if (!m || !m.uid || vistas.has(m.uid)) return;   // evita repetir quando o hub muda
  vistas.add(m.uid);
  const meChamaram = mencionaMe(m);
  if (!doHistorico) {
    if (meChamaram) avisarMencao(m); else if (!m.tts || !emVoz) avisarEvento(m);   // TTS lido na voz não precisa do bip
    if (m.id) { digitandoAgora.delete(m.id); mostrarDigitando(); }
    lerMensagem(m);
  }
  const box = $('msgs');
  const noFim = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  const div = document.createElement('div');
  const h = document.createElement('span'); h.className = 'hora'; h.textContent = hora(m.ts);
  div.dataset.uid = m.uid; div.dataset.ts = m.ts || 0;
  if (!m.nome) { div.className = 'msg sis'; const t = document.createElement('span'); t.textContent = m.texto; div.append(h, t); }
  else {
    div.className = 'msg' + (meChamaram ? ' mencao' : '');
    if (m.resp && m.resp.uid) {
      const c = document.createElement('span'); c.className = 'citacao'; c.title = 'Ir para a mensagem';
      c.append('↩ ', Object.assign(document.createElement('b'), { textContent: m.resp.nome }), ' ' + (m.resp.trecho || ''));
      c.onclick = () => { const o = document.querySelector(`#msgs .msg[data-uid="${CSS.escape(m.resp.uid)}"]`);
        if (o) { o.scrollIntoView({ block: 'center', behavior: 'smooth' }); o.classList.remove('piscar'); void o.offsetWidth; o.classList.add('piscar'); } };
      div.appendChild(c);
    }
    const q = document.createElement('span'); q.className = 'quem'; q.style.color = m.cor ? clarear(m.cor) : corDe(m.nome).replace('45%', '68%'); q.textContent = m.nome;
    const t = document.createElement('span'); preencherComLinks(t, m.texto || '');
    div.append(h, q, t);
    if (m.tts) div.appendChild(Object.assign(document.createElement('span'), { className: 'ttsIc', textContent: '🗣️', title: 'Mensagem lida em voz alta' }));
    // botões que aparecem ao passar o mouse: responder e reagir
    const acoes = document.createElement('div'); acoes.className = 'acoesMsg';
    const bR = document.createElement('button'); bR.textContent = '↩'; bR.title = 'Responder'; bR.onclick = e => { e.stopPropagation(); responder(m); };
    const bE = document.createElement('button'); bE.textContent = '😀'; bE.title = 'Reagir';
    bE.onclick = e => {
      e.stopPropagation();
      document.querySelectorAll('.paletaMsg').forEach(x => x.remove());
      document.querySelectorAll('.acoesMsg.aberto').forEach(x => x.classList.remove('aberto'));
      const pal = document.createElement('div'); pal.className = 'paletaMsg';
      for (const emo of REACOES_MSG) { const b = document.createElement('button'); b.textContent = emo; b.onclick = ev => { ev.stopPropagation(); reagirMsg(m.uid, emo); pal.remove(); acoes.classList.remove('aberto'); }; pal.appendChild(b); }
      div.appendChild(pal); acoes.classList.add('aberto');
    };
    acoes.append(bR, bE); div.appendChild(acoes);
    // link sozinho de GIF/imagem vira imagem
    const soLink = !m.img && imagemValida((m.texto || '').trim()) && !m.texto.trim().startsWith('data:') ? m.texto.trim() : null;
    const src = imagemValida(m.img) ? m.img : soLink;
    // prévia do primeiro link que não for imagem
    const link = !src && (t.querySelector('a') || {}).href;
    if (link) pedirPrevia(link).then(p => { if (p) { div.appendChild(cartaoPrevia(p)); if (noFim || m.id === euId) box.scrollTop = box.scrollHeight; } });
    if (src) {
      if (soLink) t.textContent = '';
      const im = document.createElement('img'); im.className = 'anexo'; im.src = src; im.alt = 'imagem'; im.loading = 'lazy';
      im.referrerPolicy = 'no-referrer';
      im.onload = () => { if (noFim || m.id === euId) box.scrollTop = box.scrollHeight; };
      im.onclick = () => { $('lightbox').querySelector('img').src = src; $('lightbox').classList.remove('oculto'); };
      div.appendChild(im);
    }
  }
  // entra na posição certa pelo horário (o histórico pode chegar fora de ordem quando o organizador muda)
  let depois = null;
  for (let x = box.lastElementChild; x; x = x.previousElementSibling) { if (Number(x.dataset.ts || 0) > (m.ts || 0)) depois = x; else break; }
  box.insertBefore(div, depois);
  if (m.reacoes) atualizarChips(m.uid, m.reacoes);
  while (box.children.length > 200) box.firstChild.remove();
  if (noFim || m.id === euId) box.scrollTop = box.scrollHeight;
  if (document.hidden && m.nome && m.id !== euId) { naoLidas++; document.title = `(${naoLidas}) Midori Xernoba · ${sala}`; }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && sala) { naoLidas = 0; document.title = 'Midori Xernoba · ' + sala; } });
/* ---- imagens e GIFs no chat ---- */
$('lightbox').onclick = () => $('lightbox').classList.add('oculto');
const lerArquivo = f => new Promise((ok, erro) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = erro; r.readAsDataURL(f); });
async function prepararImagem(f) {
  if (!f || !f.type.startsWith('image/')) return null;
  if (f.type === 'image/gif') {
    if (f.size > 3 * 1024 * 1024) { toast('GIF grande demais (máximo 3 MB).', 'aviso'); return null; }
    return lerArquivo(f);
  }
  // foto: reduz para no máximo 1280 px e comprime
  const url = URL.createObjectURL(f);
  try {
    const im = await new Promise((ok, erro) => { const i = new Image(); i.onload = () => ok(i); i.onerror = erro; i.src = url; });
    const k = Math.min(1, 1280 / Math.max(im.width, im.height));
    const cv = document.createElement('canvas'); cv.width = Math.round(im.width * k); cv.height = Math.round(im.height * k);
    cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
    for (const q of [0.85, 0.7, 0.55]) { const d = cv.toDataURL('image/webp', q); if (d.length < 2.5e6) return d.startsWith('data:image/webp') ? d : cv.toDataURL('image/jpeg', q); }
    toast('Imagem grande demais.', 'aviso'); return null;
  } catch (e) { toast('Não deu para abrir essa imagem.', 'erro'); return null; }
  finally { URL.revokeObjectURL(url); }
}
function enviarChat(texto, img) {
  if (!hubConn || !hubConn.open) { toast('Ainda conectando à sala… tente de novo em instantes.', 'aviso'); return false; }
  hubConn.send({ tipo: 'chat', texto: (texto || '').slice(0, 300), img: img || null, resp: respondendo, tts: ttsLigado && !!(texto || '').trim() });
  cancelarResposta();
  return true;
}
document.addEventListener('click', () => { document.querySelectorAll('.paletaMsg').forEach(x => x.remove()); document.querySelectorAll('.acoesMsg.aberto').forEach(x => x.classList.remove('aberto')); });

// ---- lista de nomes ao digitar @ ----
let opcoesMencao = [], selMencao = 0;
function tokenArroba() {
  const inp = $('inChat'), antes = inp.value.slice(0, inp.selectionStart);
  const mm = antes.match(/(^|\s)@([^@]{0,24})$/);
  return mm ? { ini: antes.length - mm[2].length - 1, busca: mm[2].toLowerCase() } : null;
}
function mostrarMencoes() {
  const tk = tokenArroba(), pop = $('popMencao');
  if (!tk) { pop.classList.add('oculto'); opcoesMencao = []; return; }
  const todos = [{ nome: 'todos', id: '' }, ...membros.filter(m => m.id !== euId)];
  opcoesMencao = todos.filter(m => m.nome.toLowerCase().startsWith(tk.busca)).slice(0, 8);
  if (!opcoesMencao.length) { pop.classList.add('oculto'); return; }
  selMencao = Math.min(selMencao, opcoesMencao.length - 1);
  pop.innerHTML = '';
  opcoesMencao.forEach((m, i) => {
    const b = document.createElement('button'); b.type = 'button'; if (i === selMencao) b.className = 'sel';
    b.innerHTML = m.id ? avatarHTML(m) : '<span style="width:22px;text-align:center">📣</span>';
    b.append(m.id ? m.nome : 'todos (chama a sala inteira)');
    b.onmousedown = e => { e.preventDefault(); escolherMencao(i); };
    pop.appendChild(b);
  });
  pop.classList.remove('oculto');
}
function escolherMencao(i) {
  const tk = tokenArroba(), m = opcoesMencao[i]; if (!tk || !m) return;
  const inp = $('inChat'), fim = inp.selectionStart;
  inp.value = inp.value.slice(0, tk.ini) + '@' + m.nome + ' ' + inp.value.slice(fim);
  const pos = tk.ini + m.nome.length + 2; inp.setSelectionRange(pos, pos);
  $('popMencao').classList.add('oculto'); opcoesMencao = [];
}
$('inChat').addEventListener('input', () => { selMencao = 0; mostrarMencoes(); });
$('inChat').addEventListener('keydown', e => {
  if (opcoesMencao.length && !$('popMencao').classList.contains('oculto')) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); selMencao = (selMencao + (e.key === 'ArrowDown' ? 1 : -1) + opcoesMencao.length) % opcoesMencao.length; mostrarMencoes(); return; }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); escolherMencao(selMencao); return; }
    if (e.key === 'Escape') { $('popMencao').classList.add('oculto'); opcoesMencao = []; return; }
  }
  if (e.key === 'Escape' && respondendo) cancelarResposta();
});
$('inChat').addEventListener('blur', () => setTimeout(() => $('popMencao').classList.add('oculto'), 150));
async function enviarArquivo(f) {
  const d = await prepararImagem(f);
  if (d && enviarChat($('inChat').value.trim(), d)) $('inChat').value = '';
}
$('btnAnexo').onclick = () => $('arqImg').click();
$('arqImg').onchange = () => { const f = $('arqImg').files[0]; $('arqImg').value = ''; if (f) enviarArquivo(f); };
$('inChat').addEventListener('paste', e => {
  const f = [...(e.clipboardData || {}).files || []].find(x => x.type.startsWith('image/'));
  if (f) { e.preventDefault(); enviarArquivo(f); }
});
const chatBox = $('chat');
chatBox.addEventListener('dragover', e => { if ([...e.dataTransfer.items].some(i => i.kind === 'file')) { e.preventDefault(); chatBox.classList.add('soltando'); } });
chatBox.addEventListener('dragleave', e => { if (!chatBox.contains(e.relatedTarget)) chatBox.classList.remove('soltando'); });
chatBox.addEventListener('drop', e => { e.preventDefault(); chatBox.classList.remove('soltando'); const f = [...e.dataTransfer.files].find(x => x.type.startsWith('image/')); if (f) enviarArquivo(f); });


$('formChat').onsubmit = e => {
  e.preventDefault();
  const inp = $('inChat'), texto = inp.value.trim();
  if (!texto) return;
  if (enviarChat(texto)) inp.value = '';
};

/* =================== DIGITANDO =================== */
const digitandoAgora = new Map();
function mostrarDigitando() {
  const agora = Date.now();
  for (const [id, x] of digitandoAgora) if (x.ate < agora || !membros.some(m => m.id === id)) digitandoAgora.delete(id);
  const nomes = [...digitandoAgora.values()].map(x => x.nome);
  const el = $('digitando'); el.innerHTML = '';
  if (!nomes.length) return;
  const b = n => Object.assign(document.createElement('b'), { textContent: n });
  if (nomes.length === 1) el.append(b(nomes[0]), ' está digitando');
  else if (nomes.length === 2) el.append(b(nomes[0]), ' e ', b(nomes[1]), ' estão digitando');
  else el.append('Várias pessoas estão digitando');
  el.append(Object.assign(document.createElement('span'), { className: 'pontos' }));
}
setInterval(mostrarDigitando, 1000);
let ultimoDigitando = 0;
$('inChat').addEventListener('input', () => {
  if (!$('inChat').value.trim() || Date.now() - ultimoDigitando < 2500 || !hubConn || !hubConn.open) return;
  ultimoDigitando = Date.now(); hubConn.send({ tipo: 'digitando' });
});

/* =================== TTS (ler mensagens em voz alta) =================== */
let ttsLigado = ler('ttsLigado') === '1';
let ttsOuvir = ler('ttsOuvir') !== '0', ttsAoVivo = ler('ttsAoVivo') !== '0';
let ttsVol = Number(ler('ttsVol') || '1'), ttsVel = Number(ler('ttsVel') || '1.1'), ttsVoz = ler('ttsVoz') || '';
const temTts = 'speechSynthesis' in window;
function vozesPt() {
  const vs = temTts ? speechSynthesis.getVoices() : [];
  return [...vs.filter(v => /^pt/i.test(v.lang)), ...vs.filter(v => !/^pt/i.test(v.lang))];
}
function preencherVozes() {
  const sel = $('ajTtsVoz'); sel.innerHTML = '';
  const auto = document.createElement('option'); auto.value = ''; auto.textContent = 'Voz automática (português)'; sel.appendChild(auto);
  for (const v of vozesPt()) { const o = document.createElement('option'); o.value = v.name; o.textContent = `${v.name} (${v.lang})`; sel.appendChild(o); }
  sel.value = [...sel.options].some(o => o.value === ttsVoz) ? ttsVoz : '';
}
if (temTts) speechSynthesis.onvoiceschanged = preencherVozes;
function falar(texto) {
  if (!temTts || !texto) return;
  const u = new SpeechSynthesisUtterance(texto.slice(0, 220));
  const vs = vozesPt();
  u.voice = vs.find(v => v.name === ttsVoz) || vs.find(v => /^pt-BR/i.test(v.lang)) || vs[0] || null;
  u.lang = (u.voice && u.voice.lang) || 'pt-BR';
  u.volume = ttsVol; u.rate = ttsVel;
  speechSynthesis.speak(u);   // o navegador já põe em fila: uma leitura não fala por cima da outra
}
function lerMensagem(m) {
  if (!m.tts || !ttsOuvir || !emVoz) return;
  if (ttsAoVivo && aoVivo && fonte !== 'console') return;   // transmitindo a tela: não lê, para não ir junto
  const t = (m.texto || '').replace(/https?:\/\/\S+/g, 'link').replace(/\s+/g, ' ').trim();
  if (t) falar(`${m.nome}: ${t}`);
}
function atualizarBotaoTts() {
  $('btnTts').classList.toggle('ativo', ttsLigado);
  $('btnTts').title = ttsLigado ? 'Modo TTS ligado: suas mensagens são lidas em voz alta para quem está na voz (clique para desligar)'
                                : 'Modo TTS: suas mensagens são lidas em voz alta para quem está na voz';
  $('inChat').placeholder = ttsLigado ? '🗣️ Mensagem (vai ser lida em voz alta)…' : 'Mensagem, ou cole uma imagem…';
}
$('btnTts').onclick = () => {
  if (!temTts) return toast('Este navegador não tem leitura em voz alta.', 'aviso');
  ttsLigado = !ttsLigado; salvar('ttsLigado', ttsLigado ? '1' : '0'); atualizarBotaoTts();
  toast(ttsLigado ? '🗣️ Modo TTS ligado. Quem estiver na voz vai ouvir suas mensagens.' : 'Modo TTS desligado.', '', 4000);
};
atualizarBotaoTts();
