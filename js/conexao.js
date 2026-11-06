// Midori Xernoba — conexão entre as pessoas (PeerJS): quem assiste quem, voz e vídeo chegando

// Entrar na sala: mostra a tela da sala e liga a conexão
function entrar(n, s) {
  nome = n; sala = s; HUB = 'telinha-hub-' + s;
  $('entrada').classList.add('oculto'); $('sala').classList.remove('oculto');
  document.body.classList.add('naSala');
  $('txtSala').textContent = '# ' + sala;
  document.title = 'Midori Xernoba · ' + sala;
  avisarOutrasAbas();
  iniciarConexao();
}
// a mesma pessoa com a sala aberta em duas abas: a mais nova fica, a antiga se desliga sozinha
let canalAbas = null;
function avisarOutrasAbas() {
  if (!('BroadcastChannel' in window)) return;
  try {
    canalAbas = new BroadcastChannel('midori-abas');
    canalAbas.onmessage = e => {
      const d = e.data || {};
      if (d.tipo === 'entrei' && d.sala === sala && !bloqueado && !saindo) {
        anotarConexao('📑 Esta sala foi aberta em outra aba ou janela; esta foi desligada');
        bloquear('outraAba');
      }
    };
    canalAbas.postMessage({ tipo: 'entrei', sala });
  } catch (e) {}
}

// o servidor grátis do PeerJS às vezes demora minutos para responder, sem dar erro:
// se não responder em 15 s, desiste dessa tentativa e tenta de novo
let tentativaServidor = 0, tServidor = null, inicioTentativa = 0, saidaLigada = false;
function mostrarConectando(texto, aviso) {
  const el = $('lista'); if (!el || euId || membros.length) return;
  el.innerHTML = `<div class="conectando${aviso ? ' aviso' : ''}">${texto}</div>`;
}
async function iniciarConexao() {
  await prepararTurn();
  tentativaServidor++; inicioTentativa = Date.now();
  if (tentativaServidor > 1) anotarConexao(`🔄 Tentando de novo ligar ao servidor da Midori (tentativa ${tentativaServidor})`);
  mostrarConectando(tentativaServidor > 3
    ? '⚠️ O servidor da Midori não está respondendo. A Midori continua tentando sozinha; pode deixar a aba aberta.'
    : tentativaServidor > 1 ? `Conectando ao servidor… (tentativa ${tentativaServidor})` : 'Conectando ao servidor…', tentativaServidor > 3);
  peer = new Peer(OPCOES_PEER);
  clearTimeout(tServidor);
  const estePeer = peer;
  tServidor = setTimeout(() => {
    if (peer !== estePeer || euId || saindo) return;
    anotarConexao('⏳ O servidor da Midori não respondeu em 15 s');
    try { estePeer.destroy(); } catch (e) {}
    iniciarConexao();
  }, 15000);
  peer.on('open', id => {
    if (peer !== estePeer) { try { estePeer.destroy(); } catch (e) {} return; }
    clearTimeout(tServidor);
    mostrarConectando('Entrando na sala…');
    const seg = ((Date.now() - inicioTentativa) / 1000).toFixed(1);
    anotarConexao(`🟢 Ligado ao servidor da Midori em ${seg} s` + (tentativaServidor > 1 ? ` (tentativa ${tentativaServidor})` : ''));
    euId = id; virarHub(); setTimeout(() => { if (!hubConn) conectarHub(); }, 800);
  });

  // alguém quer me assistir
  const naSala = id => membros.some(m => m.id === id);   // lista que o organizador da sala já conferiu
  peer.on('connection', conn => {
    if (!conn.metadata || conn.metadata.tipo !== 'assistir') return;
    if (!naSala(conn.peer)) { conn.on('open', () => conn.close()); return; }
    assistentes.set(conn.peer, { conn, call: null });
    conn.on('open', () => { enviarPara(conn.peer); atualizarAoVivo(); });
    const sair = () => { const a = assistentes.get(conn.peer); if (a && a.call) try { a.call.close(); } catch (e) {} assistentes.delete(conn.peer); atualizarAoVivo(); };
    conn.on('close', sair); conn.on('error', sair);
  });

  // vídeo chegando de quem eu assisto
  peer.on('call', call => {
    if (call.metadata && call.metadata.tipo === 'voz') {
      if (!naSala(call.peer)) { try { call.close(); } catch (e) {} return; }
      if (!emVoz || !mic) { try { call.close(); } catch (e) {} return; }
      call.answer(mic);
      ligarVoz(call.peer, call);
      return;
    }
    const it = assistindo.get(call.peer);
    if (!it) { try { call.close(); } catch (e) {} return; }
    call.answer(undefined, { sdpTransform: sdpAssistir(call.metadata && call.metadata.codec) });
    if (it.call && it.call !== call) try { it.call.close(); } catch (e) {}
    it.call = call;
    const v = it.tela.querySelector('video');
    const aviso = it.tela.querySelector('.aviso');
    call.on('stream', s => {
      v.srcObject = s;
      ligarSom(it.tela, s);
      aviso.classList.add('oculto');
      const pedirClique = () => {
        aviso.textContent = '🔊 Clique para ouvir'; aviso.classList.add('clicavel'); aviso.classList.remove('oculto');
        aviso.onclick = e => { e.stopPropagation(); v.play().catch(() => {}); if (ctxTelas) ctxTelas.resume().catch(() => {}); aviso.classList.add('oculto'); };
      };
      // só pede o clique se o navegador realmente bloqueou o som (mover a tela de lugar não conta)
      v.play().catch(e => { if (e.name === 'NotAllowedError') pedirClique(); });
      if (ctxTelas && ctxTelas.state !== 'running') setTimeout(() => { if (ctxTelas.state !== 'running') pedirClique(); }, 600);
    });
    const pc = call.peerConnection;
    if (pc) pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed') {
        aviso.textContent = temTurn ? 'A ligação com essa pessoa caiu. Tentando de novo…' : 'Não deu para conectar direto com essa pessoa (a rede de um de vocês está bloqueando).';
        aviso.classList.remove('oculto', 'clicavel');
        reabrirTela(call.peer, 'a ligação falhou');
      } else if (pc.connectionState === 'disconnected') {
        // às vezes volta sozinha; se em 8 s não voltar, reabre
        setTimeout(() => { if (pc.connectionState === 'disconnected' && assistindo.get(call.peer) === it) reabrirTela(call.peer, 'a imagem parou de chegar'); }, 8000);
      } else if (pc.connectionState === 'connected') tentativasTela.delete(call.peer);
    });
  });

  peer.on('error', e => {
    if (peer !== estePeer) return;   // tentativa antiga, já descartada
    if (e.type === 'peer-unavailable') {
      if (String(e.message).includes(HUB)) { if (hubConn && !hubConn.open) hubConn = null; agendarHub(); }
      else for (const id of [...assistindo.keys()]) if (String(e.message).includes(id)) pararDeAssistir(id);
    } else if (e.type === 'network' || e.type === 'server-error') {
      toast('Conexão com o servidor caiu. Tentando de novo…', 'aviso');
    }
    if (e.type !== 'peer-unavailable') anotarConexao(`❗ Erro de conexão: ${e.type}`);
  });
  peer.on('disconnected', () => { if (peer !== estePeer || estePeer.destroyed) return; anotarConexao('📡 Você caiu do servidor da Midori (as telas e a voz continuam); reconectando'); inicioTentativa = Date.now(); setTimeout(() => { try { peer.reconnect(); } catch (e) {} }, 2000); });
  if (saidaLigada) return; saidaLigada = true;
  window.addEventListener('beforeunload', () => { if (avisoDoHub) avisoDoHub(`${nome} saiu da sala`, null, null, 'saiu', euId); saindo = true; try { hubConn && hubConn.open && hubConn.send({ tipo: 'tchau' }); } catch (e) {} try { peer.destroy(); } catch (e) {} try { hubPeer && hubPeer.destroy(); } catch (e) {} });
}
