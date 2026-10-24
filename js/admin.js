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
