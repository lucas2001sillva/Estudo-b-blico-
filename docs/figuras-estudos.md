# Figuras e texto dos estudos

Atualização de 28/10/2026. Os parágrafos dos estudos permanecem como texto do site. Somente gráficos, tabelas, quadros de dados e diagramas são recriados como imagens separadas, inseridas na ordem da leitura.

## Conteúdo e apresentação

- As 248 páginas de conteúdo possuem um plano explícito: regiões de figuras ou nenhuma figura. Capas não entram nas lições.
- Os arquivos `content/visual-regions-*.json` delimitam as figuras e registram linhas, colunas, relações e notas transcritas da fonte.
- O gráfico de 39/27 livros e o quadro dos sete autores mantêm dados e associações conferidos.
- Tabelas são imagens SVG novas, com células/cartões, tipografia e paleta clara/escura do Vereda. Sequências e ciclos mantêm suas setas e retorno quando presentes na fonte.
- Diagramas vetoriais são reconstruídos somente dentro da região selecionada, preservando rótulos e conexões e usando a tipografia e as cores do site. Não contêm bitmaps de páginas.
- A planta central do tabernáculo foi gerada como uma imagem própria nos dois temas; seus objetos, rótulos e medidas foram conferidos no PDF. As fotografias ao redor não fazem parte da imagem nova.
- A pedido do usuário, as onze figuras com rótulos ilegíveis ou relações ambíguas agora mostram o recorte original do PDF sanitizado, identificado como imagem original. Elas podem ser ampliadas e mantêm as cores originais nos dois temas. A transcrição permanece em conferência; não há áudio inventado para esses rótulos.

Não existe imagem de página inteira como alternativa automática. Uma figura que ocupa quase uma página, como uma genealogia, continua limitada ao conteúdo dessa figura; títulos externos, parágrafos, fotos e rodapés não são incorporados.

## Texto e acessibilidade

`StudySection.blocks` intercala parágrafos (`text`) e referências de figuras (`visual`) na ordem do material. Os parágrafos usam HTML e o tamanho de letra escolhido pelo leitor, incluindo nas páginas originalmente digitalizadas.

O OCR da prosa mascara somente as figuras e usa regiões de leitura conferidas para não misturar colunas. A introdução e a prosa de Gênesis na Parte 2 possuem transcrição manual conferida. Os onze cabeçalhos dessa parte têm descrições de dados e cronologia conferidas no original. Outras conversões automáticas preservam seus avisos e podem exigir revisão editorial.

`readingText` reúne a prosa e as descrições acessíveis disponíveis, respeitando os avisos de revisão. Os campos originais `body` e as fontes ficam preservados para auditoria. Imagens têm descrições, ampliação, teclado e acesso ao PDF. As seções ainda em conferência não são narradas como conteúdo confirmado. As explicações dos quizzes são resumos conferidos nas páginas indicadas; perguntas, alternativas e gabaritos permanecem iguais.

## Reprodução e verificação

As dependências opcionais estão em `scripts/requirements.txt`; a reimportação também requer Tesseract e o modelo de português, obtido da fonte oficial com checksum verificado. Não é necessário OCR para executar o site: o conteúdo e as figuras preparados ficam versionados.

```sh
python3 scripts/import-study-visuals.py
python3 scripts/import-study-visuals.py --verify-only
python3 scripts/import-studies.py --validate-only
npm run build
npm test
npm run test:e2e
```

A auditoria `content/study-visual-audit.json` registra 248 seções, as regiões selecionadas, as figuras recriadas e originais, as pendências de transcrição e hashes das fontes, transcrições e assets. `source-original` identifica os onze recortes aprovados, compartilhados entre os temas sem recoloração; os demais usam `redrawn`. O campo `fullPageImages` deve permanecer zero. As antigas capturas integrais são removidas quando deixam de ser referenciadas.

A regeneração reutiliza o OCR somente quando fonte, regiões e parâmetros coincidem. Os PNGs gerados e revisados da planta devem ser preservados no repositório; não se exige uma nova geração de imagem para instalar ou publicar o site.
