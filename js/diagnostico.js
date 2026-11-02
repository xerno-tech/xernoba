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
// tipo do caminho, sem mostrar o endereço: IPv6 costuma ser ligação direta pela internet, não rede local
function nomeCaminho(c) {
  if (!c) return '?';
  const end = c.address || c.ip || '';
  const v6 = end.includes(':'), mdns = end.endsWith('.local');
  if (c.candidateType === 'relay') return 'retransmitido (TURN)';
  if (c.candidateType === 'host') return mdns ? 'endereço oculto pelo navegador' : v6 ? 'IPv6 direto' : (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(end) ? 'rede local (IPv4)' : end ? 'IPv4 direto' : 'endereço da máquina');
  return 'IPv4 pelo roteador';   // srflx / prflx
}
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
      par = ` · caminho: ${nomeCaminho(l)} ⇄ ${nomeCaminho(rm)}` + (sel.currentRoundTripTime != null ? ` · ping ${Math.round(sel.currentRoundTripTime * 1000)} ms` : '');
    }
  } catch (e) {}
  return `${pc.connectionState} (ICE ${pc.iceConnectionState})${par}`;
}

// --- qualidade do vídeo: duas leituras com 2 s de intervalo para medir o que está passando agora ---
const MOTIVO = { bandwidth: 'INTERNET (upload não dá conta)', cpu: 'PROCESSADOR (codificação pesada)', other: 'outro motivo', none: 'nada' };
const mbps = bps => (bps / 1e6).toFixed(1) + ' Mbps';
async function medirVideo(pcs) {
  const ler = () => Promise.all(pcs.map(pc => pc ? pc.getStats().catch(() => null) : null));
  const a = await ler(); await new Promise(r => setTimeout(r, 2000)); const b = await ler();
  return pcs.map((pc, i) => ({ a: a[i], b: b[i] }));
}
const achar = (st, f) => { let x = null; if (st) st.forEach(r => { if (!x && f(r)) x = r; }); return x; };
function videoSaindo({ a, b }) {
  const o2 = achar(b, r => r.type === 'outbound-rtp' && r.kind === 'video');
  if (!o2) return null;
  const o1 = a && a.get(o2.id);
  const dt = o1 ? (o2.timestamp - o1.timestamp) / 1000 : 0;
  const taxa = dt > 0 ? (o2.bytesSent - o1.bytesSent) * 8 / dt : 0;
  const par = achar(b, r => r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded');
  const remoto = achar(b, r => r.type === 'remote-inbound-rtp' && r.kind === 'video');
  const codec = o2.codecId && b.get(o2.codecId);
  const dur = o2.qualityLimitationDurations || {};
  const tot = Object.values(dur).reduce((x, y) => x + y, 0) || 1;
  const pct = k => Math.round((dur[k] || 0) / tot * 100);
  return {
    taxa, w: o2.frameWidth, h: o2.frameHeight, fps: o2.framesPerSecond,
    motivo: o2.qualityLimitationReason || '?', trocas: o2.qualityLimitationResolutionChanges,
    pctBanda: pct('bandwidth'), pctCpu: pct('cpu'),
    encoder: o2.encoderImplementation || '?', hw: o2.powerEfficientEncoder,
    codec: codec ? codec.mimeType.replace('video/', '') : '?',
    disponivel: par && par.availableOutgoingBitrate, perda: remoto && remoto.fractionLost
  };
}
function videoChegando({ a, b }) {
  const i2 = achar(b, r => r.type === 'inbound-rtp' && r.kind === 'video');
  if (!i2) return null;
  const i1 = a && a.get(i2.id);
  const dt = i1 ? (i2.timestamp - i1.timestamp) / 1000 : 0;
  const d = k => i1 ? (i2[k] || 0) - (i1[k] || 0) : 0;
  const pac = d('packetsReceived') + d('packetsLost');
  return {
    taxa: dt > 0 ? d('bytesReceived') * 8 / dt : 0, w: i2.frameWidth, h: i2.frameHeight, fps: i2.framesPerSecond,
    perda: pac > 0 ? d('packetsLost') / pac : 0, descartados: d('framesDropped'), congelou: i2.freezeCount || 0,
    decoder: i2.decoderImplementation || '?'
  };
}
const linhaSaida = (quem, v) => !v ? `${quem}: sem vídeo saindo` :
  `${quem}: ${v.w || '?'}×${v.h || '?'} a ${Math.round(v.fps || 0)} fps · ${mbps(v.taxa)}` +
  (v.disponivel ? ` (cabe ~${mbps(v.disponivel)})` : '') +
  ` · limitado por: ${MOTIVO[v.motivo] || v.motivo}` +
  (v.pctBanda || v.pctCpu ? ` · desde o início: ${v.pctBanda}% do tempo pela internet, ${v.pctCpu}% pelo processador` : '') +
  (v.trocas ? ` · ${v.trocas} trocas de resolução` : '') +
  (v.perda != null ? ` · perda ${(v.perda * 100).toFixed(1)}%` : '');
const linhaChegada = (quem, v) => !v ? `${quem}: sem vídeo chegando` :
  `${quem}: ${v.w || '?'}×${v.h || '?'} a ${Math.round(v.fps || 0)} fps · ${mbps(v.taxa)} · perda ${(v.perda * 100).toFixed(1)}%` +
  (v.descartados ? ` · ${v.descartados} quadros descartados em 2 s` : '') + (v.congelou ? ` · congelou ${v.congelou}×` : '') +
  ` · decodificador: ${v.decoder}`;

// conclusão em linguagem simples
function avaliarTransmissao(saidas) {
  const vs = saidas.filter(Boolean); if (!vs.length) return [];
  const n = vs.length, total = vs.reduce((x, v) => x + v.taxa, 0);
  const banda = vs.filter(v => v.motivo === 'bandwidth').length, cpu = vs.filter(v => v.motivo === 'cpu').length;
  const muitaBanda = vs.filter(v => v.pctBanda >= 20).length, muitaCpu = vs.filter(v => v.pctCpu >= 20).length;
  const hw = vs.some(v => v.hw === true), sw = /libvpx|openh264|libaom|dav1d/i.test(vs[0].encoder);
  const r = [];
  r.push(`Enviando ${mbps(total)} no total para ${n} pessoa${n > 1 ? 's' : ''} (limite: ${(Number(qual) / 1000)} Mbps por pessoa = até ${Number(qual) * n / 1000} Mbps).`);
  r.push(`Codificador: ${vs[0].codec} · ${vs[0].encoder}${hw ? ' (placa de vídeo)' : sw ? ' (processador — mais pesado)' : ''}.`);
  if (banda || muitaBanda) r.push(`⚠️ O upload não está dando conta${banda ? ` agora (${banda} de ${n})` : ` em boa parte do tempo (${muitaBanda} de ${n})`}: a qualidade cai e sobe conforme a internet aperta. Baixar a Qualidade para ${Number(qual) > 3000 ? '3 Mbps' : 'menos'} ou a resolução deve estabilizar.`);
  if (cpu || muitaCpu) r.push(`⚠️ O processador não está dando conta de codificar ${n} vezes${sw ? ' (está codificando sem a placa de vídeo)' : ''}. Baixar a resolução ou o fps deve estabilizar.`);
  if (!banda && !cpu && !muitaBanda && !muitaCpu) r.push('✅ Nenhum limite apareceu do lado de quem transmite. Se a qualidade varia, o problema está na internet de quem assiste.');
  return r;
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
  if (assistentes.size || assistindo.size) {
    L('');
    L('— Qualidade do vídeo (medida em 2 s) —');
    const envio = [...assistentes.entries()], receb = [...assistindo.entries()];
    const med = await medirVideo([...envio.map(([, a]) => a.call && a.call.peerConnection), ...receb.map(([, it]) => it.call && it.call.peerConnection)]);
    if (envio.length) {
      L(`Minha transmissão: ${fonte || '?'} · pedido ${resol}p a ${fps} fps · prioridade ${prio} · qualidade ${Number(qual) / 1000} Mbps por pessoa`);
      const saidas = envio.map((e, i) => videoSaindo(med[i]));
      envio.forEach(([id], i) => L(`  Para ${linhaSaida(nomeDe(id), saidas[i])}`));
      for (const x of avaliarTransmissao(saidas)) L(x);
    }
    receb.forEach(([id], i) => L(`Vendo ${linhaChegada(nomeDe(id), videoChegando(med[envio.length + i]))}`));
  }
  L('');
  L('— Registro de conexão —');
  if (registroConexao.length) for (const x of registroConexao) L(`${hhmmss(x.ts)} ${x.texto}`); else L('nada anotado');
  L('');
  L('— Erros do site —');
  if (errosPagina.length) for (const x of errosPagina) L(`${hhmmss(x.ts)} ${x.txt}`); else L('nenhum');
  return linhas.join('\n');
}
