# Política de Segurança da Informação — Vereda Bíblica

| Campo | Definição |
| --- | --- |
| Versão | 1.0 |
| Data da proposta | 27/10/2026 |
| Status | Proposta para adoção pelo responsável pelo projeto |
| Responsável pela política | A designar |
| Canal de segurança e privacidade | A definir e testar antes da publicação |
| Revisão | Anual e após incidentes ou mudanças relevantes |

Os enunciados desta política definem requisitos. A existência do documento não comprova a implementação dos controles, não constitui certificação e não substitui a avaliação das obrigações aplicáveis. A vigência depende da aprovação do responsável pelo projeto e da designação dos papéis abaixo.

## 1. Objetivo e abrangência

Proteger a confidencialidade, a integridade e a disponibilidade das informações do Vereda Bíblica, preservando a privacidade dos leitores e a continuidade do serviço.

A política abrange equipe, colaboradores, prestadores e fornecedores com acesso ao código, às contas administrativas, à infraestrutura ou aos dados. Aplica-se ao desenvolvimento, aos testes, à produção, aos dispositivos de trabalho, ao GitHub, ao Render, ao Turso e aos backups.

A arquitetura planejada para a hospedagem gratuita utiliza o Render para executar o site e um banco Turso separado para persistir contas, sessões e progresso. Planos gratuitos, criptografia em trânsito e reinicialização bem-sucedida não demonstram, por si, backup, disponibilidade contínua ou recuperação garantida.

## 2. Responsabilidades

| Papel | Responsabilidades |
| --- | --- |
| Responsável pelo projeto/controlador a identificar | Aprovar a política, definir finalidades e responsabilidades, avaliar riscos e prover os recursos necessários. |
| Responsável técnico | Administrar acessos, atualizações, configuração, monitoramento, backups e recuperação. |
| Responsável por privacidade | Manter o inventário de tratamento, receber solicitações dos titulares e coordenar a avaliação de incidentes e obrigações de comunicação. |
| Equipe e colaboradores | Proteger os acessos, seguir os procedimentos e comunicar ocorrências imediatamente. |

Uma pessoa poderá acumular funções. Os nomes, contatos e substitutos deverão estar registrados em local interno controlado antes da publicação. Não se presume a existência de encarregado formal ou de equipe jurídica; sua necessidade e designação deverão ser avaliadas pelo responsável pelo projeto.

## 3. Classificação e acesso à informação

| Classificação | Exemplos | Regra de acesso |
| --- | --- | --- |
| Pública | Conteúdo de leitura aprovado, estudos e PDFs de consulta revisados, sem dados pessoais indevidos. | Disponibilização pública após revisão. |
| Interna | Procedimentos, planejamento e documentação operacional. | Equipe autorizada. |
| Confidencial | Nome, e-mail, identificadores de conta e registros técnicos pessoais. | Acesso mínimo para uma finalidade definida. |
| Restrita | Credenciais, identificadores de sessão, hashes de senhas, backups e histórico de leitura ou respostas vinculados à identidade. | Acesso justificado, restrito e controlado. |

Progresso de leitura, estudos e respostas podem permitir inferências sobre convicção religiosa. Essa possibilidade exige proteção reforçada, sem presumir a religião de qualquer leitor. Os dados associados a crianças e adolescentes também receberão avaliação específica de risco.

O progresso será privado por padrão. A equipe não poderá consultar informações de leitura por curiosidade, criar rankings públicos identificados ou usar esses dados para publicidade direcionada.

## 4. Privacidade, finalidade e minimização

Cada operação de tratamento deverá ter finalidade, necessidade, base legal, retenção e responsável registrados. Cadastro, autenticação, sincronização, segurança e análise de uso deverão ser avaliados separadamente.

Dados que revelem ou permitam inferir informações sensíveis exigem avaliação das hipóteses específicas da LGPD. Interesse legítimo ou execução do serviço não deverão ser adotados automaticamente como justificativa para o tratamento de dados sensíveis.

A leitura do conteúdo público permanecerá disponível sem cadastro. A conta servirá às funcionalidades claramente informadas, incluindo sincronização do progresso. O usuário deverá compreender o que permanece no navegador e o que é enviado ao servidor.

Documentos, endereço, telefone e data completa de nascimento não serão coletados sem necessidade demonstrada. Novas informações ou finalidades exigirão avaliação prévia. O histórico detalhado e as respostas individuais só deverão ser mantidos enquanto necessários às funcionalidades informadas.

Um Aviso de Privacidade deverá explicar ao público os dados tratados, as finalidades, as bases aplicáveis, os fornecedores, os compartilhamentos, as transferências, a retenção, os direitos e o contato. Esta política interna não substitui esse aviso.

## 5. Crianças e adolescentes

O tratamento observará o melhor interesse desse público, com linguagem compreensível e sem indução a fornecer dados desnecessários. A base legal de cada operação deverá ser definida antes de disponibilizar contas para crianças e adolescentes.

Quando o tratamento de dados de crianças depender de consentimento, deverá existir consentimento específico e destacado de pelo menos um responsável, acompanhado de esforços razoáveis e proporcionais de verificação. Não se adotará uma idade mínima estrangeira como regra brasileira nem se coletarão documentos completos apenas para demonstrar conformidade.

O cadastro de crianças só deverá ser disponibilizado após a implementação e a validação do fluxo apropriado. O acesso ao conteúdo público sem cadastro continuará disponível. Progresso, desempenho e identificação de menores não serão expostos publicamente.

## 6. Acessos administrativos, autenticação e sessões

- Contas administrativas serão individuais, com o menor privilégio necessário. MFA será habilitado no GitHub, Render e Turso conforme os recursos disponíveis.
- Acessos serão revisados trimestralmente e revogados quando cessar sua necessidade, inclusive no desligamento de colaboradores.
- Senhas serão armazenadas como hashes resistentes, com salt criptográfico individual. Parâmetros, memória e concorrência serão definidos e medidos para a infraestrutura usada.
- Novos cadastros exigem de 6 a 128 caracteres, com pelo menos uma letra e um caractere especial; números são opcionais. Espaços não substituem o caractere especial. A mesma regra será validada no formulário e no servidor. Senhas de contas existentes continuam aceitas no login. Não haverá trocas periódicas arbitrárias; senhas comprometidas exigirão substituição.
- Sessões terão identificadores aleatórios, expiração validada pelo servidor e cookies `HttpOnly`, `Secure` em HTTPS e `SameSite` adequado.
- Toda autorização usará a identidade obtida da sessão pelo servidor. Um identificador de usuário enviado pelo navegador não poderá conceder acesso a outra conta.
- Login, cadastro, recuperação e sincronização terão validação de entradas, limites de tentativas e respostas que não revelem desnecessariamente a existência de uma conta.

Como referência inicial, propõem-se sete dias de duração absoluta e 24 horas sem uso para as sessões. Os limites precisam de implementação e testes; a definição nesta política não comprova sua aplicação.

A recuperação de senha deverá usar tokens aleatórios, de uso único, armazenados por hash e com validade curta, proposta de 30 minutos. Links usarão a origem pública configurada, e a redefinição invalidará as sessões anteriores. O suporte não poderá conceder acesso por simples declaração de identidade.

## 7. Segredos e credenciais

Tokens, senhas administrativas e chaves privadas serão mantidos em armazenamento apropriado para segredos. `DATABASE_AUTH_TOKEN` ficará exclusivamente no backend, fora de variáveis `VITE_*`, arquivos públicos, Git, bundles, logs, capturas e conversas.

Credenciais serão limitadas ao recurso necessário. Exposição, suspeita de comprometimento, mudança de privilégios ou saída de colaborador exigirão avaliação e substituição. A rotação incluirá atualização do serviço, verificação de funcionamento e confirmação da revogação da credencial anterior.

O valor de um segredo não deverá ser solicitado por chat ou e-mail. Capturas e exemplos utilizarão valores fictícios ou ocultados de forma efetiva.

## 8. Desenvolvimento, infraestrutura e fornecedores

Alterações deverão ser revisáveis e acompanhadas de testes proporcionais e procedimento de reversão. Dependências e lockfiles serão mantidos com verificação de integridade, vulnerabilidades e segredos. A instalação e a investigação de falhas preservarão a verificação TLS e os hashes dos artefatos.

A infraestrutura deverá:

- Usar HTTPS na publicação e conexão protegida com o banco remoto.
- Separar testes e produção; testes não usarão contas nem dados pessoais reais.
- Persistir contas e progresso fora do disco temporário do serviço web.
- Falhar de forma explícita quando o banco remoto estiver indisponível, sem criar silenciosamente um banco local substituto na hospedagem.
- Definir limites de tamanho, tempo, concorrência e repetição das operações externas.
- Usar consultas parametrizadas, transações e autorização por conta, incluindo operações em lote e sincronização.
- Aplicar proteção contra execução de scripts, CSRF, enquadramento indevido e exposição de informações em erros.
- Configurar CSP e cabeçalhos conforme testes da aplicação; políticas somente em modo de relatório não serão tratadas como bloqueio efetivo.
- Confiar em cabeçalhos de proxy somente conforme a topologia documentada do serviço.
- Registrar eventos necessários, sem corpos completos de requisição, credenciais, cookies ou conteúdo detalhado do progresso.

Regiões reais de processamento, contratos, operadores e subprocessadores deverão ser documentados. Transferências internacionais, quando existentes, deverão ter o tratamento jurídico e contratual aplicável. A residência do banco em uma região não comprova a residência de todos os dados da solução.

## 9. Dados no navegador e dispositivos compartilhados

O armazenamento local deverá ser explicado ao leitor. `localStorage` não oferece confidencialidade contra outra pessoa com acesso ao dispositivo ou contra scripts executados na mesma origem.

Senhas, tokens de sessão e credenciais do banco não poderão ser guardados nesse armazenamento. Caches e filas serão separados por conta. Logout e troca de usuário não poderão expor dados da conta anterior nem enviar suas alterações para outra pessoa.

Alterações pendentes de sincronização terão tratamento seguro e informado. A aplicação não deverá apagar silenciosamente uma fila legítima nem declarar uma sessão encerrada no servidor quando essa operação não tiver sido confirmada.

## 10. Retenção, direitos e eliminação

Os prazos abaixo são metas operacionais propostas e precisam de implementação. Não são prazos legais genéricos. Obrigações de guarda e outras regras aplicáveis prevalecerão após avaliação documentada.

| Informação | Retenção proposta |
| --- | --- |
| Cadastro e progresso | Enquanto a conta existir e a finalidade permanecer válida, com revisão anual da necessidade. |
| Dados de conta excluída | Remoção dos sistemas ativos em até 15 dias após pedido validado, salvo obrigação de conservação. |
| Logs operacionais | 30 dias. |
| Logs de segurança | 90 dias, ressalvados prazos legais aplicáveis. |
| Backups | Janela inicial de 30 dias, com expiração controlada. |
| Evidências de incidentes | Prazo definido conforme obrigação legal e necessidade de prova documentadas. |

O canal de privacidade receberá pedidos de acesso, correção, exclusão e revogação de consentimento, conforme aplicável. A identificação do solicitante será proporcional ao risco e não criará coleta excessiva.

Exclusões considerarão sistemas ativos, caches, filas e backups. Cópias remanescentes terão acesso restrito e expiração documentada; uma restauração deverá reaplicar exclusões válidas para não reintroduzir dados eliminados.

## 11. Backup e continuidade

Backups terão acesso restrito, proteção adequada e recuperação independente de falhas da aplicação. Recursos, limites e retenção efetivamente disponíveis nos planos usados deverão ser confirmados.

As metas iniciais são RPO de 24 horas, como objetivo de perda máxima potencial de um dia de alterações, e RTO de 48 horas, como objetivo de recuperação do serviço em dois dias. São metas sujeitas à implementação e à verificação, sem promessa de SLA.

Uma restauração será testada antes da publicação e trimestralmente, além de após mudanças relevantes. Se os recursos disponíveis não atenderem às metas, a limitação e a decisão sobre arquitetura e recursos serão registradas antes de afirmar recuperabilidade.

## 12. Incidentes, exceções e revisão

Suspeitas de vazamento, credencial exposta, acesso indevido, mistura de dados entre contas ou perda de informações serão comunicadas imediatamente ao responsável técnico, com meta interna de uma hora após identificação.

A equipe preservará evidências, conterá o incidente, identificará os dados e as pessoas afetadas, corrigirá a causa e validará a recuperação. A avaliação de comunicações externas será documentada, considerando especialmente credenciais, dados sensíveis e menores.

As comunicações obrigatórias seguirão a legislação vigente. A Resolução CD/ANPD nº 15/2024 estabelece, como regra geral, três dias úteis para comunicação à ANPD e aos titulares em incidentes com possibilidade de risco ou dano relevante, observadas as regras de contagem e exceções aplicáveis. A vigência e a aplicação deverão ser confirmadas no atendimento, sem retardar a resposta. Nem todo evento exige comunicação externa.

Exceções à política terão motivo, responsável, prazo e medida compensatória registrados. Esta política será revista anualmente e após incidentes relevantes, mudanças de arquitetura ou novas operações com dados.

## Adoção e documentos relacionados

Antes da publicação, devem ser resolvidas e evidenciadas as pendências de responsáveis/canais, Aviso de Privacidade, contas infantis, recuperação de conta, retenção/eliminação e backups reais. A implementação técnica e os testes de cada controle serão registrados com data, versão e ambiente; não se presume sua conclusão a partir desta proposta.

- [Guia de boas práticas](boas-praticas-seguranca.md)
- [Procedimento de resposta a incidentes](resposta-incidentes.md)
- [Validações do projeto](validacao.md)
- [Preparação de publicação](publicacao.md)

Referências normativas a consultar na adoção e revisão: Lei nº 13.709/2018 (LGPD), orientações vigentes da ANPD sobre crianças e adolescentes, Resolução CD/ANPD nº 15/2024 e regras aplicáveis de guarda de registros.
