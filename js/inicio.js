// Midori Xernoba — últimos passos ao abrir a página

// recarrega pedindo a página nova (o parâmetro extra evita pegar a versão guardada em cache)
$('btnAtualizarVersao').onclick = () => { const u = new URL(location.href); u.searchParams.set('v', Date.now()); location.replace(u); };
$('btnVersaoDepois').onclick = () => $('faixaVersao').classList.add('oculto');

// já veio com ?sala= e tem nome salvo: entra direto
if (params.get('sala') && ler('nome') && !bloqueadoPeloPortao) $('btnEntrar').click();
