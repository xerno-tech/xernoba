// Midori Xernoba — 🩺 diagnóstico: um relatório para descobrir onde a conexão está falhando
// (⚙️ Ajustes → 📶 Conexão → Gerar diagnóstico). Não inclui endereços de IP.

// erros do site desde que a página abriu
const errosPagina = [];
function anotarErroPagina(txt) {
  errosPagina.push({ ts: Date.now(), txt: String(txt).slice(0, 300) });
  if (errosPagina.length > 20) errosPagina.shift();
}
addEventListener('error', e => anotarErroPagina(`${e.message} (${(e.filename || '').split('/').pop()}:${e.lineno})`));
addEventListener('unhandledrejection', e => anotarErroPagina('Promessa: ' + ((e.reason && (e.reason.message || e.reason.type)) || e.reason)));

const comLimite = (p, ms) => Promise.race([p, new Promise(r => setTimeout(() => r(null), ms))]);
const hhmmss = ts => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

// o servidor de conexão responde? (pede um código e mede o tempo)
async function testarServidor() {
  const o = OPCOES_PEER;
  const ini = performance.now();
  try {
    const r = await comLimite(fetch(`https://${o.host}${o.path}peerjs/id?ts=${Date.now()}`, { cache: 'no-store' }), 8000);
    if (!r) return 'não respondeu em 8 s';
    return r.ok ? `respondeu em ${Math.round(performance.now() - ini)} ms` : `respondeu com erro ${r.status}`;
  } catch (e) { return 'falhou (' + (e.message || e) + ')'; }
}

// a rede deixa fazer ligação direta? descobre o tipo de NAT pelos servidores STUN
async function testarRede() {
  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }] });
  const cands = [];
  pc.onicecandidate = e => { if (e.candidate && e.candidate.candidate) cands.push(e.candidate); };
  pc.createDataChannel('teste');
  await pc.setLocalDescription(await pc.createOffer());
  await comLimite(new Promise(r => { pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === 'complete') r(); }; }), 6000);
  pc.close();
  const tipos = {}; for (const c of cands) tipos[c.type] = (tipos[c.type] || 0) + 1;
  const srflx = cands.filter(c => c.type === 'srflx');
  const portas = new Set(srflx.map(c => c.relatedPort + '>' + c.port));
  const porBase = new Map();
  for (const c of srflx) { const k = c.relatedPort; if (!porBase.has(k)) porBase.set(k, new Set()); porBase.get(k).add(c.port); }
  const simetrico = [...porBase.values()].some(s => s.size > 1);
  let nat;
  if (!cands.length) nat = 'nenhum caminho encontrado (WebRTC bloqueado?)';
  else if (!srflx.length) nat = 'os servidores STUN não responderam (firewall bloqueando UDP?) — ligação direta provavelmente falha';
  else if (simetrico) nat = 'NAT simétrico (comum em 4G e CGNAT) — ligação direta pode falhar com algumas pessoas';
  else nat = 'NAT comum — ligação direta deve funcionar';
  return { tipos: Object.entries(tipos).map(([k, v]) => `${k}:${v}`).join(' ') || 'nenhum', nat, portas: portas.size };
}

// como está cada ligação com as outras pessoas
async function resumoLigacao(pc) {
  if (!pc) return 'sem ligação';
  let par = '';
  try {
    const st = await pc.getStats();
    let sel = null;
    st.forEach(r => { if (r.type === 'transport' && r.selectedCandidatePairId) sel = st.get(r.selectedCandidatePairId); });
    if (!sel) st.forEach(r => { if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') sel = r; });
    if (sel) {
      const l = st.get(sel.localCandidateId), rm = st.get(sel.remoteCandidateId);
      const nomeTipo = t => ({ host: 'rede local', srflx: 'direto', prflx: 'direto', relay: 'retransmitido' }[t] || t || '?');
      par = ` · caminho: ${nomeTipo(l && l.candidateType)} ⇄ ${nomeTipo(rm && rm.candidateType)}` + (sel.currentRoundTripTime != null ? ` · ping ${Math.round(sel.currentRoundTripTime * 1000)} ms` : '');
    }
  } catch (e) {}
  return `${pc.connectionState} (ICE ${pc.iceConnectionState})${par}`;
}
const nomeDe = id => { const m = membros.find(x => x.id === id); return m ? m.nome : id.slice(0, 8); };

async function gerarDiagnostico() {
  const linhas = [];
  const L = s => linhas.push(s);
  const rede = navigator.connection;
  L(`🩺 Diagnóstico Midori v${VERSAO} · ${new Date().toLocaleString('pt-BR')}`);
  L(`Navegador: ${navigator.userAgent}`);
  L(`Pessoa: ${nome || '?'} · Sala: ${sala || '?'} · Aba ${document.hidden ? 'em segundo plano' : 'visível'} · Internet ${navigator.onLine ? 'ligada' : 'DESLIGADA'}` + (rede ? ` · ${rede.effectiveType || ''}${rede.type ? ' ' + rede.type : ''}${rede.rtt ? ' ~' + rede.rtt + ' ms' : ''}` : ''));
  L('');
  L('— Servidor de conexão —');
  L(`Endereço: ${OPCOES_PEER.host}`);
  L(`Teste agora: ${await testarServidor()}`);
  L(`Minha ligação: ${!peer ? 'não criada' : peer.destroyed ? 'destruída' : peer.disconnected ? 'CAÍDA' : peer.open ? 'aberta' : 'esperando o servidor'}` + (typeof tentativaServidor !== 'undefined' && tentativaServidor > 1 ? ` (tentativa ${tentativaServidor})` : ''));
  L(`Organizador da sala: ${hubPeer && hubPeer.open ? 'sou eu' : 'outra pessoa'} · ligação com ele: ${hubConn ? (hubConn.open ? 'aberta' : 'tentando') : 'nenhuma'}`);
  if (hubConn && hubConn.peerConnection) L(`  ${await resumoLigacao(hubConn.peerConnection)}`);
  L('');
  L('— Minha rede —');
  try { const r = await testarRede(); L(`Caminhos encontrados: ${r.tipos}`); L(`Avaliação: ${r.nat}`); }
  catch (e) { L('Teste falhou: ' + (e.message || e)); }
  L('');
  L(`— Pessoas na sala (${membros.length}) —`);
  for (const m of membros) L(`${m.id === euId ? '• (eu) ' : '• '}${m.nome} · v${m.versao || '?'}${m.live ? ' · ao vivo' : ''}${m.voz ? ' · na voz' : ''}${m.ausente ? ' · ausente' : ''}`);
  L('');
  L('— Ligações diretas —');
  let alguma = false;
  for (const [id, it] of assistindo) { alguma = true; L(`Assistindo ${nomeDe(id)}: ${await resumoLigacao(it.call && it.call.peerConnection)}`); }
  for (const [id, a] of assistentes) { alguma = true; L(`${nomeDe(id)} me assiste: ${await resumoLigacao(a.call && a.call.peerConnection)}`); }
  for (const [id, v] of vozes) { alguma = true; L(`Voz com ${nomeDe(id)}: ${await resumoLigacao(v.call && v.call.peerConnection)}`); }
  if (!alguma) L('nenhuma (não estou assistindo, transmitindo nem na voz)');
  L('');
  L('— Registro de conexão —');
  if (registroConexao.length) for (const x of registroConexao) L(`${hhmmss(x.ts)} ${x.texto}`); else L('nada anotado');
  L('');
  L('— Erros do site —');
  if (errosPagina.length) for (const x of errosPagina) L(`${hhmmss(x.ts)} ${x.txt}`); else L('nenhum');
  return linhas.join('\n');
}
