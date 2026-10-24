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

const DIAS = 7;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const site = env.SITE_URL;
    const origem = new URL(site).origin;
    const cors = {
      'Access-Control-Allow-Origin': origem,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type',
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

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
