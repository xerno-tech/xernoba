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
const num = (x, d = 1) => Number(x).toFixed(d).replace('.', ',');
const mb = bps => num(bps / 1e6) + ' Mbps';
const LIMITE_CURTO = { bandwidth: '⚠️ internet', cpu: '⚠️ processador', other: 'outro', none: 'nenhum' };
const imgDe = v => `${v.w || '?'}×${v.h || '?'} · ${Math.round(v.fps || 0)} fps`;
// uma linha por pessoa; os detalhes só aparecem quando dizem algo
function blocoSaida(quem, v) {
  if (!v) return [`  • ${quem}: sem vídeo saindo`];
  const r = [`  • ${quem}: ${imgDe(v)} · ${mb(v.taxa)} · limite: ${LIMITE_CURTO[v.motivo] || v.motivo}`];
  const det = [];
  if (v.disponivel && (v.motivo === 'bandwidth' || v.pctBanda >= 5)) det.push(`cabe ~${mb(v.disponivel)}`);
  if (v.pctBanda >= 5) det.push(`internet limitou ${v.pctBanda}% do tempo`);
  if (v.pctCpu >= 5) det.push(`processador limitou ${v.pctCpu}% do tempo`);
  if (v.trocas) det.push(`trocou de resolução ${v.trocas}×`);
  if (v.perda) det.push(`perda ${num(v.perda * 100)}%`);
  if (det.length) r.push('      ' + det.join(' · '));
  return r;
}
function blocoChegada(quem, v) {
  if (!v) return [`  • ${quem}: sem vídeo chegando`];
  const r = [`  • ${quem}: ${imgDe(v)} · ${mb(v.taxa)} · perda ${num(v.perda * 100)}%`];
  const det = [];
  if (v.descartados) det.push(`${v.descartados} quadros descartados`);
  if (v.congelou) det.push(`congelou ${v.congelou}×`);
  if (det.length) r.push('      ' + det.join(' · '));
  return r;
}
// conclusão em linguagem simples
function avaliarTransmissao(saidas) {
  const vs = saidas.filter(Boolean); if (!vs.length) return [];
  const n = vs.length;
  const banda = vs.filter(v => v.motivo === 'bandwidth' || v.pctBanda >= 20).length;
  const cpu = vs.filter(v => v.motivo === 'cpu' || v.pctCpu >= 20).length;
  const sw = /libvpx|openh264|libaom|dav1d/i.test(vs[0].encoder);
  const r = [];
  if (banda) r.push(`  ⚠️ O upload não dá conta (${banda} de ${n} pessoas). Baixe a Qualidade${Number(qual) > 3000 ? ' para 3 Mbps' : ''} ou a resolução.`);
  if (cpu) r.push(`  ⚠️ O processador não dá conta de codificar ${n} vezes${sw ? ' (está sem a placa de vídeo)' : ''}. Baixe a resolução ou o fps.`);
  if (!r.length) r.push('  ✅ Nada limitando do lado de quem transmite. Se a qualidade varia, é a internet de quem assiste.');
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
  L(`Organizador da sala: ${hubPeer && hubPeer.open ? 'sou eu' : (typeof regrasSala !== 'undefined' && regrasSala.organizador ? `${regrasSala.organizador.nome} (v${regrasSala.organizador.versao})` : 'outra pessoa (versão antiga)')} · ligação com ele: ${hubConn ? (hubConn.open ? 'aberta' : 'tentando') : 'nenhuma'}`);
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
    const envio = [...assistentes.entries()], receb = [...assistindo.entries()];
    const med = await medirVideo([...envio.map(([, a]) => a.call && a.call.peerConnection), ...receb.map(([, it]) => it.call && it.call.peerConnection)]);
    if (envio.length) {
      const saidas = envio.map((e, i) => videoSaindo(med[i]));
      const vs = saidas.filter(Boolean), q = Number(qual) / 1000, n = envio.length;
      const hw = vs.some(v => v.hw === true), sw = vs.length && /libvpx|openh264|libaom|dav1d/i.test(vs[0].encoder);
      L('');
      L('— Minha transmissão —');
      L(`  Fonte: ${TITULOS[fonte] || fonte || '?'} · ${resol}p · ${fps} fps · prioridade ${prio}`);
      L(`  Qualidade: ${num(q, 0)} Mbps por pessoa × ${n} = até ${num(q * n, 0)} Mbps de upload`);
      L(`  Enviando agora: ${mb(vs.reduce((x, v) => x + v.taxa, 0))} no total`);
      if (vs.length) L(`  Codificador: ${vs[0].codec} · ${hw ? 'placa de vídeo' : sw ? 'processador (mais pesado)' : vs[0].encoder}`);
      L('');
      L('  Para cada pessoa:');
      envio.forEach(([id], i) => blocoSaida(nomeDe(id), saidas[i]).forEach(x => L(x)));
      L('');
      L('  Conclusão:');
      avaliarTransmissao(saidas).forEach(x => L(x));
    }
    if (receb.length) {
      L('');
      L('— O que estou assistindo —');
      receb.forEach(([id], i) => blocoChegada(nomeDe(id), videoChegando(med[envio.length + i])).forEach(x => L(x)));
    }
  }
  L('');
  L('— Registro de conexão —');
  if (registroConexao.length) for (const x of registroConexao) L(`${hhmmss(x.ts)} ${x.texto}`); else L('nada anotado');
  L('');
  L('— Erros do site —');
  if (errosPagina.length) for (const x of errosPagina) L(`${hhmmss(x.ts)} ${x.txt}`); else L('nenhum');
  return linhas.join('\n');
}
