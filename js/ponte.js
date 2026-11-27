// Midori Xernoba — ponte pelo servidor
// Quando a ligação direta com o organizador da sala não abre (rede que bloqueia, 4G, CGNAT, sem TURN),
// a lista, o chat e os avisos da sala passam pelo servidor da Midori. As telas e a voz continuam diretas.

const PONTE_MAX = 300000;        // tamanho máximo de uma mensagem pela ponte (o servidor aceita até ~1 MB)
const pontesDe = new WeakMap();  // peer -> Map(chave -> PonteConn)

// tira as imagens coladas (data:) quando a mensagem é grande demais para a ponte
function caberNaPonte(d) {
  let s; try { s = JSON.stringify(d); } catch (e) { return null; }
  if (s.length <= PONTE_MAX) return d;
  const x = JSON.parse(s);
  const limpar = m => { if (m && typeof m.img === 'string' && m.img.startsWith('data:')) { m.img = null; m.texto = (m.texto ? m.texto + ' ' : '') + '[imagem]'; } };
  limpar(x); if (Array.isArray(x.msgs)) x.msgs.forEach(limpar);
  return JSON.stringify(x).length <= PONTE_MAX ? x : null;
}

function mandarPonte(p, dst, payload) {
  try {
    if (!p || p.destroyed || !p.socket) return false;
    p.socket.send({ type: 'MIDORI', dst, payload });
    return true;
  } catch (e) { return false; }
}

class PonteConn {
  constructor(p, remoto, chave) {
    this._p = p; this.peer = remoto; this._k = chave; this.open = false; this.ponte = true; this.metadata = null; this._ev = {};
    this._ultimo = Date.now();
  }
  on(tipo, f) { (this._ev[tipo] = this._ev[tipo] || []).push(f); return this; }
  _emit(tipo, x) { for (const f of this._ev[tipo] || []) try { f(x); } catch (e) { console.error(e); } }
  send(d) {
    if (!this.open) return;
    const c = caberNaPonte(d); if (c == null) return;
    mandarPonte(this._p, this.peer, { k: this._k, s: 'dado', d: c });
  }
  close() { this._fechar(true); }
  _fechar(avisar) {
    if (this._fechada) return;
    this._fechada = true; this.open = false;
    if (avisar) mandarPonte(this._p, this.peer, { k: this._k, s: 'fim' });
    const m = pontesDe.get(this._p); if (m && m.get(this._k) === this) m.delete(this._k);
    this._emit('close');
  }
}

// liga o ouvido da ponte num peer (uma vez só). aoAbrir: chamado quando alguém abre uma ponte comigo (organizador)
function ouvirPonte(p, aoAbrir) {
  if (!p || pontesDe.has(p)) return;
  const mapa = new Map(); pontesDe.set(p, mapa);
  p.socket.on('message', msg => {
    if (!msg || msg.type !== 'MIDORI' || !msg.src || !msg.payload) return;
    const { k, s, d } = msg.payload; if (typeof k !== 'string' || k.length > 40) return;
    let c = mapa.get(k);
    if (s === 'abrir') {
      if (!aoAbrir || c) return;
      c = new PonteConn(p, String(msg.src), k); c.open = true; mapa.set(k, c);
      mandarPonte(p, c.peer, { k, s: 'ok' });
      aoAbrir(c); c._emit('open');
      return;
    }
    if (!c || c.peer !== msg.src) return;
    c._ultimo = Date.now();
    if (s === 'ok' && !c.open) { c.open = true; c._emit('open'); }
    else if (s === 'dado' && c.open) c._emit('data', d);
    else if (s === 'fim') c._fechar(false);
  });
}

// abre uma ponte com o organizador; o resto do código usa como se fosse uma ligação normal
function abrirPonte(p, dst) {
  ouvirPonte(p, null);
  const k = Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
  const c = new PonteConn(p, dst, k);
  pontesDe.get(p).set(k, c);
  mandarPonte(p, dst, { k, s: 'abrir' });
  return c;
}
