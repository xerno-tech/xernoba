# 🍃 Midori Xernoba

🇧🇷 [Português](#português) · 🇺🇸 [English](#english)

---

## Português

Espaço fechado para um grupo de amigos **transmitir jogos, conversar por voz e trocar mensagens**, direto de navegador para navegador. Só entra quem está no servidor do Discord do grupo e tem 18 anos ou mais.

### O que dá para fazer

- **Transmitir:** console pela placa de captura, uma janela/jogo do PC ou a tela inteira, escolhendo resolução (até 4K), quadros por segundo e qualidade. O som do Discord e das conversas não vai junto.
- **Assistir:** várias transmissões ao mesmo tempo, em Grade, Flex-Grid ou Destaque; volume de cada uma até 200%, mutar, minimizar, tela cheia, modo cinema com o chat por cima, painel de conexão e clipe dos últimos 30 segundos.
- **Interagir na transmissão:** reações que sobem na tela e rabiscos para apontar coisas.
- **Voz:** conversa por voz na sala, com escolha de microfone, volume de cada pessoa até 200%, quem está falando em cima das telas e leitura de mensagens em voz alta (TTS) para quem está mutado.
- **Chat:** imagens e GIFs, links com prévia, @menções, responder, reagir, "fulano está digitando…" e horário em cada mensagem.
- **Sala:** foto do Discord, cor e emoji no avatar, "ausente" automático, miniatura ao vivo ao passar o mouse e quem está assistindo você.
- **Admin:** expulsar (e deixar voltar), silenciar na voz, parar transmissão e senha da sala.

### Sobre

- Projeto pessoal, **sem fins comerciais**. Não há cobrança, anúncios nem venda de qualquer serviço.
- O repositório é público apenas porque o GitHub Pages gratuito exige isso.
- **Sem vínculo** com Discord, Twitch, GitHub, Cloudflare, PeerJS ou qualquer outra empresa ou marca. Nomes citados pertencem aos seus donos.
- Usa a biblioteca [PeerJS](https://peerjs.com/) (licença MIT).

### Privacidade

- Não há banco de dados. Nada é gravado ou armazenado pelo autor: nem mensagens, nem imagens, nem transmissões. Quando todo mundo sai da sala, a conversa some.
- O vídeo, a voz, as mensagens e as imagens vão diretamente entre os participantes (WebRTC), sem passar por servidor do autor.
- O login usa o Discord: um servidor de login (Cloudflare Worker) confere se a conta está no servidor do grupo e entrega uma "pulseira" que vale 7 dias, com o ID, o nome e a foto do Discord. Essa pulseira fica só no navegador da pessoa.
- Esse mesmo servidor busca o título e a imagem dos links mandados no chat, para mostrar a prévia.
- Para conectar os participantes, o site usa o servidor público do PeerJS e servidores STUN públicos. Como em qualquer conexão direta, **o endereço IP de cada participante fica visível para esses servidores e para os outros participantes da sala.** Use apenas com pessoas de confiança.
- Nome, ajustes e preferências ficam salvos só no navegador de cada pessoa (armazenamento local).

### Uso permitido e responsabilidade

- Espaço **só para adultos (18+)**.
- Cada participante é o **único responsável** pelo que transmite, envia e assiste.
- É proibido usar para transmitir conteúdo protegido por direitos autorais sem autorização (filmes, séries, eventos pagos etc.), conteúdo ilegal, ofensivo ou que viole direitos de terceiros.
- O autor não modera, não controla e não tem acesso às salas nem ao conteúdo transmitido.

### Isenção de garantia

Este software é fornecido **"no estado em que se encontra"**, sem garantia de qualquer tipo, nos termos da licença Unlicense (domínio público). O autor não se responsabiliza por danos, perdas, falhas, interrupções ou pelo uso que terceiros façam do software.

### Contato e remoção

Se você acredita que este projeto viola algum direito seu, abra uma *Issue* neste repositório. O conteúdo será analisado e removido se for o caso.

### Como usar

Abra o site, entre com o Discord, digite seu nome e o nome da sala. Quem entrar na mesma sala vê quem está transmitindo e pode assistir. Os ajustes ficam em **⚙️ Ajustes**.

### Como o código está organizado

| Arquivo | O que tem |
|---|---|
| `index.html` | A estrutura da página (telas, botões, janelas) e o número da versão |
| `css/midori.css` | Todo o visual |
| `js/config.js` | Configuração: endereço do servidor de login e código da senha de admin |
| `js/base.js` | Funções básicas: atalhos, armazenamento, avisos, botão do olho, aviso de versão nova |
| `js/entrada.js` | Tela inicial: login com Discord, 18+, nome e sala |
| `js/sala.js` | A sala: quem organiza a lista (hub), lista de pessoas, "ausente" |
| `js/admin.js` | Poderes de admin e senha da sala |
| `js/voz.js` | Voz, microfone, volume de cada pessoa, quem está falando |
| `js/telas.js` | Telas de transmissão: volume, minimizar, painel, cinema, rabiscos, clipes, reações |
| `js/ajustes.js` | Janela de ajustes: perfil, sons e avisos, layout |
| `js/chat.js` | Chat: imagens, links, prévias, menções, respostas, reações, digitando, TTS |
| `js/transmissao.js` | Transmitir: fonte, captura, resolução, qualidade |
| `js/conexao.js` | Conexão entre as pessoas (PeerJS) |
| `js/inicio.js` | Últimos passos ao abrir a página |
| `login/worker.js` | Servidor de login com Discord e prévia de links (Cloudflare Worker) |

**Ao publicar uma atualização:** aumente o número em `const VERSAO = …` no `index.html` e o `?v=…` dos arquivos logo abaixo dele. Quem estiver com a página aberta recebe o aviso "Tem uma versão nova".

---

## English

A private space for a group of friends to **stream games, voice chat and text chat**, directly from browser to browser. Only members of the group's Discord server who are 18 or older can enter.

### Features

- **Stream:** a console through a capture card, a PC game/window or the whole screen, with resolution (up to 4K), frame rate and quality options. Discord and in-room voice audio are not sent.
- **Watch:** several streams at once in Grid, Flex-Grid or Spotlight layouts; per-stream volume up to 200%, mute, minimize, fullscreen, cinema mode with chat overlay, connection panel and a 30-second clip button.
- **Interact on streams:** floating reactions and drawing to point things out.
- **Voice:** in-room voice chat with microphone selection, per-person volume up to 200%, speaking indicators over the streams, and text-to-speech for muted users.
- **Chat:** images and GIFs, link previews, @mentions, replies, reactions, typing indicator and timestamps.
- **Room:** Discord avatar, avatar color and emoji, automatic "away" status, live thumbnail on hover and who is watching you.
- **Admin:** kick (and allow back), voice mute, stop a stream, and room password.

### About

- Personal, **non-commercial** project. No fees, no ads, no services sold.
- The repository is public only because free GitHub Pages requires it.
- **Not affiliated** with Discord, Twitch, GitHub, Cloudflare, PeerJS or any other company or brand. Names mentioned belong to their respective owners.
- Uses the [PeerJS](https://peerjs.com/) library (MIT license).

### Privacy

- There is no database. Nothing is recorded or stored by the author: no messages, images or streams. When everyone leaves a room, its conversation is gone.
- Video, voice, messages and images go directly between participants (WebRTC), without passing through any server run by the author.
- Login uses Discord: a login server (Cloudflare Worker) checks that the account is in the group's Discord server and issues a 7-day "wristband" containing the Discord ID, name and avatar. It is stored only in the user's browser.
- The same server fetches the title and image of links sent in chat, to show previews.
- To connect participants, the site uses the public PeerJS server and public STUN servers. As with any direct connection, **each participant's IP address is visible to those servers and to the other participants in the room.** Only use it with people you trust.
- Names, settings and preferences are saved only in each person's own browser (local storage).

### Acceptable use and responsibility

- **Adults only (18+).**
- Each participant is **solely responsible** for what they stream, send and watch.
- Do not use it to stream copyrighted content without permission (movies, series, paid events, etc.), or any illegal, offensive or infringing content.
- The author does not moderate, control or have access to rooms or streamed content.

### Disclaimer of warranty

This software is provided **"as is"**, without warranty of any kind, under the Unlicense (public domain). The author is not liable for any damages, losses, failures, interruptions, or for how third parties use the software.

### Contact and takedown

If you believe this project infringes any of your rights, please open an *Issue* in this repository. It will be reviewed and removed if appropriate.

### How to use

Open the site, sign in with Discord, enter your name and a room name. Everyone in the same room can see who is streaming and watch. Settings are under **⚙️ Ajustes**.

### Code layout

See the table in the Portuguese section above. When publishing an update, bump `const VERSAO = …` in `index.html` and the `?v=…` of the files right below it, so open pages get the "new version" notice.
