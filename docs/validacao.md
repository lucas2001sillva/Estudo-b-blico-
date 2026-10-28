# Validação da primeira versão

Verificações executadas em 27/10/2026, com Node.js 24.19.0 e Chromium 154.

- `npm ci --no-audit --no-fund --cache /workspace/.cache/npm`: instalação a partir do lockfile concluída.
- `npm run build`: TypeScript e compilação da interface concluídos.
- `npm test`: **29 testes passaram**, sem testes ignorados: 5 de conteúdo, 9 de banco e 15 de API/segurança. Incluem concorrência entre instâncias e processos, migração de banco anterior, expiração de sessões, atualização de hashes, limites de autenticação, isolamento de contas, validação de origem, requisições grandes e falhas de persistência sem cookie indevido.
- `npm run test:e2e`: **11 testes passaram**, sem testes ignorados. Incluem leitura pública, busca, progresso reversível, sincronização, estudos/quizzes, teclado, celular, temas e fonte calculada. As regressões de privacidade verificam importação de visitante desmarcada por padrão, limpeza após importação confirmada, ausência de perfil/histórico privado persistente no navegador, logout confirmado e fila da conta A recusada sob cookie da conta B. A largura real da barra e a fonte foram medidas sob CSP; respostas atrasadas não restauraram estado antigo.
- `python3 scripts/import-studies.py --validate-only`: estrutura, hashes e evidências das 28 perguntas conferidos.
- A importação bíblica foi repetida com resultados idênticos e 12 regressões de extração verificadas nos PDFs.
- A inicialização compilada foi verificada por requisições à interface, ao catálogo, a João 3:16 e aos sete PDFs de consulta.
- O modo `npm run dev` foi verificado com Vite, proxy da API, registro, cookie, alteração de progresso/tema e logout. Um problema de origem no proxy foi corrigido e o fluxo foi repetido com sucesso.
- `node scripts/check-remote-database.mjs`: integração HTTP passou com o servidor libSQL oficial fixado por digest. Duas APIs preservaram alterações concorrentes e respostas de quiz; banco indisponível respondeu 503 sem cookie ou fallback; reiniciar API/banco preservou os dados. Contêiner e volume temporários foram removidos. Este teste em loopback não usa o token do usuário e não comprova conexão ou TLS com o Turso hospedado.
- `npm audit --omit=dev --json`: nenhuma vulnerabilidade conhecida reportada nas dependências de produção na data da verificação. A consulta não comprova ausência de falhas no aplicativo.
- `PUBLIC_ORIGIN` inválida com caminho foi rejeitada antes da abertura do banco; URLs de origem não são normalizadas silenciosamente.
- A imagem Docker foi construída com `bash scripts/docker-build.sh vereda-biblica:review-20261027`. Um contêiner sem root e com volume temporário foi exercitado: interface, catálogo, PDF, registro, alteração de progresso/tema, reinicialização, novo login e confirmação dos dados persistentes. O contêiner e seu volume foram removidos ao final. O build utilizou o certificado confiável do proxy por montagem temporária, sem desabilitar verificação TLS nem copiar a CA para a imagem final.

Os testes automatizados locais de navegador e de desenvolvimento usaram bancos temporários. A verificação pública abaixo não criou contas de demonstração.

## Verificação do endereço público

Em 27/10/2026 foi consultado **<https://estudo-b-blico.onrender.com/>**, com verificação de certificado TLS habilitada.

- Página inicial HTTP 200; arquivos JavaScript e CSS HTTP 200, com hashes idênticos aos da compilação validada localmente.
- `/api/health` HTTP 200, incluindo a consulta de prontidão ao banco; catálogo HTTP 200 com 66 livros, 50 passagens, 5 trilhas, 33 assuntos e 14 quizzes.
- João 3:16 presente no capítulo e encontrado pela pesquisa por referência.
- Os sete PDFs responderam como `application/pdf`, com assinatura PDF válida em consultas parciais HTTP 206.
- `/api/state` sem autenticação retornou 401; `/api/session` retornou usuário nulo. As respostas da API usaram `Cache-Control: no-store`.
- Cabeçalhos HTTPS/HSTS, CSP, proteção contra enquadramento e `nosniff` presentes.
- Na interface pública foram exercitados início, busca de João 3:16, progresso de visitante reversível e persistente após recarregar, tema, fonte calculada de 18 para 20 pixels, leitura/conclusão local de estudo e seleção de resposta com explicação no quiz. Em 768 pixels, início e Bíblia abriram sem rolagem horizontal indevida. Não houve erros de JavaScript, console ou rede nesses fluxos.

O Chromium deste ambiente não confiou diretamente na CA do proxy de saída. A conferência visual utilizou GETs intermediados pelo Node, com a CA confiável e TLS verificado, preservando os cabeçalhos de conteúdo e CSP. Isso verifica a interface servida e suas interações locais, mas não é uma validação do certificado diretamente pelo Chromium. Não foram desativadas verificações TLS nem enviados pedidos de escrita ao servidor.

Essas consultas públicas não comprovam cadastro, login, sincronização entre contas ou restauração após reiniciar o serviço hospedado. Não foram fornecidas credenciais do banco para esta conferência.

## Apresentação e acessibilidade

Atualização visual de 28/10/2026: `npm test` passou com **32 testes** e a suíte completa de navegador passou com **14 testes**. Após ajustar somente a espera de decodificação na captura, os três testes novos de navegador foram repetidos com sucesso. A conferência das fontes, transcrições e dos 228 assets de 171 seções passou por `import-study-visuals.py --verify-only`; a validação das 28 evidências dos quizzes também passou. Gráfico 39/27, associações dos sete autores, alternância de imagens por tema, ampliação/teclado/foco, leitura em voz por texto verificado e layout de 390 pixels foram exercitados. As fontes e o conteúdo original dos quizzes não mudaram.

As novas figuras foram verificadas localmente. A publicação dessa atualização e sua conferência no endereço público precisam ocorrer depois do envio da versão. A política de áudio e as limitações das transcrições visuais estão em [figuras-estudos.md](figuras-estudos.md).

Layout conferido em larguras de 390, 768 e 1.440 pixels, sem rolagem horizontal indevida nos fluxos examinados. Temas, ajuste de fonte, navegação por teclado e link para pular ao conteúdo foram exercitados. As capturas estão em `/workspace/artifacts/` na máquina de desenvolvimento.

A saída de áudio não foi validada auditivamente. As vozes disponíveis dependem do navegador e do dispositivo. Uma avaliação com leitores de tela reais e pessoas com dificuldade de leitura continua sendo uma etapa própria de validação.

## Conteúdo e limites conhecidos

- Bíblia: 66 livros, 1.189 capítulos e 50 passagens selecionadas dos versículos importados.
- Estudos: 5 trilhas livres, 33 assuntos, 17 resumos simplificados e 14 quizzes com 28 perguntas.
- Das 248 seções de estudos, 238 possuem texto legível no site; 82 usam OCR com aviso de conversão automática.
- Dez páginas permanecem sinalizadas para revisão: Parte 1, página 8; Parte 2, páginas 7, 57, 59, 74 e 84; “Os 4 Evangelhos”, páginas 1 a 4. Os trechos duvidosos não são narrados como texto confirmado nem utilizados em gabaritos; os PDFs de consulta permanecem acessíveis.
- Não foi realizada revisão editorial integral, versículo a versículo ou página a página, de todo o conteúdo.
- A conta permite sincronização, mas esta versão não inclui confirmação de e-mail nem recuperação de senha por e-mail.
- O cadastro duplicado retorna HTTP 409 e permite inferir a existência de um e-mail. O fluxo de confirmação de e-mail e a redução dessa exposição permanecem pendentes.
- Contas infantis, aviso de privacidade público, canal responsável, retenção/eliminação e backups reais ainda dependem das providências descritas na política. A primeira implantação é para validação com contas de teste de adultos autorizados.
- O histórico autenticado não é mantido em `localStorage`. Alterações privadas ainda não sincronizadas ficam na aba em `sessionStorage`; fechar essa aba antes da sincronização pode perdê-las. O site avisa quando a sincronização está indisponível.
- A fila local de progresso não oferece leitura completa sem internet.

A restauração em uma tarefa nova do ambiente de desenvolvimento e os fluxos autenticados no serviço hospedado permanecem sem validação. Os resultados locais de integração e de navegador não substituem essas verificações em produção.
