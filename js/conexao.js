// Midori Xernoba — conexão entre as pessoas (PeerJS): quem assiste quem, voz e vídeo chegando

// Entrar na sala: mostra a tela da sala e liga a conexão
function entrar(n, s) {
  nome = n; sala = s; HUB = 'telinha-hub-' + s;
  $('entrada').classList.add('oculto'); $('sala').classList.remove('oculto');
  document.body.classList.add('naSala');
  $('txtSala').textContent = '# ' + sala;
  document.title = 'Midori Xernoba · ' + sala;
  iniciarConexao();
}

function iniciarConexao() {
  peer = new Peer();
  peer.on('open', id => { euId = id; virarHub(); setTimeout(() => { if (!hubConn) conectarHub(); }, 800); });

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
    call.answer(undefined, { sdpTransform: sdpEstereo });
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
      if (pc.connectionState === 'failed') { aviso.textContent = 'Não deu para conectar direto com essa pessoa (a rede de um de vocês está bloqueando).'; aviso.classList.remove('oculto', 'clicavel'); }
    });
  });

  peer.on('error', e => {
    if (e.type === 'peer-unavailable') {
      if (String(e.message).includes(HUB)) { if (hubConn && !hubConn.open) hubConn = null; agendarHub(); }
      else for (const id of [...assistindo.keys()]) if (String(e.message).includes(id)) pararDeAssistir(id);
    } else if (e.type === 'network' || e.type === 'server-error') {
      toast('Conexão com o servidor caiu. Tentando de novo…', 'aviso');
    }
    if (e.type !== 'peer-unavailable') anotarConexao(`❗ Erro de conexão: ${e.type}`);
  });
  peer.on('disconnected', () => { anotarConexao('📡 Você caiu do servidor do PeerJS (as telas e a voz continuam); reconectando'); setTimeout(() => { try { peer.reconnect(); } catch (e) {} }, 2000); });
  window.addEventListener('beforeunload', () => { if (avisoDoHub) avisoDoHub(`${nome} saiu da sala`, null, null, 'saiu', euId); saindo = true; try { hubConn && hubConn.open && hubConn.send({ tipo: 'tchau' }); } catch (e) {} try { peer.destroy(); } catch (e) {} try { hubPeer && hubPeer.destroy(); } catch (e) {} });
}
