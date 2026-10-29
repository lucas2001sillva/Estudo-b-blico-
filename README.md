# Vereda Bíblica

Site de leitura e estudo bíblico em português, com acesso público ao conteúdo e conta opcional para sincronizar a jornada entre dispositivos.

Endereço publicado: **[estudo-b-blico.onrender.com](https://estudo-b-blico.onrender.com/)**. A primeira publicação está em validação; as pendências de privacidade e operação estão descritas na documentação.

## Desenvolvimento

Requer Node.js 24 ou superior. Os dados já importados e os PDFs de consulta estão em `content/`; não é necessário executar OCR para usar o site.

```sh
cd /workspace/Estudo-b-blico-
npm ci
npm run dev
```

O comando inicia o Vite na porta 5173 e a API na porta 3001. O Vite encaminha `/api` ao servidor, mantendo autenticação e conteúdo na mesma origem para o navegador.

Para executar a versão compilada:

```sh
npm run build
npm start
```

O servidor entrega a interface e a API na porta 3001. `GET /api/health` verifica a API; a validação funcional também deve consultar o catálogo e uma passagem, além de carregar a interface.

## Funcionalidades

- Bíblia organizada em 66 livros e 1.189 capítulos, importada dos arquivos enviados, com busca por referência ou palavra.
- Conclusão manual e reversível de capítulos; progresso geral, por livro e por assunto de estudo.
- Trilhas livres e uma recomendação para iniciantes, sem bloqueio por sequência.
- Estudos organizados por assunto, com indicação do PDF e da página de origem.
- Gráficos, quadros e diagramas em imagens, com ampliação e descrições verificadas; os dois quadros introdutórios possuem versões redesenhadas nos temas claro e escuro.
- Quizzes por assunto, sem cronômetro, com explicação, pontuação, novas tentativas e histórico.
- Cinquenta passagens extraídas dos arquivos da Bíblia, com destaque diário e navegação manual entre elas.
- Temas claro e escuro; ajuste de fonte; navegação por teclado; leitura em voz alta com pausa e velocidade ajustável.
- Progresso e preferências salvos no navegador para visitantes; sincronização no servidor para quem entra na conta.

A leitura em voz alta usa as vozes oferecidas pelo navegador/dispositivo. A disponibilidade de uma voz em português depende do aparelho. Conteúdos duvidosos não são narrados como texto confirmado.

## Contas e armazenamento

As contas usam e-mail e senha, com hash `scrypt` e sessão em cookie HttpOnly. Novos cadastros exigem de 15 a 128 caracteres; hashes antigos são fortalecidos após um login válido. As sessões expiram após sete dias ou 24 horas sem uso. No desenvolvimento, o banco SQLite fica em `var/vereda.sqlite`, fora do Git. A publicação gratuita usa banco Turso externo por `DATABASE_URL` e `DATABASE_AUTH_TOKEN`, com conexão protegida. Não há conta de demonstração ou senha padrão.

O progresso é salvo por campo; marcar um capítulo em um dispositivo não substitui o restante do progresso salvo em outro. Alterações ainda não sincronizadas permanecem em uma fila no navegador. O aplicativo consulta atualizações ao recuperar o foco e periodicamente enquanto está aberto.

O progresso de visitante fica em `localStorage` e pode ser visto por outras pessoas no mesmo perfil do navegador. Sua importação para uma conta exige marcar uma opção que começa desmarcada. O histórico autenticado é obtido do servidor; somente alterações pendentes ficam em `sessionStorage`, separadas por conta e aba. Fechar a aba antes da sincronização pode perder essas alterações. Aguarde a indicação de sincronização antes de fechar. O logout aguarda a sincronização e a confirmação do encerramento no servidor.

O conteúdo ainda precisa de conexão para ser carregado: a fila local de progresso não significa suporte completo a leitura sem internet. Limpar os dados do navegador remove o progresso de visitante e alterações que ainda não chegaram ao servidor.

Esta versão não inclui recuperação de senha por e-mail nem confirmação do endereço de e-mail. O modo Render exige banco remoto, sem fallback para SQLite temporário. Ainda é necessário definir e testar uma rotina de backup. O responsável pela hospedagem deve configurar a origem pública e os cookies para a conexão HTTPS usada.

Variáveis opcionais do servidor:

| Variável | Uso |
| --- | --- |
| `PORT` | Porta HTTP; padrão `3001` |
| `DB_PATH` | Caminho persistente do SQLite; padrão `var/vereda.sqlite` |
| `DATABASE_URL` | URL do Turso remoto; usar somente no backend |
| `DATABASE_AUTH_TOKEN` | Segredo de acesso ao banco, preenchido no Render |
| `REQUIRE_REMOTE_DATABASE=1` | Impedir banco temporário local; também exigido quando `RENDER=true` |
| `DATABASE_REQUEST_TIMEOUT_MS` | Limite por requisição ao banco remoto; padrão `10000` |
| `DATA_DIR` | Diretório dos catálogos e PDFs; padrão `content/` |
| `PUBLIC_ORIGIN` | Origem pública autorizada para as requisições, quando necessária atrás de proxy |
| `TRUST_PROXY=1` | Confiar em um proxy reverso controlado imediatamente à frente do servidor |
| `SECURE_COOKIES=1` | Exigir cookie de sessão transmitido por HTTPS |

Não salve o banco de produção, senhas ou outros valores secretos no repositório.

## Origem dos conteúdos

Os conteúdos vêm exclusivamente dos sete PDFs enviados. O texto bíblico não foi simplificado. Resumos dos estudos e perguntas são vinculados às páginas que os fundamentam.

O quiz separa Bíblia e estudos dos PDFs. São 120 perguntas bíblicas (40 fáceis, 40 médias e 40 difíceis) e 112 perguntas nos 14 quizzes de estudo. As referências e explicações passaram por auditoria direta nos PDFs e revisão independente. O histórico conserva as versões anteriores dos quizzes. Veja [quizzes.md](docs/quizzes.md) para fontes, critérios e reprodução das verificações.

As auditorias estão em `content/bible-audit.json` e `content/study-audit.json`. Elas registram verificações, hashes dos arquivos e limitações. A importação e a amostragem não substituem uma revisão editorial integral.

Parte dos estudos contém tabelas e páginas em imagem. O site distingue texto extraído, texto convertido por OCR e trechos que ainda exigem revisão. Os trechos reconhecidamente ilegíveis ou inconsistentes não são usados para formular gabaritos. Há acesso às páginas dos PDFs de consulta; essas cópias ocultam campos pessoais sobrepostos e metadados identificadores, preservando o conteúdo educacional e os avisos editoriais. Os uploads originais permanecem intactos no diretório de anexos.

Os scripts de importação são opcionais para o desenvolvimento normal:

```sh
python3 scripts/import-bible.py --help
python3 scripts/import-studies.py --help
```

A reimportação exige Python, PyMuPDF e pypdf, com versões em `scripts/requirements.txt`; os estudos também podem exigir Tesseract e o modelo de português. Para instalar essas ferramentas opcionais, use um ambiente virtual Python. O script verifica o checksum do modelo obtido da fonte oficial. Use os argumentos documentados para indicar os arquivos de entrada; não dependa dos caminhos temporários dos anexos em uma máquina diferente.

## Verificação

```sh
npm test
npm run build
npm run test:e2e
```

Os testes da API usam bancos temporários; os testes de conteúdo verificam referências e consistência dos arquivos reais. Os testes de navegador usam Chromium em `/usr/bin/chromium`; outro executável pode ser informado em `CHROMIUM_PATH`. Eles iniciam a aplicação com banco de testes separado. Para apontar explicitamente para um servidor já iniciado, use `TEST_BASE_URL`.

O escopo e as decisões do produto estão em [docs/escopo-inicial.md](docs/escopo-inicial.md).

Os resultados executados e as limitações conhecidas estão em [docs/validacao.md](docs/validacao.md).

A origem das figuras, a reprodução dos arquivos e as regras de leitura acessível estão em [docs/figuras-estudos.md](docs/figuras-estudos.md).

A hospedagem no Render e o armazenamento persistente estão descritos em [docs/publicacao.md](docs/publicacao.md). O Dockerfile também está disponível para implantação em contêiner.

A [Política de Segurança da Informação](docs/politica-seguranca.md) e o [guia de boas práticas](docs/boas-praticas-seguranca.md) definem requisitos e pendências de segurança; sua existência não significa que todos os controles estejam implementados ou validados.
