# Arquitetura

## Visão geral

O jogo roda inteiro no navegador. O Phaser 4 cuida de cenas, desenho, entrada e carregamento. A luta é calculada por um motor próprio, separado do Phaser (`js/fight/sim.js`). A cena de luta só envia os comandos ao motor e desenha o estado que ele devolve.

Não há etapa de build: os arquivos em `site/worldfight/js/` são módulos ES carregados diretamente pelo navegador. O `js/phaser.min.js` é o Phaser 4.2.1 oficial.

```
boot → title ─┬─ Arcade / Versus ─→ select → versus → fight → resultado
              │                       ↑                       │
              │                       └── revanche / próxima ─┘
              └─ Online → online (sala) → select → versus → fight
```

| Cena (`js/scenes/`) | Função |
| --- | --- |
| `boot.js` | Carregamento em blocos e tela "aperte Enter ou toque", que também libera o áudio do navegador. Com `?sala=1234` no endereço, vai direto para a sala online |
| `title.js` | Logo com clarão, "APERTE START" e menu Arcade / Versus / Online |
| `online.js` | Sala online: criar (código e link de convite) ou entrar (teclado numérico) |
| `select.js` | Mapa-múndi com pinos, retratos frente a frente, grade 5 × 2 com cursores 1P/2P, cronômetro de 30 s e roleta do CPU. No online, cada aparelho controla só o seu cursor |
| `versus.js` | Tela VS. Carrega só os dois lutadores da luta (os atlas são pesados), com barra de progresso, e libera os demais da memória |
| `fight.js` | Rounds, barras de vida, cronômetro, letreiros, efeitos, sons, pausa e tela de resultado |

## Motor de luta (`js/fight/sim.js`)

- **Determinístico:**
  - passo fixo de 60 quadros por segundo;
  - aleatoriedade só por semente (`mulberry32`);
  - só operações aritméticas simples, sem `Math.sin` nem `Math.random`.

  A mesma semente com os mesmos comandos reproduz a mesma luta em qualquer navegador. O modo online depende disso.
- **Independente do Phaser:** `step(inputs)` recebe os comandos dos dois lutadores (`left`, `right`, `up`, `down`, `block`, `punch`, `kick`). Devolve uma lista de eventos (`hit`, `ko`, `jump`, `land`, `roundEnd`, `phase`…) e atualiza `fighters`, `projectiles`, `phase` e `timer`.
- **Golpes** (tabela `ATTACKS`):
  - cada golpe tem preparação, quadros ativos, recuperação, dano, alcance e empurrão;
  - o dano passa por `DAMAGE_SCALE`;
  - o especial (baixo, frente + soco) lança uma bola de energia.
- **Partida:**
  - melhor de 3 rounds de 99 segundos;
  - fases `intro` → `fight` → `koTime` → `ended`;
  - `newRound()` prepara o próximo round.
- **Teste:** `node tools/test_sim.mjs` roda 60 lutas CPU × CPU e confere o determinismo.

Na cena de luta, o round seguinte começa num quadro fixo do motor (`newRoundAt`), e não quando o escurecimento da tela termina. O tempo de animação varia entre aparelhos e, no online, isso faria os dois lados se separarem.

## CPU (`js/fight/ai.js`)

Controla o adversário com os mesmos comandos de um jogador: o motor não distingue humano de máquina. A dificuldade sobe a cada adversário vencido no Arcade.

## Entrada

| Arquivo | Função |
| --- | --- |
| `controls.js` | Teclado e controle nos menus (ações `up/down/left/right/confirm/back`), em modo solo ou versus (1P e 2P) |
| `scenes/fight.js` (`keyMaps`, `pollPad`, `humanInput`) | Teclas e controle durante a luta |
| `touch-controls.js` | Celular e tablet: direcional analógico flutuante (8 direções, zona morta, base que segue o dedo) e os botões A/B/X/Y desenhados em canvas, com multitoque. O botão Y gera o comando do especial em 3 quadros (`applyTouchMacro`) |

No celular e no tablet, `main.js` pede tela cheia ao primeiro toque e trava a tela na horizontal quando o navegador permite.

## Animação

- Cada lutador tem um **multiatlas** (`assets/anims/<id>.json` + páginas `.webp` de até 2048 × 2048, com hash no nome).
- O arquivo `assets/anims/meta.json` guarda, por lutador:
  - a origem dos pés e a altura do corpo (para todos ficarem do mesmo tamanho);
  - o número de quadros de cada animação;
  - o quadro de impacto de cada golpe.
- O **quadro de impacto** da animação coincide com os quadros ativos do golpe no motor (`frameFor`). Antes dele vem a preparação, depois a volta.
- Animações: `idle`, `walkf`, `walkb`, `jab`, `strong`, `lowkick`, `highkick`, `crouch`, `jump`, `special`, `block`, `ko` (queda com quique) e `getup`.

Como os atlas são gerados está em [ASSETS.md](ASSETS.md).

## Áudio (`js/audio.js`, `js/music.js`)

- **Músicas:** MP3 por tela e por cenário (Kevin MacLeod, CC BY 4.0). Sem o arquivo, toca a trilha sintetizada de `music.js`, com guitarra, flauta, cordas, koto, baixo e bateria feitos em Web Audio.
- **Efeitos:** `assets/sfx/<nome>-<n>.mp3`, listados em `js/sfx-list.js`, com variação sorteada e tom ±5%. Sem a lista ou os arquivos, cada efeito é **sintetizado na hora**.
- **Vozes:** locutor e nomes em `assets/voice/`, falas de combate em `assets/voice/combate/` (lista em `js/combat-voices.js`). Gemido em golpe forte e grito no nocaute: efeitos `hurt-<id>` e `scream-<id>`.
- O jogo sempre começa com som ligado. O botão SOM / tecla M vale até fechar a página.

## Cenários (`js/stages.js`)

`stageFor()` escolhe o cenário pelo país do lutador. Os brasileiros têm cenário próprio (Nordeste, Rio, Brasília). `GROUND_Y` é a linha do chão.

## Online (`js/net.js`)

Conexão WebRTC com PeerJS e luta em lockstep. Detalhes em [ONLINE.md](ONLINE.md).

## Lições

- O Phaser reaproveita a mesma instância de cada cena. Todo estado de controle (`leaving`, `ready`, `locked`…) precisa ser zerado em `create`. Sem isso, a tela VS travava na segunda visita.
- Navegadores só liberam áudio e tela cheia depois de uma interação. A tela "aperte Enter ou toque" resolve isso de forma natural.
- Aba em segundo plano não roda o laço do jogo (`requestAnimationFrame` para). No online, quem ficar parado faz o outro esperar ("AGUARDANDO OPONENTE…").
