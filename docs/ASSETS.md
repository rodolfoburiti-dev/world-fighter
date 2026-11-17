# Artes, animações e sons

Tudo o que o jogo carrega fica em `site/worldfight/assets/`:

| Pasta / arquivo | Conteúdo | Formato |
| --- | --- | --- |
| `anims/` | atlas de animação de cada lutador + `meta.json` | WebP + JSON (multiatlas do Phaser) |
| `fighters/` | corpo inteiro de cada lutador | WebP com transparência |
| `portraits/` | retratos grandes da seleção e da tela VS | WebP |
| `tiles/` | quadrinhos da grade de seleção | WebP |
| `stages/` | cenários (um por país; três para o Brasil) | WebP 1280 × 720 |
| `map.webp`, `title.webp` | mapa-múndi da seleção e arte da tela-título | WebP |
| `music/` | músicas por tela e cenário | MP3 128 kbps |
| `voice/` | locutor e nomes; `voice/combate/` falas de combate | MP3 |
| `sfx/` | efeitos gravados (**não incluídos**, veja abaixo) | MP3 |
| `fonts/` | Press Start 2P + licença OFL | WOFF2 |

Os scripts de `tools/` usam Python 3 com Pillow e NumPy, e o `ffmpeg` no PATH. As pastas de origem (`incoming/`, `work/`, `tools/voice_raw/`) ficam só na máquina do autor e não estão no repositório. Os scripts mostram o formato esperado.

## Lutadores e animações

As imagens dos lutadores e das animações foram geradas com IA (modelo de imagem do GPT), a partir de um desenho-base de cada personagem, e depois limpas e montadas por script.

1. **Tiras por movimento:**
   - uma tira por movimento, com o personagem de lado, virado para a direita, sobre fundo de cor-chave;
   - células de 448 × 384, cortadas em quadros `incoming/anim_ia/<id>/<movimento>/frame-<n>.png`.

   | Movimento | Quadros | Movimento | Quadros |
   | --- | --- | --- | --- |
   | `idle` | 4 | `highkick` | 5 |
   | `walk` | 6 | `crouch` | 3 |
   | `jab` | 4 | `jump` | 5 |
   | `strong` | 5 | `special` | 5 |
   | `lowkick` | 5 | `block` | 3 |

   Mais `ko` (queda com quique) e `getup` (levantar). Opcional: `win`, a comemoração de vitória própria do lutador (ex.: o Molusculo faz um "L" com a mão). Sem ela, o vencedor pula de alegria.
2. **Importação:** `python tools/import_sheets.py` lê os quadros e gera em `assets/anims/`:
   - o atlas `<id>.json` + `<id>-<n>-<hash>.webp`;
   - o `meta.json`.

   No processo, o script:
   - alinha os pés numa linha só e mede a altura do corpo, para todos os lutadores ficarem do mesmo tamanho na tela;
   - acha o **quadro de impacto** de cada golpe (o de maior alcance), que o jogo sincroniza com o motor;
   - cria a caminhada para trás tocando a caminhada ao contrário.
3. **Conferência:**
   - `python tools/audit_proportions.py` compara a proporção de cada lutador como o jogo desenha;
   - `python tools/preview_anims.py` gera folhas de conferência.

Atenção: cada quadro deve ter o personagem **no mesmo tamanho** dos outros. Um quadro desenhado maior faz o lutador "inchar" durante o golpe.

## Retratos, miniaturas, cenários e mapa

Imagens geradas com IA e preparadas por `python tools/prep_assets.py`, que remove o fundo, recorta, padroniza o tamanho e converte para WebP. `tools/renomear_miniaturas.py` escreve o nome de paródia na faixa das miniaturas.

## Músicas

Kevin MacLeod ([incompetech.com](https://incompetech.com/)), licença CC BY 4.0, com crédito na tela-título e em `CREDITOS.txt`. Os nomes dos arquivos estão no mapa `MP3` de `js/audio.js`.

## Vozes

| Voz | Ferramenta | Script |
| --- | --- | --- |
| Locutor e nomes dos lutadores | ElevenLabs, voz da biblioteca, com eco de fliperama | `tools/gerar_locutor.py`, `tools/cortar_locutor.py` |
| Falas de combate | Fish Audio | `tools/gerar_falas_combate.py` (lista em `js/combat-voices.js`) |

Os scripts precisam da chave de API do serviço. No computador do autor ela fica no cofre do Windows, por meio de um módulo `deploy/cred.py`, que não está no repositório. Para usar, troque a leitura da chave por uma variável de ambiente.

## Efeitos sonoros

Os efeitos gravados do jogo publicado (socos, chutes, defesas, nocaute, quedas, gemidos e gritos de dor) vêm do [Mixkit](https://mixkit.co/free-sound-effects/). A licença do Mixkit permite usá-los em jogos, mas **proíbe redistribuir os sons soltos**, por isso não estão aqui.

Neste repositório, `js/sfx-list.js` está vazio e o jogo sintetiza cada efeito na hora. Para ter os efeitos gravados:

1. Baixe a prévia MP3 de cada efeito do Mixkit para `work/sfx/orig/<id>.mp3`. Os números (ids) estão na tabela `SFX` e no dicionário `PAIN` de `tools/preparar_efeitos.py`.
2. Rode `python tools/preparar_efeitos.py`. O script corta cada som no impacto, mistura camadas, muda o tom de cada lutador e normaliza o volume. Depois grava os arquivos em `assets/sfx/` e recria `js/sfx-list.js`.

## Adicionar um lutador

1. Inclua o lutador em `FIGHTERS` (e o país em `COUNTRIES`, se for novo) em `js/data.js`.
2. Coloque `fighters/<id>.webp`, `portraits/<id>.webp` e `tiles/<id>.webp`. A grade tem 5 × 2 posições: para mais lutadores, ajuste `COLS` e o tamanho em `scenes/select.js`.
3. Gere as animações (passo a passo acima) e rode `tools/import_sheets.py`.
4. Cenário: imagem em `stages/` e entrada em `js/stages.js`. Música: entrada no mapa `MP3` de `js/audio.js`.
5. Opcional: voz do nome em `voice/<id>.mp3`, falas de combate, cor da bola de energia em `ORB` (`js/data.js`) e fala de vitória em `voice/win-<id>.mp3` (marque `winVoice: true` no lutador em `FIGHTERS`).
