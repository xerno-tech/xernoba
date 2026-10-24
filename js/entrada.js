// Midori Xernoba — tela inicial: login com Discord, confirmação de 18+ e escolha de nome e sala
/* ---------- Login com Discord + 18+ ---------- */
const lerToken = t => { try { return JSON.parse(atob(t.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'))); } catch (e) { return null; } };
(function lerRetornoLogin() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('token')) salvar('token', h.get('token'));
  if (h.get('erro')) salvar('erroLogin', h.get('erro'));
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
})();
let tokenLogin = ler('token') || null;
const dadosLogin = () => { const d = tokenLogin && lerToken(tokenLogin); return d && d.exp > Date.now() ? d : null; };
const ERROS_LOGIN = {
  fora: 'Sua conta do Discord não está no servidor do grupo.',
  cancelado: 'Você cancelou o login no Discord.',
  estado: 'O login demorou demais. Tente de novo.',
  discord: 'O Discord não respondeu. Tente de novo.',
  sessao: 'Seu login venceu. Entre de novo.'
};
function mostrarPortao() {
  const precisaLogin = !!LOGIN_URL && !dadosLogin();
  const precisa18 = ler('maior18') !== '1';
  if (!precisaLogin && !precisa18) return false;
  $('entrada').classList.add('oculto'); $('portao').classList.remove('oculto');
  $('chk18').checked = !precisa18;
  $('btnDiscord').classList.toggle('oculto', !precisaLogin);
  $('btnSo18').classList.toggle('oculto', precisaLogin);
  const err = ler('erroLogin'); salvar('erroLogin', '');
  $('msgPortao').textContent = err ? (ERROS_LOGIN[err] || 'Não deu para entrar.') : (precisaLogin ? 'Só entra quem está no servidor do Discord do grupo.' : '');
  const atualizar = () => { $('btnDiscord').disabled = $('btnSo18').disabled = !$('chk18').checked; };
  $('chk18').onchange = atualizar; atualizar();
  return true;
}
$('btnDiscord').onclick = () => { salvar('maior18', '1'); location.href = LOGIN_URL + '/login'; };
$('btnSo18').onclick = () => { salvar('maior18', '1'); $('portao').classList.add('oculto'); $('entrada').classList.remove('oculto'); };
const bloqueadoPeloPortao = mostrarPortao();
if (!bloqueadoPeloPortao) $('entrada').classList.remove('oculto');
if (dadosLogin()) { $('infoDiscord').textContent = '✅ Conectado pelo Discord como ' + dadosLogin().nome; $('infoDiscord').classList.remove('oculto'); }

/* ---------- Entrada ---------- */
const params = new URLSearchParams(location.search);
$('inNome').value = ler('nome') || (dadosLogin() ? dadosLogin().nome.slice(0, 24) : '');
$('inSala').value = params.get('sala') || ler('sala') || '';
$('btnEntrar').onclick = () => {
  const nome = $('inNome').value.trim().slice(0, 24);
  const sala = limpar($('inSala').value);
  if (!nome) return $('inNome').focus();
  if (!sala) return $('inSala').focus();
  salvar('nome', nome); salvar('sala', sala);
  history.replaceState(null, '', location.pathname + '?sala=' + sala);
  entrar(nome, sala);
};
for (const id of ['inNome', 'inSala']) $(id).addEventListener('keydown', e => { if (e.key === 'Enter') $('btnEntrar').click(); });

/* =================== ADMIN (senha) =================== */
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const sha256 = async txt => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt)));
async function chaveAdmin(senha) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode('midori-xernoba-admin'), iterations: 150000 }, base, 256);
  return hex(bits);
}
const hashSenhaSala = (sala, senha) => sha256('midori-sala:' + sala + ':' + senha);
let cid = ler('cid'); if (!cid) { cid = Math.random().toString(36).slice(2) + Date.now().toString(36); salvar('cid', cid); }

const perfil = { cor: ler('cor') || null, emoji: ler('emoji') || null, foto: ler('foto') !== '0' };
// imagens no chat: arquivo enviado (data:) de até ~4 MB, ou link de um site conhecido de GIFs/imagens
const HOSTS_IMG = /^https:\/\/(media\d*\.giphy\.com|i\.giphy\.com|media\.tenor\.com|c\.tenor\.com|cdn\.discordapp\.com|media\.discordapp\.net|i\.imgur\.com)\/[^\s"'<>]+$/i;
function imagemValida(x) {
  if (typeof x !== 'string') return false;
  if (x.startsWith('data:')) return /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(x) && x.length < 4.2e6;
  return HOSTS_IMG.test(x) && x.length < 600;
}
const REACOES_MSG = ['👍', '😂', '❤️', '🔥', '😮', '😢'];
const REACOES = ['😂', '🔥', '😱', '👏', '❤️', '💀'];
