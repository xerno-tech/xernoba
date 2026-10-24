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

      const dados = { id: eu.id, nome: eu.global_name || eu.username, exp: Date.now() + DIAS * 864e5 };
      const pulseira = await assinar(dados, env.DISCORD_CLIENT_SECRET);
      return voltar(site, 'token=' + encodeURIComponent(pulseira));
    }

    // 3) a Midori pergunta se uma pulseira é válida
    if (url.pathname === '/verificar' && req.method === 'POST') {
      let token = '';
      try { token = String((await req.json()).token || ''); } catch (e) {}
      const dados = await conferir(token, env.DISCORD_CLIENT_SECRET);
      return Response.json(dados ? { ok: true, id: dados.id, nome: dados.nome, exp: dados.exp } : { ok: false }, { headers: cors });
    }

    return new Response('Midori Xernoba — login com Discord. Está funcionando.', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  },
};

const voltar = (site, fragmento) => Response.redirect(site + '#' + fragmento, 302);

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
