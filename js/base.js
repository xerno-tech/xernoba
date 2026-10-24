// Midori Xernoba — funções básicas: atalhos, armazenamento, avisos, botão do olho e aviso de versão nova
const $ = id => document.getElementById(id);
async function conferirVersao() {
  try {
    const txt = await fetch(location.pathname + '?v=' + Date.now(), { cache: 'no-store' }).then(r => r.text());
    const m = txt.match(/const VERSAO = (\d+);/);
    if (m && Number(m[1]) > VERSAO) document.getElementById('faixaVersao').classList.remove('oculto');
  } catch (e) {}
}
setInterval(conferirVersao, 5 * 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) conferirVersao(); });
setTimeout(conferirVersao, 15000);
const salvar = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
const ler = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const limpar = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
const sdpEstereo = sdp => sdp.replace(/useinbandfec=1/g, 'useinbandfec=1;stereo=1;sprop-stereo=1;maxaveragebitrate=192000');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const corDe = s => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return `hsl(${h} 55% 45%)`; };

/* ---------- Avisos ---------- */
function toast(msg, tipo = '', ms = 6000) {
  const t = document.createElement('div');
  t.className = 'toast ' + tipo; t.innerHTML = msg;
  $('toasts').appendChild(t);
  setTimeout(() => t.remove(), ms);
}

/* ---------- Olho ---------- */
const olho = $('olho');
const ICON_ABERTO = '<svg viewBox="0 0 24 24"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const ICON_FECHADO = '<svg viewBox="0 0 24 24"><path d="M17.9 17.9A10.8 10.8 0 0 1 12 19c-7 0-11-7-11-7a19.6 19.6 0 0 1 5.1-5.9M9.9 5.2A9.7 9.7 0 0 1 12 5c7 0 11 7 11 7a19.7 19.7 0 0 1-2.2 3.2M14.1 14.1a3 3 0 1 1-4.2-4.2"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
let ui = ler('interface') !== 'off';
function atualizarOlho() { olho.innerHTML = ui ? ICON_ABERTO : ICON_FECHADO; olho.title = ui ? 'Esconder interface' : 'Mostrar interface'; document.body.classList.toggle('limpo', !ui); }
olho.onclick = () => { ui = !ui; salvar('interface', ui ? 'on' : 'off'); atualizarOlho(); };
let tOlho;
document.addEventListener('mousemove', () => {
  olho.classList.remove('sumido'); clearTimeout(tOlho);
  if (!ui) tOlho = setTimeout(() => olho.classList.add('sumido'), 2500);
});
atualizarOlho();


function seg(id, attr, atual, onSel) {
  document.querySelectorAll(`#${id} button`).forEach(b => {
    b.classList.toggle('sel', b.dataset[attr] === atual);
    b.onclick = () => { onSel(b.dataset[attr]); document.querySelectorAll(`#${id} button`).forEach(x => x.classList.toggle('sel', x === b)); };
  });
}
