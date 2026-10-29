# Quizzes e conferência das fontes

Atualização de 28/10/2026.

A seção Bíblia possui 120 perguntas: 60 do Antigo e 60 do Novo Testamento. São 40 fáceis, 40 médias e 40 difíceis, em doze rodadas de dez. Os quatorze quizzes dos estudos têm oito perguntas cada, somando outras 112 perguntas.

As fáceis priorizam personagens e acontecimentos; as médias pedem relações e compreensão do trecho; as difíceis exigem atenção a detalhes e contexto. Todas possuem quatro alternativas, uma resposta correta e explicação. Não há cronômetro. A ordem das alternativas foi definida no banco, sem padrão cíclico de gabarito nem troca durante a tentativa.

## Fonte e explicação

As questões bíblicas indicam livro, capítulo, versículos e páginas do PDF NVI enviado. Há acesso à leitura bíblica e ao PDF. Quando o trecho atravessa páginas, todas são informadas e as páginas seguintes possuem links próprios. Os estudos indicam o título do PDF e a página exata. As explicações são resumos, identificados como tal; não são apresentadas como citações literais.

Cada pergunta possui uma evidência textual interna. A auditoria procura esse trecho diretamente no PDF sanitizado, preservando letras e números na normalização de layout, sem correspondência aproximada. Também verifica a existência dos versículos e a união exata de suas páginas, além de IDs, alternativas, níveis e páginas de estudos com texto confiável.

Uma revisão editorial independente examinou as 232 perguntas, seus gabaritos e todas as afirmações das explicações nas passagens ou páginas completas indicadas. Corrigiu inferências e recortes insuficientes antes da publicação. Os relatórios `content/quiz-review-at.json`, `quiz-review-nt.json` e `quiz-review-study.json` registram os resultados e as correções. `content/quiz-source-audit.json` registra as evidências verificadas e os hashes das fontes.

Essas verificações cobrem o banco atual de quizzes. Não equivalem a uma revisão editorial integral de todos os versículos e de todas as páginas de estudo do site.

## Histórico preservado

Os quizzes dos estudos mantêm seus IDs. A versão anterior de duas perguntas fica arquivada em `content/quiz-study-legacy.json` e em `previousVersions`; a ampliação usa revisão 2. Tentativas novas registram `quizRevision`. As antigas sem revisão são identificadas pela quantidade original de perguntas, quando inequívoca. O servidor verifica a pontuação contra o gabarito daquela versão. A interface mantém a revisão antiga no histórico e calcula o melhor resultado atual somente com tentativas da versão atual.

## Atualização e validação

Os quatro bancos editoriais são `content/quiz-bible-at.json`, `quiz-bible-nt.json`, `quiz-study-first.json` e `quiz-study-second.json`. Após alterar uma pergunta, é necessário conferir novamente sua fonte e atualizar o respectivo relatório editorial. Os testes rejeitam relatórios que já não correspondam aos arquivos revisados.

```sh
python3 scripts/import-quizzes.py
python3 scripts/audit-quiz-sources.py
python3 scripts/import-studies.py --validate-only
node --test tests/quiz-content.test.mjs
npm run build
npm test
npm run test:e2e
```

O importador de quizzes modifica apenas as coleções de perguntas. A importação geral de estudos também reutiliza os bancos editoriais, preservando as versões anteriores.
