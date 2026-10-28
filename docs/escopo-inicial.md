# Vereda Bíblica

Site interativo de leitura e estudo bíblico. Este documento registra os requisitos e as decisões da conversa. A primeira versão está implementada no repositório; publicação e revisão editorial integral dos conteúdos continuam separadas da validação de desenvolvimento.

## Decisões confirmadas

- Nome do projeto: **Vereda Bíblica**, escolhido para representar os caminhos de leitura e aprendizado.
- Conteúdo aberto a qualquer pessoa, sem cadastro obrigatório para ler ou estudar. A conta permite sincronizar o progresso e as preferências.
- Trilhas de estudo livres: o leitor escolhe qual iniciar e recebe uma sugestão para iniciantes, sem bloqueios por sequência.
- Site em português, adaptado para computadores, celulares e tablets.
- Público misto, incluindo crianças; a apresentação deve ser compreensível para diferentes idades.
- Área exclusiva para leitura da Bíblia, organizada por livros.
- Localização de passagens pelo nome do livro, capítulo e versículo.
- Progresso de leitura geral da Bíblia e do livro selecionado.
- O leitor marca manualmente a conclusão de cada capítulo.
- Estudos organizados por assunto, com acompanhamento do progresso.
- Estudos baseados exclusivamente nos PDFs fornecidos. É permitida a redação simplificada e fiel às fontes, sem acrescentar explicações ou curiosidades de outras fontes.
- A autorização para simplificar os estudos não inclui reescrever os versículos da Bíblia.
- Aba de quizzes por assunto, sem cronômetro, com pontuação e novas tentativas. As respostas terão explicações e indicação do PDF e da página de origem.
- Leitura em voz alta do conteúdo da tela por voz automática do navegador/dispositivo, com pausa e ajuste de velocidade conforme a compatibilidade de cada aparelho.
- Ajuste do tamanho das letras.
- Temas claro e escuro, escolhidos pelo leitor.
- Conta de usuário e sincronização do progresso, respostas dos quizzes e preferências entre dispositivos.
- Conjunto de 50 passagens bíblicas para a página inicial, com uma passagem em destaque alternando entre elas. A lista e a regra de alternância ainda serão definidas.

## Fontes recebidas

As páginas abaixo são as páginas dos arquivos PDF, não necessariamente sua numeração impressa. A inspeção inicial identificou estrutura e amostras; não equivale à transcrição e à revisão integral dos materiais.

| Arquivo | Páginas | Conteúdo identificado | Preparação necessária |
| --- | ---: | --- | --- |
| AT-NVI-Pt.pdf | 1.098 | Antigo Testamento: 39 livros e 929 capítulos identificáveis | Separar livros, capítulos, versículos, títulos, referências e notas; conferir a extração |
| NT-NVI-Pt.pdf | 273 | Novo Testamento: 27 livros e 260 capítulos identificáveis | Separar livros, capítulos, versículos, títulos, referências e notas; conferir a extração |
| Jornada-Da-Bíblia Parte 01 (1)_261005_200705.pdf | 15 | Introdução, organização, línguas, curiosidades e panorama dos livros | Conferir texto e diagramas |
| Jornada-Da-Bíblia Parte 02_261005_200717.pdf | 89 | Panorama de livros do Antigo Testamento, genealogias e cronologia | Grande parte do conteúdo está em imagens; requer transcrição ou OCR e revisão |
| Jornada-Da-Bíblia Parte 03_261005_200729.pdf | 68 | Hebreus, livros históricos e poéticos, profetas, período interbíblico e cânon | Conferir texto, tabelas e ordem de leitura |
| Jornada-Da-Bíblia Parte 04_261005_200740.pdf | 75 | Evangelhos, Atos, cartas e Apocalipse | Conferir texto, tabelas e diagramas |
| OS 4 EVANGELHOS (1)_261005_200648.pdf | 4 | Uma página para cada Evangelho | Páginas em imagem; requer transcrição ou OCR e revisão |

Os dois arquivos da Bíblia somam 66 livros e 1.189 capítulos identificáveis. Os cinco arquivos de estudos somam 251 páginas.

## Cuidados com a fidelidade do conteúdo

- A numeração dos versículos não deve ser confundida com referências paralelas ou notas de rodapé. Há capítulos que atravessam páginas e diferenças de cabeçalho, como “Salmo” e livros com um único capítulo.
- Cada assunto deverá manter a identificação do arquivo e das páginas que o fundamentam.
- As perguntas, respostas e explicações dos quizzes deverão ser verificáveis nas fontes. Um erro de transcrição não deve se tornar conteúdo ou gabarito.
- Algumas imagens contêm trechos ilegíveis ou inconsistentes no próprio original. Esses pontos devem ser separados para revisão, sem completar lacunas ou corrigir afirmações com conhecimento externo.
- Exemplos identificados na inspeção: trechos deformados e repetidos em “OS 4 EVANGELHOS” e um título “Samuel” em uma página com características de Juízes na Parte 02, página 57.
- Exibir apenas o PDF como imagem não atende à busca, ao ajuste da fonte ou à leitura em voz alta. Esses recursos exigem conteúdo textual estruturado e conferido.

## Decisões de implementação da primeira versão

- Navegação principal: Início, Bíblia, Estudos, Quiz e Meu progresso, com acesso às preferências.
- Progresso geral da Bíblia = capítulos concluídos ÷ 1.189; progresso do livro = capítulos concluídos no livro ÷ total de capítulos desse livro.
- Permitir desfazer a conclusão de um capítulo e retomar a última leitura.
- Separar o progresso de leitura dos estudos do desempenho nos quizzes.
- Oferecer consulta à página original junto ao texto simplificado, preservando infográficos e diagramas com alternativas acessíveis.
- Notas e referências bíblicas permanecem disponíveis no PDF de consulta; o leitor de capítulos apresenta e narra os versículos.
- Controles identificados para teclado e leitores de tela, contraste adequado e preferência por movimento reduzido.
- Seleção das 50 passagens diretamente dos arquivos da Bíblia, mantendo livro, capítulo e versículo.

## Perguntas em aberto

Próximas decisões de produto:

As decisões de nome, acesso público e liberdade entre trilhas foram registradas acima.

Outras decisões que podem ser detalhadas durante o desenvolvimento:

- Identidade visual e forma de acesso à conta.
- A primeira versão usa lições como unidade de conclusão do progresso dos estudos, separadas do desempenho nos quizzes.
- Preservação e apresentação de mapas, genealogias e demais imagens.
- Revisão dos trechos duvidosos antes da publicação.
- A primeira versão possui 5 trilhas livres, 33 assuntos, 17 resumos simplificados e 14 quizzes com 28 perguntas baseadas em páginas textuais conferidas.
- As 50 passagens foram selecionadas dos PDFs bíblicos; o destaque muda diariamente e permite alternância manual.
- Responsável por cadastrar, revisar e atualizar o conteúdo.
- Requisitos de uso sem internet e comportamento da sincronização.

## Validações previstas

- Conferir a segmentação dos livros, capítulos e versículos com os PDFs, incluindo notas e livros com formatos diferentes.
- Testar a busca por referências e a navegação entre capítulos.
- Verificar conclusão, reversão e cálculo dos progressos.
- Verificar persistência após sair e entrar e sincronização entre dispositivos da mesma conta.
- Garantir que uma conta não consiga acessar ou alterar o progresso de outra.
- Conferir fontes e gabaritos dos estudos e quizzes.
- Verificar leitura em voz alta, controles de fonte, temas, teclado, leitores de tela e telas de tamanhos diferentes.

As verificações automatizadas e os testes de navegador executados são descritos no README. A revisão editorial integral e a verificação com leitores de tela reais em diferentes aparelhos continuam necessárias; não foram substituídas por verificações de layout ou teclado.
