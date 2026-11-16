# Publicar o jogo

O jogo é só a pasta `site/worldfight/`, com HTML, JavaScript e arquivos de mídia. Qualquer hospedagem de arquivos estáticos funciona.

## Passo a passo

1. Gere uma cópia com a versão carimbada:

   ```bash
   python tools/build_site.py
   ```

   O resultado sai em `dist/worldfight/`.
2. Envie o conteúdo dessa pasta para a hospedagem: FTP, Netlify (arrastar a pasta), Vercel, Apache, nginx ou outra.
3. Abra o endereço publicado.

Também dá para enviar `site/worldfight/` direto, sem a cópia. Tudo funciona, mas os visitantes podem continuar com arquivos antigos guardados no navegador depois de uma atualização.

## Por que carimbar a versão

Muitas hospedagens mandam o navegador guardar HTML e JavaScript por dias. `tools/build_site.py`:

- acrescenta `?v=<data-hora>` a cada `import` dos módulos e às referências do `index.html`;
- troca `__WF_VERSION__` no `index.html` pela versão. A tela de carregamento (`scenes/boot.js`) usa esse valor para pedir também as imagens, sons e atlas com `?v=`.

Sem a cópia (valor ainda `__WF_VERSION__`), o jogo carrega os arquivos sem versão.

## GitHub Pages

O repositório traz o workflow `.github/workflows/pages.yml`, que monta a cópia e publica no GitHub Pages. Ele só roda quando acionado à mão:

1. Em **Settings → Pages**, escolha **Source: GitHub Actions**.
2. Em **Actions → Publicar no GitHub Pages → Run workflow**, rode o workflow.
3. O jogo fica em `https://<usuário>.github.io/<repositório>/`.

## HTTPS, celular e online

- O modo online funciona em HTTP e em HTTPS.
- O compartilhamento de link do celular (`navigator.share`) e a cópia para a área de transferência funcionam melhor em HTTPS. Em HTTP, o jogo mostra o link na tela para copiar à mão.
- A tela cheia no celular pede um toque na tela (exigência dos navegadores). No iPhone, só funciona com "Adicionar à Tela de Início".
