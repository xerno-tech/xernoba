// Midori Xernoba — sala: estado, organizador da lista (hub), lista de pessoas e "ausente"

// nome e sala de quem está usando (definidos ao entrar)
let nome = '', sala = '', HUB = '';


let peer = null, hubPeer = null, hubConn = null, euId = null, saindo = false, avisoDoHub = null;

// registro de quedas (⚙️ Ajustes → 📶 Conexão): ajuda a descobrir por que alguém cai
const registroConexao = [];
function anotarConexao(texto) {
  if (saindo) return;
  registroConexao.push({ ts: Date.now(), texto: texto + (document.hidden ? ' (aba em segundo plano)' : '') });
  if (registroConexao.length > 40) registroConexao.shift();
  if (typeof mostrarRegistroConexao === 'function') mostrarRegistroConexao();
}
addEventListener('offline', () => anotarConexao('🔌 A sua internet caiu'));
addEventListener('online', () => anotarConexao('🔌 A sua internet voltou'));
let ausente = false, inicioLive = 0;
const miniaturasRec = new Map();   // miniaturas recebidas de quem está ao vivo
let previaDe = null;
function mostrarPrevia(id, linha) {
  const img = miniaturasRec.get(id), box = $('previaHover');
  if (!img) return;
  previaDe = id;
  box.querySelector('img').src = img;
  const m = membros.find(x => x.id === id);
  box.querySelector('span').textContent = (m ? m.nome : '') + (assistindo.has(id) ? ' · você está assistindo' : ' · clique em Assistir');
  const r = linha.getBoundingClientRect(), lat = $('membros').getBoundingClientRect();
  box.classList.remove('oculto');
  const h = box.offsetHeight;
  box.style.left = (lat.right + 10) + 'px';
  box.style.top = Math.max(8, Math.min(innerHeight - h - 8, r.top + r.height / 2 - h / 2)) + 'px';
}
function esconderPrevia() { previaDe = null; $('previaHover').classList.add('oculto'); }
let regrasSala = {}, senhaSala = null, bloqueado = false, silenciadoAdmin = false;
let adminKey = ler('adminKey') || null;
let stream = null, aoVivo = false;
let membros = [];
const assistentes = new Map();   // quem me assiste: id -> {conn, call}
const assistindo = new Map();    // quem eu assisto: id -> {conn, call, tela}

/* ---- Hub: organiza a lista da sala (o primeiro a entrar assume) ---- */
function virarHub() {
  if (hubPeer || bloqueado || saindo) return;
  hubPeer = new Peer(HUB, OPCOES_PEER);
  const roster = new Map(), conns = new Map();
  const historico = [];
  const miniaturas = new Map();   // quem está ao vivo -> última miniatura
  // regras da sala: herdadas do último hub, para não sumirem quando o hub muda
  const banidos = new Set(regrasSala.banidos || []);
  const nomesBanidos = Object.assign({}, regrasSala.nomesBanidos || {});   // cid -> nome, para a lista do admin
  const silenciados = new Set(regrasSala.silenciados || []);
  let senhaHash = regrasSala.senhaHash || null;
  // quem já pode estar na sala com senha (estava dentro quando a senha foi posta, ou acertou a senha)
  const autorizados = new Set(regrasSala.autorizados || []);
  // quem já foi anunciado como admin (para não repetir o aviso a cada reconexão)
  const adminsAvisados = new Set(regrasSala.adminsAvisados || []);
  // pulseiras de login já conferidas (token -> validade)
  const conferidas = new Map();
  // devolve os dados do Discord conferidos (id, avatar) ou null
  async function pulseiraValida(token) {
    if (!LOGIN_URL) return {};
    if (!token) return null;
    const c = conferidas.get(token);
    if (c && c.ate > Date.now()) return c.dados;
    try {
      const r = await fetch(LOGIN_URL + '/verificar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) }).then(x => x.json());
      if (r.ok) { conferidas.set(token, { ate: Math.min(r.exp, Date.now() + 30 * 60000), dados: r }); return r; }
    } catch (e) {}
    return null;
  }
  const ultimaReacao = new Map();
  // saída "de verdade" (fechou a aba): anuncia na hora.
  // queda (aba adormecida, internet oscilou): só anuncia se a pessoa não voltar em 3 minutos.
  const pendentes = new Map();   // cid -> timer da saída ainda não anunciada
  function sairDe(id, deVerdade) {
    conns.delete(id); vistoEm.delete(id);
    const m = roster.get(id);
    if (!m) return;
    roster.delete(id); miniaturas.delete(id); difundir();
    if (m._expulso) return;
    if (deVerdade || !m.cid) { registrar(`${m.nome} saiu da sala`, null, null, 'saiu', id); return; }
    clearTimeout(pendentes.get(m.cid));
    pendentes.set(m.cid, setTimeout(() => { pendentes.delete(m.cid); registrar(`${m.nome} saiu da sala`, null, null, 'saiu', id); }, 180000));
  }
  const vistoEm = new Map();
  // evento: entrou/saiu/live/voz/nome/msg — usado para os sons; alvo: quem o evento envolve
  const registrar = (texto, nomeAutor, idAutor, evento, alvo, cor, img, extra) => {
    if (saindo) return;   // a página está fechando: as conexões caindo não são saídas de verdade
    const msg = { tipo: 'msg', uid: Math.random().toString(36).slice(2) + Date.now().toString(36), ts: Date.now(), texto,
                  nome: nomeAutor || null, id: idAutor || null, evento: evento || (nomeAutor ? 'msg' : null), alvo: alvo || idAutor || null, cor: cor || null, img: img || null,
                  ...(extra || {}) };
    historico.push(msg); if (historico.length > 60) historico.shift();
    // o histórico guarda só as 8 imagens mais recentes, para não pesar em quem entra
    const comImg = historico.filter(x => x.img && x.img.startsWith('data:'));
    for (const x of comImg.slice(0, Math.max(0, comImg.length - 8))) { x.img = null; x.texto = (x.texto ? x.texto + ' ' : '') + '[imagem]'; }
    for (const c of conns.values()) if (c.open) try { c.send(msg); } catch (e) {}
    guardarNoHistorico(msg);
  };
  const difundir = () => {
    const lista = [...roster.values()].map(({ cid: _c, _expulso, _did, _pedidos, _ultimaFig, _jogoPedido, ...m }) => m);
    const regras = { banidos: [...banidos], nomesBanidos, silenciados: [...silenciados], senhaHash, autorizados: [...autorizados], adminsAvisados: [...adminsAvisados] };
    for (const c of conns.values()) if (c.open) try { c.send({ tipo: 'lista', membros: lista, regras }); } catch (e) {}
  };
  // só aparece jogo que existe no banco de jogos (nada de nome inventado)
  const jogosOk = new Map();   // nome normalizado -> true/false/promessa
  function jogoConferido(jogo, quem, token) {
    jogo = jogo.trim(); if (!jogo) return '';
    if (!LOGIN_URL) return jogo;
    const k = limpar(jogo); const v = jogosOk.get(k);
    if (v === true) return jogo;
    if (v === false) return '';
    if (!v) {
      jogosOk.set(k, fetch(LOGIN_URL + '/jogos/existe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: tokenLogin || token, nome: jogo }) })
        .then(r => r.json()).then(r => {
          const ok = !!(r && r.ok && r.existe); jogosOk.set(k, ok);
          const m = roster.get(quem);
          if (ok && m && m.live && m._jogoPedido === jogo) { m.jogo = jogo; difundir(); }
          if (!ok) { const cq = conns.get(quem); try { cq && cq.open && cq.send({ tipo: 'jogoRecusado', jogo }); } catch (e) {} }
        }).catch(() => jogosOk.delete(k)));
    }
    const m = roster.get(quem); if (m) m._jogoPedido = jogo;
    return m && m.jogo === jogo ? jogo : '';   // enquanto confere, continua o que já estava valendo
  }
  let hubAbriu = false;
  hubPeer.on('open', () => {
    avisoDoHub = registrar;
    anotarConexao(hubAbriu ? '🔁 O organizador (você) voltou ao servidor da Midori' : '🗂️ Você virou o organizador da sala');
    const primeira = !hubAbriu;
    hubAbriu = true;
    conectarHub();
    if (primeira) buscarHistorico().then(msgs => {
      const novas = msgs.filter(m => !historico.some(x => x.uid === m.uid));
      if (!novas.length) return;
      historico.unshift(...novas); while (historico.length > 80) historico.shift();
      for (const c of conns.values()) if (c.open) try { c.send({ tipo: 'historico', msgs: novas }); } catch (e) {}
    });
  });
  // estatísticas: um retrato da sala por minuto
  setInterval(() => { if (hubPeer && hubPeer.open && !saindo) retratoDaSala(roster); }, 60000);
  // quem some sem avisar sai depois de 2,5 min sem sinal (o Chrome atrasa os sinais de abas em segundo plano)
  setInterval(() => { const agora = Date.now(); for (const [id, t] of vistoEm) if (agora - t > 150000) { const c = conns.get(id); vistoEm.delete(id); const m = roster.get(id); if (m) anotarConexao(`⏱️ ${m.nome} ficou 2,5 min sem dar sinal e foi tirado da lista`); if (c) try { c.close(); } catch (e) {} sairDe(id); } }, 5000);
  hubPeer.on('connection', c => {
    conns.set(c.peer, c);
    c.on('data', async d => {
      if (!d || c._fora) return;   // conexão recusada: ignora o que vier depois
      vistoEm.set(c.peer, Date.now());
      if (d.tipo === 'tchau') { sairDe(c.peer, true); return; }
      // alguém na tela de entrada quer saber quem já está aqui (só nomes, e só com login válido)
      if (d.tipo === 'espiar') {
        c._fora = true;
        const ok = await pulseiraValida(d.token);
        try { if (ok && !senhaHash) c.send({ tipo: 'espiada', nomes: [...roster.values()].map(m => m.nome).slice(0, 12), live: [...roster.values()].filter(m => m.live).map(m => m.nome).slice(0, 6) }); } catch (e) {}
        setTimeout(() => { try { c.close(); } catch (e) {} conns.delete(c.peer); vistoEm.delete(c.peer); }, 300);
        return;
      }
      if (d.tipo === 'estado') {
        const antes = roster.get(c.peer);
        const ccid = String(d.cid || '').slice(0, 40);
        const disc = await pulseiraValida(d.token);
        if (!antes && !disc) {
          c._fora = true; try { c.send({ tipo: 'semLogin' }); } catch (e) {} setTimeout(() => c.close(), 300); return;
        }
        if (!antes) {
          // barra quem foi expulso ou não sabe a senha
          if (ccid && banidos.has(ccid)) { c._fora = true; try { c.send({ tipo: 'expulso' }); } catch (e) {} setTimeout(() => c.close(), 300); return; }
          if (senhaHash && !autorizados.has(ccid)) {
            if (d.senha !== senhaHash) { c._fora = true; try { c.send({ tipo: 'pedeSenha', errada: !!d.senha }); } catch (e) {} setTimeout(() => c.close(), 300); return; }
            autorizados.add(ccid);
          }
        }
        const admin = !!(disc && disc.id && ADMINS_DISCORD.includes(String(disc.id))) || !!(ADMIN_HASH && d.adminKey && await sha256(String(d.adminKey)) === ADMIN_HASH);
        const m = { id: c.peer, cid: ccid, nome: String(d.nome).slice(0, 24), live: !!d.live, voz: !!d.voz, mudo: !!d.mudo || silenciados.has(ccid),
                    ausente: !!d.ausente && !d.live, versao: Number(d.versao) || 0,
                    jogo: d.live ? jogoConferido(String(d.jogo || '').slice(0, 60), c.peer, d.token) : '', jogoCapa: d.live && capaValida(d.jogoCapa) ? d.jogoCapa : null, _did: disc && disc.id ? String(disc.id) : (antes && antes._did) || null,
                    vendo: Array.isArray(d.vendo) ? d.vendo.slice(0, 8).map(x => String(x).slice(0, 64)) : [],
                    liveMs: d.live ? Math.max(0, Math.min(Number(d.liveMs) || 0, 7 * 864e5)) : 0,
                    silenciado: silenciados.has(ccid), admin,
                    foto: d.usarFoto && disc && disc.id && disc.avatar ? `https://cdn.discordapp.com/avatars/${disc.id}/${disc.avatar}.png?size=64` : null,
                    cor: /^#[0-9a-f]{6}$/i.test(d.cor || '') ? d.cor : null, emoji: d.emoji ? String(d.emoji).slice(0, 8) : null };
        roster.set(c.peer, m);
        // avisa só uma vez por pessoa (não a cada reconexão ou troca de organizador)
        if (admin && ccid && !adminsAvisados.has(ccid)) { adminsAvisados.add(ccid); registrar(`${m.nome} agora é admin 🛡️`, null, null, 'nome', c.peer); }
        else if (!admin && ccid) adminsAvisados.delete(ccid);
        if (!antes) {
          try { c.send({ tipo: 'historico', msgs: historico }); } catch (e) {}
          for (const [tid, img] of miniaturas) if (roster.has(tid)) try { c.send({ tipo: 'thumb', id: tid, img }); } catch (e) {}
          // quem só está se reconectando a um hub novo não é anunciado de novo
          // a mesma pessoa (mesmo navegador) voltando: tira a entrada antiga, sem anunciar nada
          let mesma = false;
          for (const [oid, om] of roster) if (oid !== c.peer && ccid && om.cid === ccid) {
            mesma = true; om._expulso = true;
            const oc = conns.get(oid); try { oc && oc.close(); } catch (e) {}
            conns.delete(oid); vistoEm.delete(oid); roster.delete(oid);
          }
          if (pendentes.has(ccid)) { clearTimeout(pendentes.get(ccid)); pendentes.delete(ccid); mesma = true; }   // voltou da queda
          if (!mesma && !d.voltando) registrar(`${m.nome} entrou na sala`, null, null, 'entrou', c.peer);
        } else {
          if (antes.nome !== m.nome) registrar(`${antes.nome} agora se chama ${m.nome}`, null, null, 'nome', c.peer);
          if (antes.live !== m.live) registrar(m.live ? `${m.nome} começou a transmitir` : `${m.nome} parou de transmitir`, null, null, m.live ? 'live' : 'fimLive', c.peer);
          if (antes.voz !== m.voz) registrar(m.voz ? `${m.nome} entrou na voz` : `${m.nome} saiu da voz`, null, null, 'voz', c.peer);
        }
        if (!m.live) miniaturas.delete(c.peer);
        difundir();
      } else if (d.tipo === 'digitando') {
        const m = roster.get(c.peer); if (!m) return;
        for (const [xid, x] of conns) if (xid !== c.peer && x.open) try { x.send({ tipo: 'digitando', id: c.peer, nome: m.nome }); } catch (e) {}
      } else if (d.tipo === 'thumb') {
        const m = roster.get(c.peer);
        if (!m || !m.live || typeof d.img !== 'string' || !/^data:image\/(jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(d.img) || d.img.length > 40000) return;
        miniaturas.set(c.peer, d.img);
        for (const x of conns.values()) if (x.open) try { x.send({ tipo: 'thumb', id: c.peer, img: d.img }); } catch (e) {}
      } else if (d.tipo === 'reagirMsg') {
        const m = roster.get(c.peer); const alvo = historico.find(x => x.uid === d.uid);
        if (!m || !alvo || !alvo.nome || !REACOES_MSG.includes(d.emoji)) return;
        alvo.reacoes = alvo.reacoes || {};
        const lista = alvo.reacoes[d.emoji] || [];
        const i = lista.findIndex(x => x.cid === m.cid);
        if (i >= 0) lista.splice(i, 1); else lista.push({ cid: m.cid, nome: m.nome });
        if (lista.length) alvo.reacoes[d.emoji] = lista; else delete alvo.reacoes[d.emoji];
        for (const x of conns.values()) if (x.open) try { x.send({ tipo: 'reacoesMsg', uid: alvo.uid, reacoes: alvo.reacoes }); } catch (e) {}
      } else if (d.tipo === 'acao') {
        const adm = roster.get(c.peer);
        if (!adm || !adm.admin) return;   // só admin manda
        if (d.acao === 'senha') {
          senhaHash = d.hash ? String(d.hash).slice(0, 64) : null;
          autorizados.clear();
          if (senhaHash) for (const m of roster.values()) if (m.cid) autorizados.add(m.cid);   // quem já está dentro continua
          registrar(senhaHash ? `${adm.nome} colocou senha na sala 🔒` : `${adm.nome} tirou a senha da sala 🔓`, null, null, 'nome', c.peer);
          difundir(); return;
        }
        if (d.acao === 'desbanir') {
          const ccid = String(d.cid || '');
          if (!banidos.has(ccid)) return;
          banidos.delete(ccid);
          registrar(`${adm.nome} deixou ${nomesBanidos[ccid] || 'alguém'} voltar para a sala`, null, null, 'nome', c.peer);
          delete nomesBanidos[ccid];
          difundir(); return;
        }
        const alvo = roster.get(d.alvo); if (!alvo || alvo.id === adm.id) return;
        const ca = conns.get(alvo.id);
        if (d.acao === 'expulsar') {
          if (alvo.cid) { banidos.add(alvo.cid); nomesBanidos[alvo.cid] = alvo.nome; autorizados.delete(alvo.cid); }
          alvo._expulso = true;
          registrar(`${adm.nome} removeu ${alvo.nome} da sala`, null, null, 'saiu', alvo.id);
          try { ca && ca.send({ tipo: 'expulso' }); } catch (e) {}
          setTimeout(() => { try { ca && ca.close(); } catch (e) {} sairDe(alvo.id); }, 400);
        } else if (d.acao === 'silenciar' || d.acao === 'liberar') {
          const sim = d.acao === 'silenciar';
          if (alvo.cid) sim ? silenciados.add(alvo.cid) : silenciados.delete(alvo.cid);
          alvo.silenciado = sim; if (sim) alvo.mudo = true;
          registrar(sim ? `${adm.nome} silenciou ${alvo.nome} na voz` : `${adm.nome} liberou o microfone de ${alvo.nome}`, null, null, 'nome', alvo.id);
          try { ca && ca.send({ tipo: 'silenciar', valor: sim }); } catch (e) {}
        } else if (d.acao === 'diagnostico') {
          try { ca && ca.send({ tipo: 'pedeDiagnostico', por: adm.id, porNome: adm.nome }); } catch (e) {}
          return;   // não muda nada na sala
        } else if (d.acao === 'parar') {
          registrar(`${adm.nome} encerrou a transmissão de ${alvo.nome}`, null, null, 'nome', alvo.id);
          try { ca && ca.send({ tipo: 'parar' }); } catch (e) {}        } else if (d.acao === 'jogo') {
          if (!alvo.live) return;
          const jogo = String(d.jogo || '').trim().slice(0, 60);
          const capa = capaValida(d.capa) ? d.capa : '';
          if (jogo && LOGIN_URL && jogosOk.get(limpar(jogo)) !== true) {
            const r = await fetch(LOGIN_URL + '/jogos/existe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: tokenLogin, nome: jogo }) }).then(x => x.json()).catch(() => null);
            if (!r || !r.existe) { try { c.send({ tipo: 'jogoRecusado', jogo }); } catch (e) {} return; }
            jogosOk.set(limpar(jogo), true);
          }
          registrar(jogo ? `${adm.nome} mudou o jogo de ${alvo.nome} para ${jogo} 🎮` : `${adm.nome} tirou o jogo de ${alvo.nome}`, null, null, 'nome', alvo.id);
          try { ca && ca.send({ tipo: 'jogoPeloAdmin', jogo, capa, por: adm.nome }); } catch (e) {}
        }
        difundir();
      } else if (d.tipo === 'diagnostico') {
        const m = roster.get(c.peer), adm = roster.get(d.para);
        if (!m || !adm || !adm.admin) return;
        const ca = conns.get(adm.id);
        try { ca && ca.open && ca.send({ tipo: 'diagnosticoDe', id: m.id, nome: m.nome, texto: String(d.texto || '').slice(0, 30000) }); } catch (e) {}
      } else if (d.tipo === 'risco') {
        const m = roster.get(c.peer); if (!m || !roster.has(d.alvo) || !Array.isArray(d.pts)) return;
        const pts = d.pts.slice(0, 60).filter(p => Array.isArray(p) && p.length === 2 && p.every(n => typeof n === 'number' && n >= -0.1 && n <= 1.1));
        if (!pts.length) return;
        const msg = { tipo: 'risco', alvo: d.alvo, autor: c.peer, novo: !!d.novo, pts, cor: m.cor || corDe(m.nome) };
        for (const x of conns.values()) if (x.open) try { x.send(msg); } catch (e) {}
      } else if (d.tipo === 'pedirJogo') {
        const m = roster.get(c.peer), alvo = roster.get(d.alvo); if (!m || !alvo || !alvo.live || alvo.id === m.id) return;
        m._pedidos = m._pedidos || {};
        if (Date.now() - (m._pedidos[alvo.id] || 0) < 25000) return;   // sem encher o saco
        m._pedidos[alvo.id] = Date.now();
        const ca = conns.get(alvo.id);
        try { ca && ca.open && ca.send({ tipo: 'pedidoJogo', de: m.nome, motivo: d.motivo === 'errado' ? 'errado' : 'falta' }); } catch (e) {}
      } else if (d.tipo === 'figurinha') {
        const m = roster.get(c.peer); if (!m || typeof d.id !== 'string' || d.id.length > 40) return;
        if (Date.now() - (m._ultimaFig || 0) < 2000) return;   // sem metralhadora
        m._ultimaFig = Date.now();
        const msg = { tipo: 'figurinha', id: d.id, nome: String(d.nome || '').slice(0, 32), som: !!d.som, autor: m.nome };
        for (const x of conns.values()) if (x.open) try { x.send(msg); } catch (e) {}
        registrar(`${m.nome} ${msg.som ? 'tocou 🔊' : 'mandou 🎭'} ${msg.nome}`, null, null, 'nome', c.peer);
      } else if (d.tipo === 'reacao') {
        const m = roster.get(c.peer); if (!m || !REACOES.includes(d.emoji) || !roster.has(d.alvo)) return;
        if (Date.now() - (ultimaReacao.get(c.peer) || 0) < 250) return;   // sem metralhadora
        ultimaReacao.set(c.peer, Date.now());
        const msg = { tipo: 'reacao', alvo: d.alvo, emoji: d.emoji, nome: m.nome };
        for (const x of conns.values()) if (x.open) try { x.send(msg); } catch (e) {}
      } else if (d.tipo === 'chat') {
        const m = roster.get(c.peer); if (!m) return;
        const texto = String(d.texto || '').trim().slice(0, 300);
        const img = imagemValida(d.img) ? d.img : null;
        if (!texto && !img) return;
        // resposta: guarda um trechinho da mensagem original
        const orig = d.resp && historico.find(x => x.uid === d.resp && x.nome);
        const resp = orig ? { uid: orig.uid, nome: orig.nome, trecho: (orig.texto || (orig.img ? '🖼️ imagem' : '')).slice(0, 90) } : null;
        // TTS: só texto, e no máximo uma leitura a cada 2 s por pessoa
        let tts = false;
        if (d.tts && texto && Date.now() - (m._ultimoTts || 0) > 2000) { tts = true; m._ultimoTts = Date.now(); }
        registrar(texto, m.nome, c.peer, 'msg', c.peer, m.cor, img, Object.assign({}, resp ? { resp } : {}, tts ? { tts: true } : {}));
      }
    });
    // só tira da lista se esta ainda for a ligação atual da pessoa
    // (uma ligação velha fechando depois da nova não pode apagar a nova)
    const sair = () => { if (conns.get(c.peer) === c) sairDe(c.peer); };
    c.on('close', sair); c.on('error', sair);
  });
  hubPeer.on('error', e => { if (e.type === 'unavailable-id') { try { hubPeer.destroy(); } catch (x) {} hubPeer = null; conectarHub(); } });
  hubPeer.on('disconnected', () => {
    if (!hubPeer || hubPeer.destroyed) return;   // tentativa de virar organizador que não deu certo
    if (hubAbriu) anotarConexao('📡 O organizador (você) caiu do servidor da Midori; reconectando');
    try { hubPeer.reconnect(); } catch (e) {}
  });
  setInterval(difundir, 5000);
}
let tHub;
function conectarHub() {
  clearTimeout(tHub);
  if (bloqueado || saindo || !peer || peer.destroyed) return;
  if (hubConn && hubConn.open) return;   // já está ligado: não derruba uma ligação que funciona
  if (hubConn && Date.now() - hubConn._desde < 8000) return;   // ainda está tentando ligar: espera
  if (hubConn) { const velha = hubConn; hubConn = null; try { velha.close(); } catch (e) {} }
  const conn = hubConn = peer.connect(HUB, { reliable: true });
  conn._desde = Date.now();
  // se ficar travada tentando ligar, desiste dela e tenta de novo
  setTimeout(() => { if (hubConn === conn && !conn.open) { hubConn = null; try { conn.close(); } catch (e) {} agendarHub(); } }, 10000);
  conn.on('open', () => {
    const pc = conn.peerConnection;   // guarda o último estado da ligação, para o registro de quedas
    if (pc) pc.addEventListener('iceconnectionstatechange', () => { conn._ice = pc.iceConnectionState; });
    if (caiuDoHub) { caiuDoHub = false; anotarConexao('✅ Voltou a ligação com o organizador da sala'); } enviarEstado(); });
  conn.on('close', () => {
    if (hubConn !== conn) return;   // ligação velha, já trocada
    const motivo = { disconnected: 'a rede oscilou', failed: 'a rede bloqueou ou caiu', closed: 'a ligação foi fechada' }[conn._ice];
    anotarConexao('⚠️ Caiu a ligação com o organizador da sala' + (motivo ? ` (${motivo})` : ''));
    caiuDoHub = true;
    hubConn = null; if (!bloqueado) agendarHub();
  });
  conn.on('data', d => {
    if (!d) return;
    if (d.tipo === 'lista') { for (const m of d.membros) if (m.live) m._inicioLocal = Date.now() - (m.liveMs || 0); membros = d.membros; if (d.regras) regrasSala = d.regras; renderLista(); atualizarAdminUI(); atualizarEspectadores(); }
    else if (d.tipo === 'thumb') { miniaturasRec.set(d.id, d.img); if (previaDe === d.id) $('previaHover').querySelector('img').src = d.img; const li = document.querySelector(`#vazio [data-mini="${CSS.escape(d.id)}"]`); if (li) li.src = d.img; }
    else if (d.tipo === 'reacoesMsg') { atualizarChips(d.uid, d.reacoes); }
    else if (d.tipo === 'digitando') { digitandoAgora.set(d.id, { nome: d.nome, ate: Date.now() + 4000 }); mostrarDigitando(); }
    else if (d.tipo === 'reacao') { mostrarReacao(d); }
    else if (d.tipo === 'figurinha') { receberFig(d); }
    else if (d.tipo === 'pedidoJogo') { receberPedidoJogo(d); }
    else if (d.tipo === 'risco') { receberRisco(d); }
    else if (d.tipo === 'expulso') { bloquear('expulso'); }
    else if (d.tipo === 'semLogin') { bloqueado = true; salvar('token', ''); salvar('erroLogin', 'sessao'); location.href = location.pathname; }
    else if (d.tipo === 'pedeSenha') { bloquear('senha', d.errada); }
    else if (d.tipo === 'silenciar') { aplicarSilencio(!!d.valor); }
    else if (d.tipo === 'jogoRecusado') { toast(`🎮 <b>${esc(d.jogo)}</b> não está no banco de jogos. Escolha um jogo da lista.`, 'aviso', 6000); if (jogoAtual === d.jogo) definirJogo({ nome: '', capa: null }); }
    else if (d.tipo === 'jogoPeloAdmin') { if (aoVivo) { definirJogo({ nome: d.jogo, capa: d.capa }); toast(`🛡️ ${esc(d.por)} mudou o seu jogo para <b>${esc(d.jogo || 'nenhum')}</b>.`, '', 6000); } }
    else if (d.tipo === 'pedeDiagnostico') { responderDiagnostico(d); }
    else if (d.tipo === 'diagnosticoDe') { mostrarDiagnosticoDe(d); }
    else if (d.tipo === 'parar') { if (aoVivo) { pararTransmissao(); toast('Um admin encerrou a sua transmissão.', 'aviso', 8000); } }
    else if (d.tipo === 'msg') addMsg(d);
    else if (d.tipo === 'historico') (d.msgs || []).forEach(x => addMsg(x, true));
  });
}
let caiuDoHub = false;
function agendarHub() {
  clearTimeout(tHub);
  tHub = setTimeout(() => { if (bloqueado || saindo) return; if (!hubConn || !hubConn.open) virarHub(); if (hubPeer && hubPeer.open) conectarHub(); }, 500 + Math.random() * 2000);
}
let jaEntrei = false;
function enviarEstado() {
  if (!hubConn || !hubConn.open) return;
  hubConn.send({ tipo: 'estado', nome, live: aoVivo, voz: emVoz, mudo: emVoz && mudo, cor: perfil.cor, emoji: perfil.emoji, voltando: jaEntrei, ausente, versao: VERSAO, liveMs: aoVivo && inicioLive ? Date.now() - inicioLive : 0,
                 vendo: [...assistindo.keys()].slice(0, 8), jogo: aoVivo ? jogoAtual : '', jogoCapa: aoVivo ? jogoCapa : '', cid, senha: senhaSala, adminKey, token: tokenLogin, usarFoto: perfil.foto });
  jaEntrei = true;
}
setInterval(enviarEstado, 5000);

/* ---- Lista de quem está na sala ---- */
// lista de pessoas recolhível, para sobrar espaço para o chat
let listaFechada = ler('listaFechada') === '1';
document.body.classList.toggle('listaFechada', listaFechada);
$('tituloMembros').onclick = () => { listaFechada = !listaFechada; salvar('listaFechada', listaFechada ? '1' : ''); document.body.classList.toggle('listaFechada', listaFechada); renderLista(); };

// o que a pessoa está fazendo, em poucas palavras
function statusDe(m) {
  if (m.live) return (m.jogo ? m.jogo + ' · ao vivo' : 'Ao vivo') + (m._inicioLocal ? ' há ' + duracao(Date.now() - m._inicioLocal).replace('agora', 'pouco') : '');
  if (m.ausente) return '🌙 Ausente';
  const vendo = (m.vendo || []).map(id => membros.find(x => x.id === id && x.live)).filter(Boolean);
  const partes = [];
  if (vendo.length === 1) partes.push('Assistindo ' + vendo[0].nome);
  else if (vendo.length > 1) partes.push(`Assistindo ${vendo.length} telas`);
  if (m.voz) partes.push(m.mudo ? 'na voz (mudo)' : 'na voz');
  if (!partes.length) return 'Na sala';
  const t = partes.join(' · ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}
function renderLista() {
  const el = $('lista');
  el.innerHTML = '';
  document.querySelectorAll('body > .admMenu').forEach(x => x.remove());
  $('tituloMembros').innerHTML = `Na sala · ${membros.length} <span class="seta">${listaFechada ? '▸' : '▾'}</span>`;
  const versaoMaisNova = Math.max(0, ...membros.map(m => m.versao || 0));
  const ordenados = [...membros].sort((a, b) => (b.live - a.live) || a.nome.localeCompare(b.nome));
  for (const m of ordenados) {
    const eu = m.id === euId;
    const div = document.createElement('div');
    div.className = 'membro';
    const status = statusDe(m);
    div.innerHTML = `${avatarHTML(m, (m.live ? 'live' : '') + (m.ausente ? ' ausente' : ''))}
      <div class="info"><span class="n">${esc(m.nome)}${m.admin ? '<span class="escudo" title="Admin">🛡️</span>' : ''}${(m.versao || 0) < versaoMaisNova ? '<span class="escudo" title="Está com uma versão antiga da Midori. Peça para atualizar (Ctrl+F5).">⚠️</span>' : ''}${eu ? ' <span class="mut">(você)</span>' : ''}</span>
      <span class="s ${m.live ? 'live' : ''}">${status}</span></div>
      ${m.voz ? `<span class="voz" title="${m.mudo ? 'Mudo' : 'Na voz'}">${m.mudo ? '🔇' : '🎙️'}</span>` : ''}`;
    if (m.voz && !eu && emVoz) {
      const r = document.createElement('input');
      r.type = 'range'; r.min = 0; r.max = 2; r.step = 0.05; r.className = 'volVoz';
      r.value = ler('volVoz-' + m.nome) || '1';
      const dica = () => { r.title = `Volume da voz: ${Math.round(r.value * 100)}%`; r.classList.toggle('alto', r.value > 1); };
      dica();
      r.oninput = () => {
        salvar('volVoz-' + m.nome, r.value); dica();
        const v = vozes.get(m.id);
        if (v && v.ganho) v.ganho.gain.value = Number(r.value); else if (v && v.audio) v.audio.volume = Math.min(1, Number(r.value));
      };
      div.appendChild(r);
    }
    if (m.live && !eu) {
      const vendo = assistindo.has(m.id);
      const b = document.createElement('button');
      b.textContent = vendo ? 'Fechar' : 'Assistir';
      if (vendo) b.className = 'sec';
      b.onclick = () => vendo ? pararDeAssistir(m.id) : assistir(m);
      div.appendChild(b);
    }
    // admin: as ações ficam num menu ⋯, para não cobrir o Assistir
    if (souAdmin() && !eu) {
      const mais = document.createElement('button');
      mais.className = 'btnMais' + (menuAdm === m.id ? ' aberto' : ''); mais.textContent = '⋯'; mais.title = 'Ações de admin';
      mais.onclick = e => { e.stopPropagation(); menuAdm = menuAdm === m.id ? null : m.id; renderLista(); };
      div.appendChild(mais);
      if (menuAdm === m.id) {
        const menu = document.createElement('div'); menu.className = 'admMenu';
        menu.onclick = e => e.stopPropagation();
        const item = (txt, fn, cls) => { const b = document.createElement('button'); b.textContent = txt; if (cls) b.className = cls; b.onclick = () => { menuAdm = null; fn(); renderLista(); }; menu.appendChild(b); };
        if (m.voz) item(m.silenciado ? '🎙️ Liberar o microfone' : '🔇 Silenciar na voz', () => acaoAdmin(m.silenciado ? 'liberar' : 'silenciar', m.id));
        if (m.live) item('🎮 Trocar o jogo', () => abrirJogoAdmin(m));
        if (m.live) item('⏹ Parar a transmissão', () => acaoAdmin('parar', m.id));
        item('🩺 Pegar diagnóstico', () => pedirDiagnostico(m));
        item('🚫 Expulsar da sala', () => { if (confirm(`Expulsar ${m.nome} da sala?`)) acaoAdmin('expulsar', m.id); }, 'perigo');
        // flutua por cima de tudo, colado no botão ⋯; se não couber embaixo, abre para cima
        document.body.appendChild(menu);
        requestAnimationFrame(() => {
          const rb = mais.getBoundingClientRect(), rm = menu.getBoundingClientRect();
          let top = rb.bottom + 4;
          if (top + rm.height > innerHeight - 8) top = rb.top - rm.height - 4;
          menu.style.top = Math.max(8, top) + 'px';
          menu.style.left = Math.max(8, Math.min(innerWidth - rm.width - 8, rb.right - rm.width)) + 'px';
        });
      }
    }
    el.appendChild(div);
    // miniatura ao vivo: aparece ao passar o mouse em cima de quem está transmitindo
    if (m.live && !eu) {
      div.onmouseenter = () => mostrarPrevia(m.id, div);
      div.onmouseleave = esconderPrevia;
    }
  }
  renderLobby(); atualizarJogoTelas();
  for (const id of [...miniaturasRec.keys()]) if (!membros.some(m => m.id === id && m.live)) miniaturasRec.delete(id);
  for (const id of [...assistindo.keys()]) if (!membros.some(m => m.id === id && m.live)) pararDeAssistir(id);
  sincronizarVoz();
}

/* =================== AUSENTE (10 min sem mexer) =================== */
let ultimaAtividade = Date.now();
const mexeu = () => { ultimaAtividade = Date.now(); if (ausente) { ausente = false; enviarEstado(); } };
for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart']) addEventListener(ev, mexeu, { passive: true });
document.addEventListener('visibilitychange', () => { if (!document.hidden) mexeu(); });
setInterval(() => {
  if (falandoDesde && falandoDesde.has(euId)) ultimaAtividade = Date.now();   // falar na voz conta como presença
  const agora = !aoVivo && Date.now() - ultimaAtividade > 10 * 60000;
  if (agora !== ausente) { ausente = agora; enviarEstado(); }
}, 20000);

/* =================== LOBBY (palco vazio) =================== */
// em vez de um espaço vazio: quem está na sala, quem está ao vivo (com miniatura) e os botões principais
function renderLobby() {
  const el = $('vazio'); if (!el) return;
  const ordenados = [...membros].sort((a, b) => (b.live - a.live) || a.nome.localeCompare(b.nome));
  const aoVivoOutros = ordenados.filter(m => m.live && m.id !== euId);
  const cartao = m => {
    const eu = m.id === euId;
    const mini = m.live && !eu ? miniaturasRec.get(m.id) : null;
    return `<div class="cartao ${m.live ? 'live' : ''}" data-id="${esc(m.id)}">
      ${m.live ? `<div class="mini">${mini ? `<img data-mini="${esc(m.id)}" src="${mini}" alt="">` : `<img data-mini="${esc(m.id)}" alt="" class="oculto">`}<span class="selo">AO VIVO</span></div>` : ''}
      <div class="linha">${avatarHTML(m, m.live ? 'live' : '')}${m.live && m.jogoCapa && capaValida(m.jogoCapa) ? `<img class="capaJogo" src="${esc(m.jogoCapa)}" alt="" title="${esc(m.jogo || '')}">` : ''}<div class="info"><b>${esc(m.nome)}${eu ? ' <span class="mut">(você)</span>' : ''}</b><span>${esc(statusDe(m))}</span></div>
      ${m.live && !eu ? `<button data-assistir="${esc(m.id)}">${assistindo.has(m.id) ? 'Abrir' : 'Assistir'}</button>` : ''}</div>
    </div>`;
  };
  const titulo = aoVivoOutros.length
    ? `<h2>${aoVivoOutros.length === 1 ? `${esc(aoVivoOutros[0].nome)} está ao vivo` : `${aoVivoOutros.length} pessoas ao vivo`}</h2><p>Clique em <b>Assistir</b> para abrir a tela aqui.</p>`
    : membros.length > 1 ? '<h2>Ninguém transmitindo ainda</h2><p>Que tal ser o primeiro? O seu jogo aparece para todo mundo da sala.</p>'
    : '<h2>Você é o primeiro aqui</h2><p>Mande o link da sala para a galera e comece a transmitir.</p>';
  el.innerHTML = `<div class="lobby">
    <img class="logoLobby" src="img/logo.png" alt="">
    ${titulo}
    <div class="acoes">
      ${aoVivo ? '' : '<button data-acao="transmitir">📡 Transmitir</button>'}
      ${emVoz ? '' : '<button class="sec" data-acao="voz">🎙️ Entrar na voz</button>'}
      <button class="sec" data-acao="link">🔗 Copiar link da sala</button>
    </div>
    <div class="cartoes">${ordenados.map(cartao).join('')}</div>
  </div>`;
  const alvo = { transmitir: 'btnTransmitir', voz: 'btnVoz', link: 'btnLink' };
  el.querySelectorAll('[data-acao]').forEach(b => b.onclick = () => $(alvo[b.dataset.acao]).click());
  el.querySelectorAll('[data-assistir]').forEach(b => b.onclick = () => { const m = membros.find(x => x.id === b.dataset.assistir); if (m) assistir(m); });
}
