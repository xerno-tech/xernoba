// Midori Xernoba — servidor de login com Discord (Cloudflare Worker)
//
// Confere se a pessoa está no servidor do Discord do grupo e entrega uma
// "pulseira" (token assinado) que vale 7 dias. A Midori confere a pulseira
// de cada pessoa aqui antes de deixar entrar numa sala.
//
// Configuração no Cloudflare (Worker → Settings → Variables and Secrets):
//   SITE_URL              (texto)   endereço da Midori, ex.: https://xerno-tech.github.io/xernoba/
//   DISCORD_CLIENT_ID     (texto)   Client ID do app no Discord
//   DISCORD_GUILD_ID      (texto)   ID do servidor do Discord (vários: separe por vírgula)
//   DISCORD_CLIENT_SECRET (secret)  Client Secret do app no Discord — nunca vai para o GitHub
//
// Também é o servidor de conexão da Midori (no lugar do servidor grátis do PeerJS):
// cada pessoa abre uma ligação contínua aqui, e o servidor só repassa os recados
// para as pessoas se acharem. As telas, a voz e o chat continuam indo direto
// de uma pessoa para a outra. Publicado pelo GitHub Actions (login/wrangler.toml).

import { DurableObject } from 'cloudflare:workers';

const DIAS = 7;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const site = env.SITE_URL;
    const origem = new URL(site).origin;
    const cors = {
      'Access-Control-Allow-Origin': origem,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Expose-Headers': 'content-type',
      'Access-Control-Allow-Headers': 'content-type',
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

    // retransmissão (TURN): credenciais de 24 h geradas pelo Cloudflare, só para quem está logado
    if (url.pathname === '/turn' && req.method === 'POST') {
      let corpo = {}; try { corpo = await req.json(); } catch (e) {}
      if (!(await conferir(String(corpo.token || ''), env.DISCORD_CLIENT_SECRET))) return Response.json({ iceServers: [] }, { headers: cors });
      if (!env.TURN_KEY_ID || !env.TURN_KEY_TOKEN) return Response.json({ iceServers: [], semTurn: true }, { headers: cors });
      try {
        const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
          method: 'POST', headers: { Authorization: 'Bearer ' + env.TURN_KEY_TOKEN, 'content-type': 'application/json' }, body: JSON.stringify({ ttl: 86400 }),
        });
        const j = await r.json();
        // a porta 53 é bloqueada pelos navegadores: tira para não atrasar a conexão
        const ice = (j.iceServers || []).map(sv => ({ ...sv, urls: [].concat(sv.urls).filter(u => !/:53(\?|$)/.test(u)) })).filter(sv => sv.urls.length);
        return Response.json({ iceServers: ice }, { headers: cors });
      } catch (e) { return Response.json({ iceServers: [], erro: true }, { headers: cors }); }
    }

    // busca de jogos (para "O que você vai jogar?"): IGDB se tiver as chaves da Twitch, senão a loja da Steam
    if (url.pathname === '/jogos' && req.method === 'POST') {
      let corpo = {}; try { corpo = await req.json(); } catch (e) {}
      if (!(await conferir(String(corpo.token || ''), env.DISCORD_CLIENT_SECRET))) return Response.json({ ok: false }, { headers: cors });
      const q = String(corpo.q || '').trim().slice(0, 60);
      if (q.length < 2) return Response.json({ ok: true, jogos: [] }, { headers: cors });
      const chaveCache = new Request('https://jogos.midori/' + (env.IGDB_CLIENT_ID ? 'igdb/' : 'steam/') + encodeURIComponent(q.toLowerCase()));
      const guardado = await caches.default.match(chaveCache);
      if (guardado) return new Response(guardado.body, { headers: { ...cors, 'content-type': 'application/json' } });
      let jogos = [];
      try { jogos = env.IGDB_CLIENT_ID && env.IGDB_CLIENT_SECRET ? await buscarIgdb(q, env) : await buscarSteam(q); } catch (e) {}
      const resp = JSON.stringify({ ok: true, jogos, fonte: env.IGDB_CLIENT_ID ? 'igdb' : 'steam' });
      if (jogos.length) await caches.default.put(chaveCache, new Response(resp, { headers: { 'content-type': 'application/json', 'cache-control': 'max-age=86400' } }));
      return new Response(resp, { headers: { ...cors, 'content-type': 'application/json' } });
    }

    // dados guardados da galera: histórico do chat, figurinhas e estatísticas (só para quem está logado)
    if (url.pathname.startsWith('/dados/') && req.method === 'POST') {
      let corpo = {}; try { corpo = await req.json(); } catch (e) { return Response.json({ ok: false }, { status: 400, headers: cors }); }
      const quem = await conferir(String(corpo.token || ''), env.DISCORD_CLIENT_SECRET);
      if (!quem) return Response.json({ ok: false, erro: 'login' }, { status: 401, headers: cors });
      const r = await env.DADOS.get(env.DADOS.idFromName('midori')).fetch('https://dados' + url.pathname.slice(6), {
        method: 'POST', body: JSON.stringify({ ...corpo, token: undefined, eu: { id: quem.id, nome: quem.nome } }),
      });
      const h = new Headers(r.headers); for (const [k, v] of Object.entries(cors)) h.set(k, v);
      return new Response(r.body, { status: r.status, headers: h });
    }

    // servidor de conexão (protocolo do PeerJS)
    if (url.pathname === '/peerjs/id') return new Response(crypto.randomUUID(), { headers: { 'Access-Control-Allow-Origin': origem, 'content-type': 'text/plain' } });
    if (url.pathname === '/peerjs/peers') return Response.json([], { headers: { 'Access-Control-Allow-Origin': origem } });
    if (url.pathname === '/peerjs') {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('Esperava uma ligação WebSocket', { status: 426 });
      const de = req.headers.get('Origin');
      if (de && de !== origem) return new Response('Origem não permitida', { status: 403 });
      return env.SINAL.get(env.SINAL.idFromName('midori')).fetch(req);
    }

    const callback = url.origin + '/callback';

    // 1) manda a pessoa para a tela de autorização do Discord
    if (url.pathname === '/login') {
      const state = crypto.randomUUID();
      const auth = new URL('https://discord.com/oauth2/authorize');
      auth.search = new URLSearchParams({
        client_id: env.DISCORD_CLIENT_ID, response_type: 'code', redirect_uri: callback,
        scope: 'identify guilds', state, prompt: 'none',
      });
      return new Response(null, {
        status: 302,
        headers: { Location: auth.toString(), 'Set-Cookie': `st=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600` },
      });
    }

    // 2) o Discord devolve a pessoa aqui: confere o servidor e entrega a pulseira
    if (url.pathname === '/callback') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const cookie = (req.headers.get('cookie') || '').match(/(?:^|;\s*)st=([^;]+)/);
      if (url.searchParams.get('error')) return voltar(site, 'erro=cancelado');
      if (!code || !cookie || cookie[1] !== state) return voltar(site, 'erro=estado');

      const tr = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET,
          grant_type: 'authorization_code', code, redirect_uri: callback,
        }),
      });
      if (!tr.ok) return voltar(site, 'erro=discord');
      const { access_token } = await tr.json();
      const h = { Authorization: 'Bearer ' + access_token };
      const [eu, servidores] = await Promise.all([
        fetch('https://discord.com/api/users/@me', { headers: h }).then(r => r.json()),
        fetch('https://discord.com/api/users/@me/guilds', { headers: h }).then(r => r.json()),
      ]);
      const permitidos = String(env.DISCORD_GUILD_ID || '').split(',').map(s => s.trim()).filter(Boolean);
      if (!Array.isArray(servidores) || !servidores.some(g => permitidos.includes(g.id))) return voltar(site, 'erro=fora');

      const dados = { id: eu.id, nome: eu.global_name || eu.username, avatar: eu.avatar || null, exp: Date.now() + DIAS * 864e5 };
      const pulseira = await assinar(dados, env.DISCORD_CLIENT_SECRET);
      return voltar(site, 'token=' + encodeURIComponent(pulseira));
    }

    // 3) a Midori pergunta se uma pulseira é válida
    if (url.pathname === '/verificar' && req.method === 'POST') {
      let token = '';
      try { token = String((await req.json()).token || ''); } catch (e) {}
      const dados = await conferir(token, env.DISCORD_CLIENT_SECRET);
      return Response.json(dados ? { ok: true, id: dados.id, nome: dados.nome, avatar: dados.avatar || null, exp: dados.exp } : { ok: false }, { headers: cors });
    }

    // 4) prévia de links do chat (título, descrição e imagem), só para quem está logado
    if (url.pathname === '/preview' && req.method === 'POST') {
      let corpo = {};
      try { corpo = await req.json(); } catch (e) {}
      if (!(await conferir(String(corpo.token || ''), env.DISCORD_CLIENT_SECRET))) return Response.json({ ok: false }, { headers: cors });
      let alvo;
      try { alvo = new URL(String(corpo.url || '')); } catch (e) { return Response.json({ ok: false }, { headers: cors }); }
      if (!/^https?:$/.test(alvo.protocol) || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(alvo.hostname)) return Response.json({ ok: false }, { headers: cors });

      const cache = caches.default;
      const chaveCache = new Request('https://preview.midori/' + encodeURIComponent(alvo.href));
      const guardado = await cache.match(chaveCache);
      if (guardado) return new Response(guardado.body, { headers: { ...cors, 'content-type': 'application/json' } });

      let info = { ok: false };
      try {
        const r = await fetch(alvo.href, {
          headers: { 'user-agent': 'Mozilla/5.0 (compatible; MidoriXernobaPreview/1.0)', accept: 'text/html,*/*;q=0.5', 'accept-language': 'pt-BR,pt;q=0.9,en;q=0.6' },
          redirect: 'follow', signal: AbortSignal.timeout(5000),
        });
        if (r.ok && /text\/html/i.test(r.headers.get('content-type') || '')) {
          const html = await lerInicio(r, 400000);
          const meta = nome => {
            const re = new RegExp(`<meta[^>]+(?:property|name)=["']${nome}["'][^>]*>`, 'i');
            const tag = (html.match(re) || [])[0]; if (!tag) return '';
            return entidades(((tag.match(/content=["']([^"']*)["']/i) || [])[1] || '').trim());
          };
          const titulo = meta('og:title') || meta('twitter:title') || entidades(((html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '').trim());
          let imagem = meta('og:image') || meta('og:image:url') || meta('twitter:image');
          const final = r.url || alvo.href;   // endereço depois de redirecionamentos
          try { imagem = imagem ? new URL(imagem, final).href : ''; } catch (e) { imagem = ''; }
          if (!/^https:/.test(imagem)) imagem = '';
          if (titulo) info = {
            ok: true, url: final,
            site: (meta('og:site_name') || new URL(final).hostname.replace(/^www\./, '')).slice(0, 60),
            titulo: titulo.slice(0, 200), descricao: (meta('og:description') || meta('description') || meta('twitter:description')).slice(0, 300),
            imagem: imagem.slice(0, 1000), cor: (meta('theme-color') || '').slice(0, 20),
          };
        }
      } catch (e) {}
      const resp = JSON.stringify(info);
      await cache.put(chaveCache, new Response(resp, { headers: { 'content-type': 'application/json', 'cache-control': `max-age=${info.ok ? 86400 : 3600}` } }));
      return new Response(resp, { headers: { ...cors, 'content-type': 'application/json' } });
    }

    return new Response('Midori Xernoba — login com Discord. Está funcionando.', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  },
};

const voltar = (site, fragmento) => Response.redirect(site + '#' + fragmento, 302);

// lê só o começo da página (onde ficam as informações de prévia)
async function lerInicio(resp, limite) {
  const leitor = resp.body.getReader(); const dec = new TextDecoder(); let txt = '';
  while (txt.length < limite) {
    const { value, done } = await leitor.read(); if (done) break;
    txt += dec.decode(value, { stream: true });
    if (/<\/head>/i.test(txt)) break;
  }
  try { leitor.cancel(); } catch (e) {}
  return txt;
}
const entidades = s => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));

const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const deB64 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const chave = segredo => crypto.subtle.importKey('raw', new TextEncoder().encode('midori:' + segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

async function assinar(dados, segredo) {
  const corpo = b64(new TextEncoder().encode(JSON.stringify(dados)));
  const ass = await crypto.subtle.sign('HMAC', await chave(segredo), new TextEncoder().encode(corpo));
  return corpo + '.' + b64(ass);
}

async function conferir(token, segredo) {
  const [corpo, ass] = token.split('.');
  if (!corpo || !ass) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await chave(segredo), deB64(ass), new TextEncoder().encode(corpo));
    if (!ok) return null;
    const dados = JSON.parse(new TextDecoder().decode(deB64(corpo)));
    return dados.exp > Date.now() ? dados : null;
  } catch (e) { return null; }
}

// ---- servidor de conexão: um só "quadro de recados" para todo mundo ----
// Usa WebSockets que hibernam: o Cloudflare só cobra quando chega recado.
const SEM_SINAL = 60000;   // quem fica 1 min sem dar sinal perde o nome (o PeerJS manda sinal a cada 5 s)
export class Sinal extends DurableObject {
  async fetch(req) {
    const url = new URL(req.url);
    const id = url.searchParams.get('id') || '', token = url.searchParams.get('token') || '';
    const [cliente, servidor] = Object.values(new WebSocketPair());
    const recusar = (tipo, msg) => {
      servidor.accept();
      servidor.send(JSON.stringify({ type: tipo, payload: { msg } }));
      servidor.close(1008, msg);
      return new Response(null, { status: 101, webSocket: cliente });
    };
    if (url.searchParams.get('key') !== 'peerjs') return recusar('INVALID-KEY', 'Chave inválida');
    if (!/^[\w-]{1,64}$/.test(id) || !token) return recusar('ERROR', 'Faltou o id ou o token');
    // o nome já está em uso? se for a mesma pessoa voltando (mesmo token) ou uma ligação morta, troca
    for (const w of this.ctx.getWebSockets(id)) {
      const a = w.deserializeAttachment() || {};
      if (a.token === token || Date.now() - (a.visto || 0) > SEM_SINAL) { try { w.close(1000, 'trocado'); } catch (e) {} }
      else return recusar('ID-TAKEN', 'ID is taken');
    }
    this.ctx.acceptWebSocket(servidor, [id]);
    servidor.serializeAttachment({ id, token, visto: Date.now() });
    servidor.send(JSON.stringify({ type: 'OPEN' }));
    return new Response(null, { status: 101, webSocket: cliente });
  }

  async webSocketMessage(ws, msg) {
    const a = ws.deserializeAttachment(); if (!a) return;
    a.visto = Date.now(); ws.serializeAttachment(a);
    let d; try { d = JSON.parse(msg); } catch (e) { return; }
    if (!d || d.type === 'HEARTBEAT' || typeof d.type !== 'string' || !d.dst) return;
    const dst = String(d.dst);
    const alvo = this.ctx.getWebSockets(dst).filter(w => w.readyState === 1).pop();
    if (alvo) { try { alvo.send(JSON.stringify({ type: d.type, src: a.id, dst, payload: d.payload })); return; } catch (e) {} }
    // ninguém com esse nome: avisa quem mandou (é assim que a Midori descobre que a sala não tem organizador)
    if (d.type === 'OFFER') ws.send(JSON.stringify({ type: 'EXPIRE', src: dst, dst: a.id }));
  }

  async webSocketClose(ws, code) { try { ws.close(code === 1005 || code === 1006 ? 1000 : code, 'tchau'); } catch (e) {} }
  async webSocketError(ws) { try { ws.close(1011, 'erro'); } catch (e) {} }
}

// ---- dados guardados (SQLite do Durable Object) ----
const MAX_ARQ = 1100000;          // figurinha: até ~1 MB
const TIPOS_FIG = /^(image\/(png|jpeg|gif|webp)|audio\/(mpeg|ogg|wav|webm|mp4|x-m4a|aac))$/;
const mesDe = ts => new Date(ts - 3 * 3600e3).toISOString().slice(0, 7);   // mês no horário de Brasília
export class Dados extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    const sql = this.sql = ctx.storage.sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS msgs (uid TEXT PRIMARY KEY, sala TEXT, ts INTEGER, json TEXT)`);
    sql.exec(`CREATE INDEX IF NOT EXISTS msgs_sala ON msgs (sala, ts)`);
    sql.exec(`CREATE TABLE IF NOT EXISTS figs (id TEXT PRIMARY KEY, nome TEXT, tipo TEXT, autor TEXT, autorNome TEXT, ts INTEGER, tam INTEGER, dados BLOB)`);
    sql.exec(`CREATE TABLE IF NOT EXISTS minutos (chave TEXT PRIMARY KEY, ts INTEGER)`);
    sql.exec(`CREATE TABLE IF NOT EXISTS stats (mes TEXT, tipo TEXT, chave TEXT, nome TEXT, valor INTEGER, PRIMARY KEY (mes, tipo, chave))`);
  }
  async fetch(req) {
    const rota = new URL(req.url).pathname;
    const d = await req.json();
    const eu = d.eu || {};
    const json = (x, st = 200) => Response.json(x, { status: st });
    const sql = this.sql;
    const sala = String(d.sala || '').slice(0, 32);

    // --- histórico do chat ---
    if (rota === '/historico') {
      const linhas = sql.exec(`SELECT json FROM msgs WHERE sala = ? ORDER BY ts DESC LIMIT 80`, sala).toArray();
      return json({ ok: true, msgs: linhas.reverse().map(l => JSON.parse(l.json)) });
    }
    if (rota === '/historico/guardar') {
      const msgs = Array.isArray(d.msgs) ? d.msgs.slice(0, 40) : [];
      for (const m of msgs) {
        if (!m || typeof m.uid !== 'string' || !m.uid || m.uid.length > 40) continue;
        const limpo = { tipo: 'msg', uid: m.uid, ts: Number(m.ts) || Date.now(), texto: String(m.texto || '').slice(0, 400), nome: m.nome ? String(m.nome).slice(0, 24) : null,
                        id: null, evento: m.evento ? String(m.evento).slice(0, 12) : null, cor: /^#[0-9a-f]{6}$/i.test(m.cor || '') ? m.cor : null,
                        img: typeof m.img === 'string' && /^https:\/\//.test(m.img) && m.img.length < 600 ? m.img : null, antigo: true };
        if (m.resp && typeof m.resp === 'object') limpo.resp = { uid: String(m.resp.uid || '').slice(0, 40), nome: String(m.resp.nome || '').slice(0, 24), trecho: String(m.resp.trecho || '').slice(0, 90) };
        sql.exec(`INSERT OR IGNORE INTO msgs (uid, sala, ts, json) VALUES (?, ?, ?, ?)`, limpo.uid, sala, limpo.ts, JSON.stringify(limpo));
      }
      // cada sala guarda as 200 mais recentes
      sql.exec(`DELETE FROM msgs WHERE sala = ? AND uid NOT IN (SELECT uid FROM msgs WHERE sala = ? ORDER BY ts DESC LIMIT 200)`, sala, sala);
      return json({ ok: true });
    }

    // --- figurinhas (imagens e sons) ---
    if (rota === '/figs') {
      const lista = sql.exec(`SELECT id, nome, tipo, autor, autorNome, ts, tam FROM figs ORDER BY ts DESC`).toArray();
      return json({ ok: true, figs: lista });
    }
    if (rota === '/figs/arquivo') {
      const f = sql.exec(`SELECT tipo, dados FROM figs WHERE id = ?`, String(d.id || '')).toArray()[0];
      if (!f) return json({ ok: false }, 404);
      return new Response(f.dados, { headers: { 'content-type': f.tipo, 'cache-control': 'private, max-age=86400' } });
    }
    if (rota === '/figs/enviar') {
      const nome = String(d.nome || '').trim().slice(0, 32), tipo = String(d.tipo || '');
      if (!nome || !TIPOS_FIG.test(tipo)) return json({ ok: false, erro: 'tipo' }, 400);
      let bytes;
      try { bytes = Uint8Array.from(atob(String(d.dados || '')), c => c.charCodeAt(0)); } catch (e) { return json({ ok: false, erro: 'arquivo' }, 400); }
      if (!bytes.length || bytes.length > MAX_ARQ) return json({ ok: false, erro: 'grande' }, 400);
      const total = sql.exec(`SELECT COUNT(*) AS n FROM figs`).one().n;
      if (total >= 300) return json({ ok: false, erro: 'cheio' }, 400);
      const id = crypto.randomUUID().slice(0, 12);
      sql.exec(`INSERT INTO figs (id, nome, tipo, autor, autorNome, ts, tam, dados) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, id, nome, tipo, String(eu.id || ''), String(eu.nome || '').slice(0, 32), Date.now(), bytes.length, bytes.buffer);
      return json({ ok: true, id });
    }
    if (rota === '/figs/apagar') {
      const f = sql.exec(`SELECT autor FROM figs WHERE id = ?`, String(d.id || '')).toArray()[0];
      if (!f) return json({ ok: false }, 404);
      if (f.autor !== String(eu.id || '')) return json({ ok: false, erro: 'dono' }, 403);
      sql.exec(`DELETE FROM figs WHERE id = ?`, String(d.id));
      return json({ ok: true });
    }

    // --- estatísticas: o organizador manda um retrato da sala por minuto ---
    if (rota === '/stats/minuto') {
      const min = Math.floor(Number(d.minuto) || 0);
      if (Math.abs(min - Math.floor(Date.now() / 60000)) > 2) return json({ ok: false });
      const chave = sala + ':' + min;
      if (sql.exec(`SELECT 1 FROM minutos WHERE chave = ?`, chave).toArray().length) return json({ ok: true, repetido: true });
      sql.exec(`INSERT INTO minutos (chave, ts) VALUES (?, ?)`, chave, Date.now());
      sql.exec(`DELETE FROM minutos WHERE ts < ?`, Date.now() - 2 * 864e5);
      const mes = mesDe(min * 60000);
      const somar = (tipo, chaveS, nome, n = 1) => sql.exec(
        `INSERT INTO stats (mes, tipo, chave, nome, valor) VALUES (?, ?, ?, ?, ?) ON CONFLICT (mes, tipo, chave) DO UPDATE SET valor = valor + excluded.valor, nome = excluded.nome`,
        mes, tipo, String(chaveS).slice(0, 64), String(nome || '').slice(0, 40), n);
      const pessoas = (Array.isArray(d.pessoas) ? d.pessoas : []).slice(0, 30).filter(p => p && p.did);
      const ids = new Set(pessoas.map(p => String(p.did)));
      for (const p of pessoas) {
        somar('presenca', p.did, p.nome);
        if (p.live) {
          somar('transmitiu', p.did, p.nome);
          const vendo = pessoas.filter(o => (o.vendo || []).includes(p.did)).length;
          if (p.jogo) somar('jogo', String(p.jogo).toLowerCase().trim(), String(p.jogo).trim(), Math.max(1, vendo));
        }
        if ((p.vendo || []).some(v => ids.has(String(v)))) somar('assistiu', p.did, p.nome);
      }
      if (pessoas.length >= 2 || pessoas.some(p => p.live)) somar('sala', 'jogatina', 'Jogatina');
      return json({ ok: true });
    }
    if (rota === '/stats') {
      const mes = /^\d{4}-\d{2}$/.test(d.mes || '') ? d.mes : mesDe(Date.now());
      const top = tipo => sql.exec(`SELECT chave, nome, valor FROM stats WHERE mes = ? AND tipo = ? ORDER BY valor DESC LIMIT 10`, mes, tipo).toArray();
      const meses = sql.exec(`SELECT DISTINCT mes FROM stats ORDER BY mes DESC LIMIT 12`).toArray().map(x => x.mes);
      return json({ ok: true, mes, meses, transmitiu: top('transmitiu'), assistiu: top('assistiu'), presenca: top('presenca'), jogos: top('jogo'), jogatina: (top('sala')[0] || {}).valor || 0 });
    }
    return json({ ok: false }, 404);
  }
}

// ---- busca de jogos ----
async function buscarSteam(q) {
  const r = await fetch(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(q)}&l=portuguese&cc=BR`, { signal: AbortSignal.timeout(5000) });
  const j = await r.json();
  return (j.items || []).filter(x => x.type === 'app').slice(0, 8).map(x => ({ nome: x.name, capa: x.tiny_image || null, info: 'PC' }));
}
async function tokenTwitch(env) {
  const chave = new Request('https://jogos.midori/token-twitch');
  const c = await caches.default.match(chave);
  if (c) return (await c.json()).t;
  const r = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${env.IGDB_CLIENT_ID}&client_secret=${env.IGDB_CLIENT_SECRET}&grant_type=client_credentials`, { method: 'POST' });
  const j = await r.json();
  if (!j.access_token) throw new Error('twitch');
  await caches.default.put(chave, new Response(JSON.stringify({ t: j.access_token }), { headers: { 'cache-control': `max-age=${Math.max(60, (j.expires_in || 3600) - 3600)}` } }));
  return j.access_token;
}
async function buscarIgdb(q, env) {
  const busca = q.replace(/["\\]/g, ' ');
  const r = await fetch('https://api.igdb.com/v4/games', {
    method: 'POST', signal: AbortSignal.timeout(5000),
    headers: { 'Client-ID': env.IGDB_CLIENT_ID, Authorization: 'Bearer ' + await tokenTwitch(env), 'content-type': 'text/plain' },
    body: `search "${busca}"; fields name, first_release_date, cover.image_id, platforms.abbreviation, version_parent; where version_parent = null; limit 10;`,
  });
  const j = await r.json();
  if (!Array.isArray(j)) return [];
  return j.slice(0, 8).map(g => ({
    nome: g.name,
    capa: g.cover && g.cover.image_id ? `https://images.igdb.com/igdb/image/upload/t_cover_small/${g.cover.image_id}.jpg` : null,
    info: [g.first_release_date ? new Date(g.first_release_date * 1000).getUTCFullYear() : null, (g.platforms || []).map(p => p.abbreviation).filter(Boolean).slice(0, 4).join(', ')].filter(Boolean).join(' · '),
  }));
}
