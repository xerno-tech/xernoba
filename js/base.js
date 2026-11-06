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
// Formato de vídeo da transmissão: o primeiro que o Chrome desta pessoa comprime na PLACA DE VÍDEO.
// O Chrome não deixa o site mandar usar a placa; o que dá é perguntar qual formato vai pela placa
// (MediaCapabilities → powerEfficient) e colocar esse na frente da lista. Sem nenhum pela placa, fica o H.264,
// que é o mais leve no processador.
let codecTransmissao = 'H264', codecNaPlaca = null;   // null = ainda não sei; false = nenhum vai pela placa
async function escolherCodec() {
  const mc = navigator.mediaCapabilities;
  if (!mc || !mc.encodingInfo) return;
  const [w, h] = [1280, 720];
  for (const c of ['H264', 'VP9', 'AV1', 'VP8']) {
    try {
      const r = await mc.encodingInfo({ type: 'webrtc', video: { contentType: 'video/' + c, width: w, height: h, bitrate: 6e6, framerate: 60 } });
      if (r && r.supported && r.powerEfficient) { codecTransmissao = c; codecNaPlaca = c; return; }
    } catch (e) {}
  }
  codecNaPlaca = false;
}
escolherCodec();
// coloca o formato escolhido na frente; os outros continuam na lista, para quem não tiver esse
function sdpCodec(sdp, codec) {
  const linhas = sdp.split('\r\n');
  const iM = linhas.findIndex(l => l.startsWith('m=video '));
  if (iM < 0) return sdp;
  let fim = linhas.findIndex((l, i) => i > iM && l.startsWith('m='));
  if (fim < 0) fim = linhas.length;
  const secao = linhas.slice(iM, fim).join('\n');
  const pts = [...secao.matchAll(new RegExp(`^a=rtpmap:(\\d+) ${codec}/90000`, 'gm'))].map(m => m[1]);
  if (!pts.length) return sdp;
  if (codec === 'H264') {
    const nota = pt => { const f = (secao.match(new RegExp(`^a=fmtp:${pt} (.*)$`, 'm')) || [])[1] || '';
      return (/packetization-mode=1/.test(f) ? 0 : 2) + (/profile-level-id=42e0/.test(f) ? 0 : 1); };   // o mais compatível primeiro
    pts.sort((a, b) => nota(a) - nota(b));
  }
  const partes = linhas[iM].split(' ');
  linhas[iM] = [...partes.slice(0, 3), ...pts, ...partes.slice(3).filter(p => !pts.includes(p))].join(' ');
  return linhas.join('\r\n');
}
// quem transmite usa o formato dele; quem assiste responde com o formato que veio no pedido de quem transmite
const sdpTransmissao = sdp => sdpCodec(sdpEstereo(sdp), codecTransmissao);
const sdpAssistir = codec => sdp => sdpCodec(sdpEstereo(sdp), /^(H264|VP8|VP9|AV1)$/.test(codec || '') ? codec : 'H264');
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
