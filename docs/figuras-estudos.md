# Figuras e quadros dos estudos

Atualização de 28/10/2026. A apresentação linear do texto de um PDF não preserva, por si, relações entre barras, colunas, cartões ou pontos de uma cronologia. Esses trechos agora são apresentados como imagens, com referência à página e ampliação por teclado ou toque.

## Origem e apresentação

- Foram examinadas as 251 páginas dos cinco PDFs de estudo; 171 seções receberam figuras. As capas continuam fora das lições.
- O gráfico da Parte 1, página 3, foi redesenhado como SVG: Antigo Testamento com 39 livros e Novo Testamento com 27, mantendo escala de 0 a 40 e proporções corretas.
- O quadro da Parte 1, página 4, foi redesenhado como SVG: cada um dos sete autores permanece junto de sua descrição; a nota lateral também foi preservada.
- Cabeçalhos com dados e cronologias nas Partes 3 e 4 mantêm os vetores, coordenadas e rótulos da fonte, com a paleta clara/escura do site.
- Composições complexas e páginas em imagem preservam a composição original dentro do leitor visual do site. Não são novos desenhos gerados a partir de OCR. Cores de categorias e legendas das composições originais são mantidas.
- Todas as exportações usam as cópias de consulta já sanitizadas em `content/source-pdfs/`, com o clipping aplicado pelo mecanismo PDF. Os anexos brutos não são republicados.

Os 228 arquivos resultantes ficam em `public/study-visuals/`. O navegador carrega as imagens sob demanda. O modal permite ampliação de 100% a 400%, rolagem interna e fechamento por Esc; também há acesso direto à imagem e ao PDF.

## Texto, leitura e áudio

O campo original `body` continua preservado para auditoria e não é usado automaticamente como interpretação de uma figura. `displayBody` e `bodyAfterVisuals` mantêm a prosa comum antes e depois das imagens quando essa separação é confiável.

`readingText` define a leitura acessível confirmada da seção, incluindo descrições verificadas. As sete associações do quadro dos autores são narradas corretamente. Uma imagem legível não transforma automaticamente OCR em transcrição revisada.

Quando ainda não há transcrição semântica confiável, o texto extraído fica no detalhe **Texto extraído — em conferência**, sem áudio automático. Os avisos de páginas em revisão permanecem. A descrição detalhada acessível de todas as composições complexas continua exigindo revisão humana; não se inventam rótulos ilegíveis.

## Reproduzir e conferir

As dependências opcionais Python estão em `scripts/requirements.txt`.

```sh
python3 scripts/import-study-visuals.py
python3 scripts/import-study-visuals.py --verify-only
python3 scripts/import-studies.py --validate-only
npm run build
npm test
npm run test:e2e
```

O importador geral de estudos também refaz a apresentação visual ao concluir uma importação. Exportações raster existentes só são reutilizadas quando a fonte, o recorte e o hash do arquivo coincidem com a auditoria anterior.

`content/study-visual-audit.json` registra fontes, recortes, modo de apresentação, hash da transcrição original e integridade de cada imagem. Os números e afirmações editoriais dos PDFs não são corrigidos por informações externas.
