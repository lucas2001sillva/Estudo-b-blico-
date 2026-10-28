# Procedimento de resposta a incidentes — Vereda Bíblica

Versão 1.0, proposta de 27/10/2026. Vinculado à [Política de Segurança da Informação](politica-seguranca.md). O responsável técnico, o responsável por privacidade, seus substitutos e os canais precisam ser definidos antes de adotar este procedimento.

## 1. Acionamento

Comunique imediatamente ao responsável técnico, com meta interna de uma hora após identificação, situações como:

- Credencial, cookie ou token exposto.
- Acesso ou alteração de dados de outra conta.
- Progresso ou respostas de uma pessoa aparecendo para outra.
- Perda, alteração indevida ou possível extração de dados.
- Comprometimento de conta administrativa, aplicação ou dependência.
- Indisponibilidade com risco à integridade ou recuperação das informações.

A meta interna de uma hora não substitui prazo legal nem representa cobertura contínua já estabelecida. A escala e o canal de atendimento ainda devem ser designados.

## 2. Registro inicial

Abra um registro interno restrito contendo:

| Campo | Conteúdo |
| --- | --- |
| Identificador | Código interno sem dados pessoais. |
| Momento | Data/hora da descoberta, timezone e momento em que o responsável tomou conhecimento. |
| Relator | Identificação e canal interno do relator. |
| Ambiente e versão | Serviço afetado e versão do código/configuração. |
| Sinais observados | Fatos conhecidos, hipóteses separadas e evidências necessárias. |
| Dados e pessoas potencialmente afetados | Categorias e estimativa inicial, com atenção a dados sensíveis e menores. |
| Medidas | Contenção, responsáveis, decisões e horários. |
| Pendências | Perguntas abertas e próxima atualização. |

Não inclua valores de tokens, senhas ou cópias integrais de dados pessoais no registro. Preserve evidências em local restrito, mantendo integridade, origem e acesso documentados.

## 3. Conter e investigar

1. Avalie a urgência. Credencial exposta, acesso entre contas ou extração em curso exigem contenção imediata.
2. Restrinja a funcionalidade ou o acesso afetado quando necessário, preservando o máximo possível de evidências.
3. Revogue credenciais comprometidas e atualize as dependências de acesso com procedimento controlado. Confirme que a credencial anterior deixou de funcionar.
4. Identifique o período, sistemas, dados e titulares potencialmente afetados. Separe fatos confirmados das hipóteses.
5. Evite apagar logs, resetar bancos ou restaurar produção antes de preservar as evidências necessárias e definir o plano de recuperação.
6. Corrija a causa e verifique se o caminho de exploração foi fechado. Alterações e restaurações terão responsável e registro.

## 4. Avaliar comunicações

O responsável por privacidade avaliará a necessidade de comunicação à ANPD, aos titulares e a outros envolvidos, considerando natureza dos dados, credenciais, dados sensíveis, menores, extensão e possibilidade de risco ou dano relevante.

As comunicações seguirão a regra legal vigente. A Resolução CD/ANPD nº 15/2024 estabelece, como regra geral, três dias úteis para comunicação à ANPD e aos titulares em incidentes com possibilidade de risco ou dano relevante, observadas as regras de contagem e exceções aplicáveis. Confirme a vigência e a aplicação ao caso, registrando o marco de conhecimento do controlador e a decisão. A avaliação não deverá retardar contenção ou prazos obrigatórios.

Nem todo evento exige comunicação externa. A decisão, inclusive a de não comunicar, será fundamentada e registrada. A equipe não divulgará detalhes pessoais ou técnicos desnecessários em mensagens públicas.

## 5. Recuperar e encerrar

1. Recupere o serviço a partir de uma versão e de dados cuja integridade tenha sido avaliada.
2. Restaure backups primeiro em ambiente isolado e valide a consistência antes de substituir dados ativos.
3. Reaplique exclusões válidas e confirme que caches, filas e credenciais antigas não reintroduzem o problema.
4. Teste login, isolamento entre contas, leitura e atualização de progresso, respostas e preferências, além do controle que falhou.
5. Monitore a recuperação e registre dados possivelmente perdidos ou ainda não confirmados.
6. Documente causa, impacto, ações, evidências, obrigações cumpridas, responsáveis e melhorias com prazo.

As metas propostas de RPO de 24 horas e RTO de 48 horas deverão ser comparadas com a execução real, sem declarar garantia de recuperação não demonstrada. O encerramento exige registro das pendências e revisão dos controles afetados.
