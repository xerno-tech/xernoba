// Midori Xernoba — janela de ajustes: perfil, sons e avisos, layout
/* =================== PERFIL, SONS E LAYOUT =================== */
const CORES = ['#2fbf71', '#16a3a3', '#3b82f6', '#8b5cf6', '#ec4899', '#ef4444', '#f59e0b', '#64748b'];
const EMOJIS = ['🍃', '🎮', '🐸', '🐱', '🦊', '🐼', '👾', '🔥', '⚡', '🌙', '🍕', '👑'];
function clarear(hex) {
  const n = parseInt(hex.slice(1), 16), c = v => Math.min(255, Math.round(v + (255 - v) * .35));
  return `rgb(${c(n >> 16)}, ${c((n >> 8) & 255)}, ${c(n & 255)})`;
}
function avatarHTML(m, extra = '') {
  const cor = m.cor || corDe(m.nome);
  const dentro = m.emoji ? esc(m.emoji) : esc((m.nome || '?').charAt(0).toUpperCase());
  const foto = m.foto && /^https:\/\/cdn\.discordapp\.com\/avatars\/\d+\/\w+\.png\?size=64$/.test(m.foto) ? m.foto : null;
  const estilo = foto ? `background:${cor} url('${foto}')` : `background:${cor}`;
  return `<div class="avatar ${extra} ${!foto && m.emoji ? 'emoji' : ''} ${foto ? 'foto' : ''}" data-av="${esc(m.id || '')}" style="${estilo}">${dentro}</div>`;
}

// ---- sons (gerados na hora, sem arquivos) ----
const sons = Object.assign({ sala: true, msg: true, live: true, voz: true }, JSON.parse(ler('sons') || '{}'));
let volSom = Number(ler('volSom') || '0.5');
let notif = ler('notif') === '1';
let ctxSom = null;
const NOTAS = { entrou: [660, 880], saiu: [660, 440], msg: [988], live: [523, 659, 784], voz: [740, 988], teste: [523, 784], mencao: [1047, 784, 1047, 1319] };
function tocar(tipo) {
  if (volSom <= 0) return;
  try {
    ctxSom = ctxSom || new AudioContext();
    ctxSom.resume().catch(() => {});
    const t0 = ctxSom.currentTime;
    (NOTAS[tipo] || NOTAS.msg).forEach((f, i) => {
      const o = ctxSom.createOscillator(), g = ctxSom.createGain();
      o.type = 'sine'; o.frequency.value = f;
      const ini = t0 + i * 0.09;
      g.gain.setValueAtTime(0, ini);
      g.gain.linearRampToValueAtTime(0.18 * volSom, ini + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, ini + 0.22);
      o.connect(g).connect(ctxSom.destination);
      o.start(ini); o.stop(ini + 0.25);
    });
  } catch (e) {}
}
const GRUPO = { entrou: 'sala', saiu: 'sala', msg: 'msg', live: 'live', voz: 'voz' };
// menção: toca sempre (a não ser que o volume esteja no zero) e avisa no Windows se a aba estiver escondida
function avisarMencao(m) {
  tocar('mencao');
  if (notif && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    try { const n = new Notification(m.nome + ' te mencionou', { body: m.texto, tag: 'midori-mencao', silent: true }); n.onclick = () => { window.focus(); n.close(); }; } catch (e) {}
  }
}
function avisarEvento(m) {
  const grupo = GRUPO[m.evento];
  if (!grupo || m.alvo === euId) return;   // não toca para as suas próprias ações
  if (sons[grupo]) tocar(m.evento);
  if (notif && document.hidden && (grupo === 'msg' || grupo === 'live') && 'Notification' in window && Notification.permission === 'granted') {
    try {
      const n = new Notification(grupo === 'msg' ? m.nome : 'Midori Xernoba', { body: m.texto, tag: 'midori-' + grupo, silent: true });
      n.onclick = () => { window.focus(); n.close(); };
    } catch (e) {}
  }
}

// ---- layout ----
let layout = ler('layout') || 'grade';
let mostrarChat = ler('chat') !== '0';
// Flex-Grid: testa quantas colunas deixam cada tela (16:9) o maior possível
function arrumarFlex() {
  const g = $('grade'), telas = [...g.querySelectorAll('.tela')];
  if (layout !== 'flex') { telas.forEach(t => { t.style.width = t.style.height = ''; }); return; }
  const n = telas.length; if (!n) return;
  const cs = getComputedStyle(g), gap = parseFloat(cs.columnGap || cs.gap) || 10;
  const W = g.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 1;
  const H = g.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - 1;
  let melhor = 0;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const w = Math.min((W - gap * (cols - 1)) / cols, ((H - gap * (rows - 1)) / rows) * 16 / 9);
    if (w > melhor) melhor = w;
  }
  melhor = Math.max(120, Math.floor(melhor));
  telas.forEach(t => { t.style.width = melhor + 'px'; t.style.height = Math.floor(melhor * 9 / 16) + 'px'; });
}
new ResizeObserver(() => arrumarFlex()).observe($('grade'));
function aplicarLayout() {
  $('grade').classList.toggle('flex', layout === 'flex');
  $('grade').classList.toggle('destaque', layout === 'destaque');
  arrumarFlex();
  document.body.classList.toggle('semChat', !mostrarChat);
  document.querySelectorAll('#ajLayout button').forEach(b => b.classList.toggle('sel', b.dataset.l === layout));
  atualizarFoco();
}

// ---- janela de ajustes ----
function abrirAba(aba) {
  document.querySelectorAll('.abas button').forEach(b => b.classList.toggle('sel', b.dataset.aba === aba));
  document.querySelectorAll('[data-painel]').forEach(p => p.classList.toggle('oculto', p.dataset.painel !== aba));
}
function desenharPerfil() {
  const eu = { id: '', nome, cor: perfil.cor, emoji: perfil.emoji };
  const prev = $('prevAvatar');
  prev.outerHTML = avatarHTML(eu).replace('<div class="avatar', '<div id="prevAvatar" class="avatar');
  $('prevNome').textContent = nome;
  const atualCor = perfil.cor || corDe(nome);
  $('ajCores').innerHTML = '';
  for (const c of CORES) {
    const b = document.createElement('button'); b.style.background = c; b.title = c;
    if (c === atualCor) b.className = 'sel';
    b.onclick = () => { perfil.cor = c; salvar('cor', c); desenharPerfil(); enviarEstado(); };
    $('ajCores').appendChild(b);
  }
  $('ajEmojis').innerHTML = '';
  const semEmoji = document.createElement('button'); semEmoji.textContent = 'Aa'; semEmoji.title = 'Usar a inicial';
  if (!perfil.emoji) semEmoji.className = 'sel';
  semEmoji.onclick = () => { perfil.emoji = null; salvar('emoji', ''); desenharPerfil(); enviarEstado(); };
  $('ajEmojis').appendChild(semEmoji);
  for (const e of EMOJIS) {
    const b = document.createElement('button'); b.textContent = e;
    if (e === perfil.emoji) b.className = 'sel';
    b.onclick = () => { perfil.emoji = e; salvar('emoji', e); desenharPerfil(); enviarEstado(); };
    $('ajEmojis').appendChild(b);
  }
}
// refaz o login no Discord (pega foto e nome novos) e volta para esta mesma sala
$('ajRelogar').onclick = () => { saindo = true; location.href = LOGIN_URL + '/login'; };
$('ajFoto').onchange = () => { perfil.foto = $('ajFoto').checked; salvar('foto', perfil.foto ? '1' : '0'); enviarEstado(); };
$('btnAjustes').onclick = () => {
  $('ajFoto').checked = perfil.foto;
  $('ajFoto').parentElement.classList.toggle('oculto', !LOGIN_URL);
  $('ajDiscordBox').classList.toggle('oculto', !LOGIN_URL);
  $('ajNome').value = nome;
  desenharPerfil();
  document.querySelectorAll('[data-som]').forEach(c => c.checked = !!sons[c.dataset.som]);
  $('ajVolSom').value = volSom;
  $('ajNotif').checked = notif && 'Notification' in window && Notification.permission === 'granted';
  $('ajTtsOuvir').checked = ttsOuvir; $('ajTtsAoVivo').checked = ttsAoVivo; $('ajTtsVol').value = ttsVol; $('ajTtsVel').value = ttsVel; preencherVozes();
  $('ajChat').checked = mostrarChat;
  $('ajMuteMini').checked = muteMini;
  $('ajClipes').checked = clipesLigados;
  atualizarAdminUI();
  aplicarLayout();
  $('ajustes').classList.remove('oculto');
};
$('fecharAjustes').onclick = () => $('ajustes').classList.add('oculto');
$('ajustes').onclick = e => { if (e.target === $('ajustes')) $('ajustes').classList.add('oculto'); };
document.querySelectorAll('.abas button').forEach(b => b.onclick = () => abrirAba(b.dataset.aba));
$('ajSalvarNome').onclick = () => {
  const novo = $('ajNome').value.trim().slice(0, 24);
  if (!novo || novo === nome) return;
  nome = novo; salvar('nome', nome);
  if (telaLocal) telaLocal.querySelector('.n').textContent = nome;
  desenharPerfil(); enviarEstado();
  toast('Nome trocado para <b>' + esc(nome) + '</b>.');
};
$('ajNome').addEventListener('keydown', e => { if (e.key === 'Enter') $('ajSalvarNome').click(); });
document.querySelectorAll('[data-som]').forEach(c => c.onchange = () => { sons[c.dataset.som] = c.checked; salvar('sons', JSON.stringify(sons)); });
$('ajVolSom').oninput = () => { volSom = Number($('ajVolSom').value); salvar('volSom', volSom); };
$('ajVolSom').onchange = () => tocar('teste');
$('ajTestarSom').onclick = () => tocar('teste');
$('ajTtsOuvir').onchange = () => { ttsOuvir = $('ajTtsOuvir').checked; salvar('ttsOuvir', ttsOuvir ? '1' : '0'); if (!ttsOuvir && temTts) speechSynthesis.cancel(); };
$('ajTtsAoVivo').onchange = () => { ttsAoVivo = $('ajTtsAoVivo').checked; salvar('ttsAoVivo', ttsAoVivo ? '1' : '0'); };
$('ajTtsVoz').onchange = () => { ttsVoz = $('ajTtsVoz').value; salvar('ttsVoz', ttsVoz); };
$('ajTtsVol').oninput = () => { ttsVol = Number($('ajTtsVol').value); salvar('ttsVol', ttsVol); };
$('ajTtsVel').oninput = () => { ttsVel = Number($('ajTtsVel').value); salvar('ttsVel', ttsVel); };
$('ajTtsTestar').onclick = () => { if (!temTts) return toast('Este navegador não tem leitura em voz alta.', 'aviso'); speechSynthesis.cancel(); falar(`${nome}: testando a voz da Midori Xernoba`); };
$('ajNotif').onchange = async () => {
  if ($('ajNotif').checked) {
    if (!('Notification' in window)) { toast('Este navegador não tem notificações.', 'aviso'); $('ajNotif').checked = false; return; }
    const r = await Notification.requestPermission();
    if (r !== 'granted') { toast('As notificações foram bloqueadas. Libere no cadeado ao lado do endereço.', 'aviso'); $('ajNotif').checked = false; return; }
  }
  notif = $('ajNotif').checked; salvar('notif', notif ? '1' : '0');
};
document.querySelectorAll('#ajLayout button').forEach(b => b.onclick = () => { layout = b.dataset.l; salvar('layout', layout); aplicarLayout(); });
$('ajChat').onchange = () => { mostrarChat = $('ajChat').checked; salvar('chat', mostrarChat ? '1' : '0'); aplicarLayout(); };
$('ajClipes').onchange = () => {
  clipesLigados = $('ajClipes').checked; salvar('clipes', clipesLigados ? '1' : '0');
  for (const it of assistindo.values()) { const v = it.tela.querySelector('video'); if (clipesLigados && v.srcObject) iniciarGravador(it.tela, v.srcObject); else pararGravador(it.tela); }
};
$('ajMuteMini').onchange = () => { muteMini = $('ajMuteMini').checked; salvar('muteMini', muteMini ? '1' : '0'); };
aplicarLayout();

// ---- tamanho do texto do chat e largura da barra lateral ----
const raiz = document.documentElement.style;
let fonteChat = ler('fonteChat') || '15';
raiz.setProperty('--fonteChat', fonteChat + 'px');
seg('segFonte', 't', fonteChat, v => { fonteChat = v; salvar('fonteChat', v); raiz.setProperty('--fonteChat', v + 'px'); });
const largSalva = Number(ler('larguraLateral'));
if (largSalva) raiz.setProperty('--larguraLateral', largSalva + 'px');
(() => {
  const alca = $('alcaLateral');
  let ini = 0, largIni = 0;
  const mover = e => {
    const w = Math.max(240, Math.min(Math.min(560, innerWidth * 0.5), largIni + (e.clientX - ini)));
    raiz.setProperty('--larguraLateral', w + 'px');
  };
  const soltar = () => {
    alca.classList.remove('arrastando'); document.body.style.userSelect = '';
    removeEventListener('pointermove', mover); removeEventListener('pointerup', soltar);
    salvar('larguraLateral', Math.round($('membros').getBoundingClientRect().width));
  };
  alca.addEventListener('pointerdown', e => {
    e.preventDefault(); ini = e.clientX; largIni = $('membros').getBoundingClientRect().width;
    alca.classList.add('arrastando'); document.body.style.userSelect = 'none';
    addEventListener('pointermove', mover); addEventListener('pointerup', soltar);
  });
  alca.addEventListener('dblclick', () => { raiz.setProperty('--larguraLateral', '320px'); salvar('larguraLateral', ''); });
})();

// ---- 📶 Conexão: registro de quedas ----
const horaSeg = ts => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
function mostrarRegistroConexao() {
  const el = $('registroConexao'); if (!el) return;
  el.innerHTML = registroConexao.length
    ? registroConexao.slice().reverse().map(x => `<div><span class="mut">${horaSeg(x.ts)}</span> ${esc(x.texto)}</div>`).join('')
    : '<div class="mut">Nenhuma queda até agora. 👍</div>';
}
mostrarRegistroConexao();
$('ajCopiarRegistro').onclick = () => {
  const txt = `Midori v${VERSAO} · ${navigator.userAgent}\n` + registroConexao.map(x => `${horaSeg(x.ts)} ${x.texto}`).join('\n');
  navigator.clipboard.writeText(txt).then(() => toast('Registro copiado.'), () => toast('Não deu para copiar.', 'erro'));
};
