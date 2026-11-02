// Midori Xernoba — poderes de admin: expulsar, silenciar, parar transmissão, senha da sala
/* =================== ADMIN (cliente) =================== */
const souAdmin = () => !!membros.find(x => x.id === euId && x.admin);
let menuAdm = null;   // de quem está aberto o menu ⋯
document.addEventListener('click', () => { if (menuAdm) { menuAdm = null; renderLista(); } });
function acaoAdmin(acao, alvo, extra) {
  if (!hubConn || !hubConn.open) return toast('Ainda conectando à sala…', 'aviso');
  hubConn.send(Object.assign({ tipo: 'acao', acao, alvo }, extra || {}));
}
function bloquear(motivo, errada) {
  bloqueado = true;
  try { hubConn && hubConn.close(); } catch (e) {}
  $('telaBloqueio').classList.remove('oculto');
  $('bloqSenhaBox').classList.toggle('oculto', motivo !== 'senha');
  $('bloqSoVoltar').classList.toggle('oculto', motivo === 'senha');
  if (motivo === 'senha') {
    $('bloqTitulo').textContent = '🔒 Sala com senha';
    $('bloqTexto').textContent = errada ? 'Senha errada. Tente de novo.' : 'Esta sala tem senha. Digite para entrar.';
    $('bloqSenha').value = ''; setTimeout(() => $('bloqSenha').focus(), 50);
  } else {
    $('bloqTitulo').textContent = '🚫 Você foi removido da sala';
    $('bloqTexto').textContent = 'Um admin tirou você desta sala.';
    if (aoVivo) pararTransmissao();
    if (emVoz) sairVoz();
    for (const id of [...assistindo.keys()]) pararDeAssistir(id);
    saindo = true;
    try { peer.destroy(); } catch (e) {}
    try { hubPeer && hubPeer.destroy(); } catch (e) {}
  }
}
$('bloqEntrar').onclick = async () => {
  const sen = $('bloqSenha').value; if (!sen) return;
  senhaSala = await hashSenhaSala(sala, sen);
  bloqueado = false; jaEntrei = false;
  $('telaBloqueio').classList.add('oculto');
  conectarHub();
};
$('bloqSenha').addEventListener('keydown', e => { if (e.key === 'Enter') $('bloqEntrar').click(); });
const voltarInicio = () => { location.href = location.pathname; };
$('bloqVoltar').onclick = voltarInicio; $('bloqVoltar2').onclick = voltarInicio;
function aplicarSilencio(sim) {
  silenciadoAdmin = sim;
  if (sim) { mudo = true; if (mic) mic.getAudioTracks().forEach(t => t.enabled = false); toast('🔇 Um admin silenciou o seu microfone.', 'aviso', 8000); }
  else toast('🎙️ Um admin liberou o seu microfone. Desmute quando quiser.');
  atualizarBotoesVoz(); enviarEstado(); renderLista();
}
function atualizarAdminUI() {
  const adm = souAdmin();
  $('admSemConfig').classList.toggle('oculto', !!ADMIN_HASH);
  $('admLogin').classList.toggle('oculto', !ADMIN_HASH || adm);
  $('admPainel').classList.toggle('oculto', !adm);
  $('admStatusSenha').textContent = regrasSala.senhaHash ? '· 🔒 com senha agora' : '· 🔓 sem senha agora';
  const box = $('admBanidos'); box.innerHTML = '';
  const lista = regrasSala.banidos || [];
  if (!lista.length) { const v = document.createElement('span'); v.className = 'mut'; v.style.fontSize = '12px'; v.textContent = 'Ninguém foi expulso.'; box.appendChild(v); }
  for (const ccid of lista) {
    const linha = document.createElement('div'); linha.style.cssText = 'display:flex;align-items:center;gap:8px';
    const n = document.createElement('span'); n.style.flex = '1'; n.textContent = (regrasSala.nomesBanidos || {})[ccid] || 'Alguém';
    const b = document.createElement('button'); b.className = 'sec'; b.textContent = 'Deixar voltar';
    b.onclick = () => acaoAdmin('desbanir', null, { cid: ccid });
    linha.append(n, b); box.appendChild(linha);
  }
}
$('admGerar').onclick = async () => {
  const a = $('admNovaSenha').value, b = $('admNovaSenha2').value;
  if (a.length < 6) return toast('Use uma senha com pelo menos 6 caracteres.', 'aviso');
  if (a !== b) return toast('As duas senhas não são iguais.', 'aviso');
  $('admCodigo').value = await sha256(await chaveAdmin(a));
  $('admCodigoBox').classList.remove('oculto');
  $('admCodigo').select();
};
$('admEntrar').onclick = async () => {
  const sen = $('admSenha').value; if (!sen) return;
  const k = await chaveAdmin(sen);
  if (await sha256(k) !== ADMIN_HASH) { toast('Senha de admin errada.', 'erro'); return; }
  adminKey = k; salvar('adminKey', k); $('admSenha').value = '';
  enviarEstado(); toast('🛡️ Agora você é admin.');
};
$('admSenha').addEventListener('keydown', e => { if (e.key === 'Enter') $('admEntrar').click(); });
$('admSair').onclick = () => { adminKey = null; salvar('adminKey', ''); enviarEstado(); toast('Você saiu do modo admin.'); };
$('admDefinirSenha').onclick = async () => {
  const sen = $('admSenhaSala').value.trim(); if (!sen) return;
  const h = await hashSenhaSala(sala, sen);
  senhaSala = h;   // você também passa a "saber" a senha
  acaoAdmin('senha', null, { hash: h }); $('admSenhaSala').value = '';
  toast('🔒 Senha da sala definida. Passe para quem você quiser que entre.');
};
$('admRemoverSenha').onclick = () => acaoAdmin('senha', null, { hash: null });

/* ---- 🩺 diagnóstico de outra pessoa ---- */
// o admin pede; o navegador da pessoa gera o diagnóstico (avisando ela) e manda só para esse admin
const diagEsperando = new Map();   // id → hora do pedido
function pedirDiagnostico(m) {
  acaoAdmin('diagnostico', m.id);
  diagEsperando.set(m.id, Date.now());
  toast(`🩺 Pedi o diagnóstico de <b>${esc(m.nome)}</b>. Leva uns 15 segundos.`);
  setTimeout(() => {
    if (!diagEsperando.has(m.id)) return;
    diagEsperando.delete(m.id);
    const v = (membros.find(x => x.id === m.id) || {}).versao || 0;
    const org = regrasSala.organizador;   // quem organiza a sala; versões antigas não informam
    let porque = '';
    if (v < 39) porque = ` A Midori de ${esc(m.nome)} está desatualizada (v${v || '?'}): peça um Ctrl+F5.`;
    else if (!org || org.versao < 39) porque = ` Quem organiza a sala${org ? ` (<b>${esc(org.nome)}</b>, v${org.versao})` : ''} está com a Midori antiga, e o pedido passa por essa pessoa. Peça um Ctrl+F5${org ? ' para ela' : ' para todo mundo'}.`;
    toast(`🩺 ${esc(m.nome)} não respondeu.` + porque, 'aviso', 12000);
  }, 40000);
}
let gerandoParaAdmin = false;
async function responderDiagnostico(d) {
  if (gerandoParaAdmin || !hubConn || !hubConn.open) return;
  gerandoParaAdmin = true;
  toast(`🩺 <b>${esc(d.porNome || 'Um admin')}</b> pediu o seu diagnóstico de conexão. Ele vai só para essa pessoa e não inclui o seu IP.`, '', 7000);
  let texto;
  try { texto = await gerarDiagnostico(); } catch (e) { texto = 'O diagnóstico falhou: ' + (e.message || e); }
  gerandoParaAdmin = false;
  try { hubConn.send({ tipo: 'diagnostico', para: d.por, texto }); } catch (e) {}
}
function mostrarDiagnosticoDe(d) {
  diagEsperando.delete(d.id);
  $('diagTitulo').textContent = `🩺 Diagnóstico de ${d.nome}`;
  $('diagTexto').value = d.texto;
  $('telaDiag').classList.remove('oculto');
  $('diagTexto').scrollTop = 0;
}
$('diagCopiar').onclick = () => {
  navigator.clipboard.writeText($('diagTexto').value).then(() => toast('Diagnóstico copiado. É só colar.'),
    () => { $('diagTexto').select(); toast('Não deu para copiar sozinho: o texto ficou selecionado, use Ctrl+C.', 'aviso'); });
};
$('diagFechar').onclick = () => $('telaDiag').classList.add('oculto');
$('telaDiag').onclick = e => { if (e.target === $('telaDiag')) $('diagFechar').click(); };
