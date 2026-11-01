// Midori Xernoba — coisas guardadas no servidor da galera: retransmissão (TURN), histórico do chat,
// sons e figurinhas enviados pela galera e estatísticas do mês. Tudo passa pelo Worker do login.

const dadosAPI = (rota, corpo = {}) => fetch(LOGIN_URL + '/dados' + rota, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...corpo, token: tokenLogin }),
});
const temServidorDados = () => !!(LOGIN_URL && tokenLogin);

/* =================== RETRANSMISSÃO (TURN) =================== */
// servidores para achar caminho entre as pessoas; o TURN entra quando a ligação direta é bloqueada
const STUN_PADRAO = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }];
let turnPronto = null, temTurn = false;
function prepararTurn() {
  if (turnPronto) return turnPronto;
  turnPronto = (async () => {
    let extra = [];
    if (temServidorDados()) {
      try {
        const r = await comLimite(fetch(LOGIN_URL + '/turn', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: tokenLogin }) }).then(x => x.json()), 4000);
        if (r && Array.isArray(r.iceServers)) extra = r.iceServers.filter(s => [].concat(s.urls).some(u => /^turns?:/.test(u)));
      } catch (e) {}
    }
    temTurn = extra.length > 0;
    OPCOES_PEER.config = { iceServers: [...STUN_PADRAO, ...extra] };
    anotarConexao(temTurn ? '🛰️ Retransmissão (TURN) pronta para quando a ligação direta falhar' : '🛰️ Sem retransmissão (TURN): só ligação direta');
  })();
  return turnPronto;
}

/* =================== HISTÓRICO DO CHAT =================== */
// o organizador da sala guarda as mensagens no servidor; quando a sala reabre, ele busca de volta
let filaHistorico = [], tHistorico = null;
function guardarNoHistorico(msg) {
  if (!temServidorDados() || !msg || msg.evento !== 'msg' || !msg.nome) return;
  const m = { ...msg };
  if (m.img && m.img.startsWith('data:')) { m.img = null; m.texto = (m.texto ? m.texto + ' ' : '') + '[imagem]'; }
  filaHistorico.push(m);
  clearTimeout(tHistorico);
  tHistorico = setTimeout(() => {
    const msgs = filaHistorico.splice(0, 40);
    if (msgs.length) dadosAPI('/historico/guardar', { sala, msgs }).catch(() => {});
  }, 2500);
}
async function buscarHistorico() {
  if (!temServidorDados()) return [];
  try { const r = await comLimite(dadosAPI('/historico', { sala }).then(x => x.json()), 6000); return (r && r.msgs) || []; } catch (e) { return []; }
}

/* =================== SONS E FIGURINHAS =================== */
let figs = [], figsEm = 0, tocarSonsGalera = ler('sonsGalera') !== '0';
const arquivosFig = new Map();   // id -> promessa da URL local do arquivo
const ehSom = f => /^audio\//.test(f.tipo);
function arquivoFig(id) {
  if (!arquivosFig.has(id)) arquivosFig.set(id, dadosAPI('/figs/arquivo', { id }).then(r => { if (!r.ok) throw 0; return r.blob(); }).then(b => URL.createObjectURL(b)).catch(e => { arquivosFig.delete(id); throw e; }));
  return arquivosFig.get(id);
}
async function carregarFigs(forcar) {
  if (!temServidorDados()) return figs;
  if (!forcar && Date.now() - figsEm < 60000) return figs;
  try { const r = await dadosAPI('/figs').then(x => x.json()); if (r.ok) { figs = r.figs; figsEm = Date.now(); } } catch (e) {}
  return figs;
}
const meuDiscordId = () => { const d = dadosLogin(); return d ? d.id : null; };

async function abrirFigs() {
  const pop = $('popFigs');
  if (!pop.classList.contains('oculto')) { pop.classList.add('oculto'); return; }
  if (!temServidorDados()) return toast('Sons e figurinhas precisam do login com o Discord.', 'aviso');
  pop.classList.remove('oculto');
  $('figsGrade').innerHTML = '<span class="mut">Carregando…</span>';
  await carregarFigs(true);
  desenharFigs();
  $('figsBusca').focus();
}
function desenharFigs() {
  const busca = limpar($('figsBusca').value).replace(/-/g, ' ');
  const lista = figs.filter(f => !busca || limpar(f.nome).replace(/-/g, ' ').includes(busca));
  const g = $('figsGrade');
  if (!figs.length) { g.innerHTML = '<span class="mut figsVazio">Ainda não tem nada aqui. Clique em <b>＋ Enviar</b> para mandar a primeira imagem ou som da galera.</span>'; return; }
  if (!lista.length) { g.innerHTML = '<span class="mut figsVazio">Nada com esse nome.</span>'; return; }
  g.innerHTML = '';
  for (const f of lista) {
    const b = document.createElement('button');
    b.className = 'fig ' + (ehSom(f) ? 'som' : 'img');
    b.title = `${f.nome} · enviado por ${f.autorNome || 'alguém'}`;
    b.innerHTML = ehSom(f) ? `<span class="ic">🔊</span><span class="n">${esc(f.nome)}</span>` : `<img alt=""><span class="n">${esc(f.nome)}</span>`;
    if (!ehSom(f)) arquivoFig(f.id).then(u => { b.querySelector('img').src = u; }).catch(() => {});
    b.onclick = () => mandarFig(f);
    if (f.autor && f.autor === meuDiscordId()) {
      const x = document.createElement('span'); x.className = 'apagar'; x.textContent = '✕'; x.title = 'Apagar (só você, que enviou, pode)';
      x.onclick = async e => {
        e.stopPropagation();
        if (!confirm(`Apagar "${f.nome}" para todo mundo?`)) return;
        const r = await dadosAPI('/figs/apagar', { id: f.id }).then(x => x.json()).catch(() => ({}));
        if (r.ok) { figs = figs.filter(x => x.id !== f.id); desenharFigs(); } else toast('Não deu para apagar.', 'erro');
      };
      b.appendChild(x);
    }
    g.appendChild(b);
  }
}
let ultimaFig = 0;
function mandarFig(f) {
  if (Date.now() - ultimaFig < 2500) return toast('Calma, uma de cada vez 😅', 'aviso', 1500);
  if (!hubConn || !hubConn.open) return toast('Sem ligação com a sala agora.', 'aviso');
  ultimaFig = Date.now();
  hubConn.send({ tipo: 'figurinha', id: f.id, nome: f.nome, som: ehSom(f) });
  $('popFigs').classList.add('oculto');
}
// alguém mandou: imagem aparece no palco, som toca para a sala
async function receberFig(d) {
  let url;
  try { url = await arquivoFig(String(d.id)); } catch (e) { return; }
  if (d.som) {
    if (!tocarSonsGalera) return;
    const a = new Audio(url); a.volume = Math.min(1, Math.max(0, volSom)); a.play().catch(() => {});
    mostrarBolhaFig(`🔊 ${esc(d.autor)} tocou <b>${esc(d.nome)}</b>`);
    return;
  }
  const box = document.createElement('div');
  box.className = 'figPalco';
  box.innerHTML = `<img src="${url}" alt=""><span>${esc(d.autor)}</span>`;
  $('palco').appendChild(box);
  setTimeout(() => box.classList.add('saindo'), 3600);
  setTimeout(() => box.remove(), 4200);
}
function mostrarBolhaFig(html) {
  const b = document.createElement('div'); b.className = 'figBolha'; b.innerHTML = html;
  $('palco').appendChild(b);
  setTimeout(() => b.remove(), 3500);
}
async function enviarFig(arq) {
  if (!arq) return;
  if (!/^(image\/(png|jpeg|gif|webp)|audio\/)/.test(arq.type)) return toast('Mande uma imagem (PNG, JPG, GIF, WEBP) ou um som (MP3, OGG, WAV).', 'aviso');
  if (arq.size > 1048576) return toast('Arquivo grande demais: o limite é 1 MB.', 'aviso');
  const nomePadrao = arq.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 32);
  const nomeFig = (prompt('Nome da figurinha ou do som:', nomePadrao) || '').trim();
  if (!nomeFig) return;
  const dados = await new Promise((ok, erro) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = erro; r.readAsDataURL(arq); });
  const tipo = arq.type === 'audio/mp3' ? 'audio/mpeg' : arq.type;
  const r = await dadosAPI('/figs/enviar', { nome: nomeFig, tipo, dados }).then(x => x.json()).catch(() => ({}));
  if (!r.ok) return toast({ grande: 'Arquivo grande demais (até 1 MB).', tipo: 'Esse tipo de arquivo não vale.', cheio: 'O acervo encheu (300 itens). Apague alguns antigos.' }[r.erro] || 'Não deu para enviar.', 'erro');
  toast(`Enviado: <b>${esc(nomeFig)}</b>`);
  await carregarFigs(true); desenharFigs();
}
$('btnFigs').onclick = abrirFigs;
$('figsBusca').oninput = desenharFigs;
$('figsEnviar').onclick = () => $('arqFig').click();
$('arqFig').onchange = () => { enviarFig($('arqFig').files[0]); $('arqFig').value = ''; };
$('figsFechar').onclick = () => $('popFigs').classList.add('oculto');
document.addEventListener('pointerdown', e => { const p = $('popFigs'); if (!p.classList.contains('oculto') && !p.contains(e.target) && e.target !== $('btnFigs')) p.classList.add('oculto'); });

/* =================== ESTATÍSTICAS =================== */
const horasMin = min => min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ' ' + (min % 60) + ' min' : ''}`;
const NOME_MES = m => { const [a, n] = m.split('-'); return ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'][Number(n) - 1] + ' de ' + a; };
async function mostrarStats(mes) {
  const el = $('statsCorpo');
  if (!temServidorDados()) { el.innerHTML = '<span class="mut">As estatísticas precisam do login com o Discord.</span>'; return; }
  el.innerHTML = '<span class="mut">Carregando…</span>';
  let r; try { r = await dadosAPI('/stats', { mes }).then(x => x.json()); } catch (e) {}
  if (!r || !r.ok) { el.innerHTML = '<span class="mut">Não deu para carregar agora.</span>'; return; }
  const sel = $('statsMes');
  const meses = r.meses.includes(r.mes) ? r.meses : [r.mes, ...r.meses];
  sel.innerHTML = meses.map(m => `<option value="${m}" ${m === r.mes ? 'selected' : ''}>${NOME_MES(m)}</option>`).join('');
  const ranking = (titulo, itens, fmt) => `<div class="statsBloco"><h3>${titulo}</h3>${itens.length
    ? '<ol>' + itens.slice(0, 5).map((x, i) => `<li><span class="pos">${['🥇', '🥈', '🥉'][i] || (i + 1) + 'º'}</span><span class="nm">${esc(x.nome)}</span><span class="v">${fmt(x.valor)}</span></li>`).join('') + '</ol>'
    : '<span class="mut">Nada ainda neste mês.</span>'}</div>`;
  el.innerHTML = `<div class="statsTotal"><b>${horasMin(r.jogatina)}</b><span>de jogatina juntos em ${NOME_MES(r.mes)}</span></div>
    ${ranking('📡 Quem mais transmitiu', r.transmitiu, horasMin)}
    ${ranking('👀 Quem mais assistiu', r.assistiu, horasMin)}
    ${ranking('🎮 Jogos mais vistos', r.jogos, v => horasMin(v) + ' vistos')}
    ${ranking('🏠 Quem mais ficou na sala', r.presenca, horasMin)}
    <span class="mut" style="font-size:12px">Contado minuto a minuto enquanto tem gente na sala. O jogo vem do campo "O que você vai jogar?" de quem transmite.</span>`;
}
$('statsMes').onchange = () => mostrarStats($('statsMes').value);

// o organizador manda um retrato por minuto (quem está, quem transmite o quê e quem assiste quem)
function retratoDaSala(roster) {
  if (!temServidorDados() || !roster.size) return;
  const didDe = new Map([...roster.values()].map(m => [m.id, m._did || m.cid]));
  const pessoas = [...roster.values()].filter(m => !m.ausente || m.live).map(m => ({
    did: m._did || m.cid, nome: m.nome, live: !!m.live, jogo: m.live ? m.jogo || '' : '',
    vendo: (m.vendo || []).map(id => didDe.get(id)).filter(Boolean),
  }));
  dadosAPI('/stats/minuto', { sala, minuto: Math.floor(Date.now() / 60000), pessoas }).catch(() => {});
}

/* =================== O QUE VOCÊ VAI JOGAR =================== */
let jogoAtual = ler('jogo') || '';
$('inJogo').value = jogoAtual;
function definirJogo(v) {
  jogoAtual = String(v || '').trim().slice(0, 40); salvar('jogo', jogoAtual);
  $('inJogo').value = jogoAtual; mostrarJogo();
  if (aoVivo) enviarEstado();
}
function mostrarJogo() { const b = $('btnJogo'); b.textContent = jogoAtual ? '🎮 ' + jogoAtual : '🎮 Qual jogo?'; b.classList.toggle('semJogo', !jogoAtual); }
$('inJogo').oninput = () => definirJogo($('inJogo').value);
// dá para trocar o jogo durante a transmissão, sem parar
$('btnJogo').onclick = () => { const v = prompt('O que você está jogando agora?', jogoAtual); if (v !== null) definirJogo(v); };
mostrarJogo();
