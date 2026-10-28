# Guia de boas práticas de segurança — Vereda Bíblica

Versão 1.0, proposta de 27/10/2026. Este guia operacionaliza a [Política de Segurança da Informação](politica-seguranca.md). Os itens são requisitos de trabalho e verificação, não declarações de que os controles já foram aplicados.

Para cada verificação, registre responsável, data, ambiente, versão do código, resultado e evidência sem dados pessoais ou segredos. As verificações executadas ficam separadas das pendências em [validacao.md](validacao.md).

## 1. Rotina da equipe

| Situação | Prática |
| --- | --- |
| Acesso administrativo | Usar conta individual, MFA e gerenciador de senhas; conceder apenas o acesso necessário. |
| Dispositivo de trabalho | Manter atualizações, bloqueio de tela e proteção do armazenamento; restringir acesso físico e a perfis do navegador. |
| Desenvolvimento e suporte | Trabalhar com dados fictícios. Acessar dados reais somente por necessidade definida e com autorização correspondente. |
| Capturas e mensagens | Ocultar efetivamente credenciais, e-mail, identificadores e histórico privado. Preferir uma reprodução com dados fictícios. |
| Ferramentas de IA e serviços externos | Não enviar credenciais, backups ou dados pessoais reais sem avaliação e autorização apropriadas. |
| Alterações do sistema | Manter mudanças revisáveis, testes relevantes e caminho de reversão. |
| Saída de colaborador | Remover acessos, revisar credenciais afetadas e confirmar a revogação. |
| Suspeita de incidente | Comunicar imediatamente pelo canal interno definido e seguir o procedimento, preservando evidências. |

A equipe não deverá consultar leituras, estudos ou quizzes para descobrir a religião de alguém, publicar desempenho identificado ou expor informações de menores.

## 2. Acessos e segredos

- Mantenha MFA nas contas administrativas do GitHub, Render e Turso conforme os recursos disponíveis. Guarde mecanismos de recuperação de maneira protegida e com responsável definido.
- Revise acessos trimestralmente e sempre que houver mudança de função.
- Configure `DATABASE_URL` e `DATABASE_AUTH_TOKEN` no backend do serviço. O token não deve usar prefixo `VITE_`, integrar o bundle ou ficar em arquivos versionados.
- Use credenciais limitadas ao banco necessário. A existência de uma URL de conexão não substitui o token de autenticação.
- Em exposição ou suspeita de comprometimento, substitua a credencial, atualize o serviço e confirme a revogação da anterior. Avalie o acesso ocorrido durante o período de risco.
- A verificação de segredos deve indicar somente arquivo, localização e resultado sanitizado; não imprima o valor encontrado.

## 3. Configuração da infraestrutura

| Componente | Conferência necessária |
| --- | --- |
| Render | Serviço com HTTPS, acesso administrativo individual e configuração de proxy compatível com a topologia real. |
| Turso | Banco correto, token com escopo apropriado, conexão TLS, regiões e acessos documentados. |
| Persistência | Contas, sessões e progresso fora do disco temporário do serviço web. Reiniciar o serviço e verificar os mesmos dados em teste. |
| Produção | `REQUIRE_REMOTE_DATABASE=1` e falha explícita se URL/token não estiverem disponíveis; ausência de fallback local silencioso. |
| Proxy e cookies | `Secure` em HTTPS, `HttpOnly`, `SameSite` adequado; confiar somente no proxy esperado, sem aceitar indiscriminadamente cabeçalhos encaminhados. |
| Conexões | Limites de tempo, concorrência e repetição; cancelamento real de trabalho em rede quando houver timeout. |
| Recuperação | Recursos de backup e exportação confirmados no plano usado, responsáveis e restauração demonstrada. |

Confirme os limites e os recursos exibidos pelos serviços antes da publicação. Banco remoto persistente e transporte TLS não substituem backup, monitoramento ou controle de acesso.

## 4. Desenvolvimento seguro

### Dependências e revisão

- Instale a partir do lockfile e preserve verificação de TLS e integridade dos pacotes.
- Revise atualizações e alertas; priorize vulnerabilidades graves aplicáveis ao código executado e registre o tratamento das demais.
- Analise alterações de autenticação, autorização, banco, dados no navegador, configuração de produção e tratamento de erros com atenção específica.
- Evite dados reais em fixtures, exemplos, capturas, relatórios e testes automatizados.

Os comandos disponíveis no projeto incluem:

```sh
npm ci --include=dev
npm test
npm run build
npm run test:e2e
```

A integração de banco remoto de teste usa `node scripts/check-remote-database.mjs` e depende dos requisitos descritos no próprio script. Execute-a apenas com bancos e recursos temporários isolados. Um resultado só será considerado aprovado após o término observado e as verificações concluídas.

### Autenticação e autorização

- Alinhe as regras de senha entre interface e backend; o servidor deve validar as entradas independentemente do navegador.
- Armazene apenas hash resistente e salt individual. Meça custo e concorrência para a capacidade disponível; não reduza a proteção apenas para esconder falhas de infraestrutura.
- Use mensagens de autenticação que evitem revelar desnecessariamente se um e-mail existe.
- Limite tentativas por critérios adequados, considerando também redes compartilhadas por famílias e escolas. Contadores terão expiração e comportamento definido após reinicializações.
- Derive a conta da sessão no servidor. Teste manipulação de IDs, campos extras, atualizações em lote e acesso a endpoints privados.
- Use tokens de recuperação de senha de uso único, por hash e com validade curta. Gere links a partir da origem pública configurada, sem confiar no `Host` fornecido pelo cliente.

### Página, API e navegador

- Configure e teste CSP compatível com os scripts e estilos usados pelo React. Um modo de relatório ajuda a ajustar a política, mas não bloqueia ataques.
- Revise pontos de inserção de HTML, URLs e conteúdo importado. Prefira renderização textual e evite execução de conteúdo dos PDFs.
- Proteja mudanças de estado contra CSRF e valide a origem e o formato dos pedidos. Limite corpo, lotes e campos aceitos.
- Use uma política de referência que evite divulgar caminhos privados a terceiros; limite enquadramento, recursos e conexões ao necessário.
- Não salve senha, token de sessão ou token do banco em `localStorage`.
- Separe dados anônimos de dados privados e filas por conta. A importação de progresso de visitante deverá ser informada e intencional.
- Após logout confirmado, evite caches privados acessíveis à próxima pessoa no dispositivo. Uma resposta atrasada não pode restaurar a conta anterior.
- Em indisponibilidade da rede, preserve alterações legítimas e informe a situação; não finja encerramento remoto confirmado nem elimine silenciosamente a fila.

## 5. Banco, logs e materiais de estudo

Use consultas parametrizadas e transações para operações relacionadas. Respostas de sucesso e emissão de sessão devem ocorrer após a confirmação da persistência correspondente.

Defina timeouts para conexão, resposta e leitura do corpo; não confunda espera por bloqueio SQLite com prazo de rede. Repita escritas somente quando houver garantias de idempotência ou de transação, evitando duplicar tentativas de quiz ou sobrescrever progresso.

Logs deverão conter o mínimo necessário para diagnosticar eventos, com acesso restrito e retenção definida. Não registre corpos completos, senhas, cookies, tokens, respostas individuais de quiz ou listas de capítulos lidos. Trate mensagens de erro e entradas registradas como conteúdo não confiável; sanitize respostas do SDK para não divulgar detalhes da conexão.

Mantenha a origem e a integridade dos materiais importados. Use cópias de consulta revisadas, sem campos pessoais sobrepostos indevidos. Texto ilegível ou duvidoso deve permanecer sinalizado e não servir de gabarito confirmado. A equipe não deverá substituir a fonte por informação inventada durante a conversão.

## 6. Backup e teste de restauração

1. Identifique os dados cobertos: contas, hashes, sessões quando cabível, progresso, quizzes e preferências, além das configurações necessárias à recuperação.
2. Confirme o método de backup ou exportação efetivamente disponível e a consistência da cópia.
3. Proteja o backup, restrinja acesso, registre a retenção e mantenha a recuperação independente de uma falha da aplicação.
4. Restaure em destino isolado, sem substituir o banco de produção nem usar suas credenciais para testes.
5. Verifique contas de teste, login, capítulos, lições, preferências e respostas. Reaplique exclusões válidas e confirme a limpeza do ambiente temporário.
6. Registre o resultado e compare com as metas propostas de RPO de 24 horas e RTO de 48 horas. Se não forem atendidas, registre a limitação e a decisão necessária.

Para SQLite local, use um método consistente de backup. Copiar apenas o arquivo `.sqlite` durante gravações pode desconsiderar dados presentes no WAL. Exporte ou use a API apropriada, com verificação de restauração. Os mesmos cuidados de proteção se aplicam a dumps SQL que contenham dados pessoais e hashes.

## 7. Checklist antes da publicação

- [ ] Responsáveis, substitutos e canal de segurança/privacidade designados e testados.
- [ ] Finalidades, bases legais, fornecedores, regiões, transferências e retenção documentados.
- [ ] Aviso de Privacidade publicado em linguagem adequada, incluindo o público mais jovem.
- [ ] Fluxos apropriados de contas infantis, recuperação de conta e direitos dos titulares implementados e verificados.
- [ ] Conta B não lê, altera nem recebe dados da conta A, mesmo com requisições manipuladas.
- [ ] Logout, troca de conta e respostas atrasadas não expõem ou enviam dados da conta anterior.
- [ ] Progresso e respostas legítimos permanecem consistentes entre dispositivos e após reiniciar o serviço.
- [ ] Falha do banco resulta em erro controlado, sem sucesso falso, cookie indevido ou fallback temporário.
- [ ] Tentativas repetidas e concorrentes não duplicam resultados nem apagam campos independentes.
- [ ] Cookies, proxy, HTTPS, CSP e proteção de origem verificados na configuração de produção.
- [ ] Segredos ausentes do Git, frontend, relatórios e logs.
- [ ] Backup restaurado e procedimento de exclusão considerado na recuperação.
- [ ] Testes relevantes concluídos, com resultados passados, falhos e não executados distinguidos.
- [ ] Plano de reversão e procedimento de incidentes disponíveis para o responsável de plantão definido.

As pendências de contas infantis, recuperação de conta, retenção, eliminação e backup real precisam de resolução e evidência. Uma lista marcada sem teste correspondente não demonstra atendimento ao requisito.

## 8. Cadência e registro

| Frequência | Atividade |
| --- | --- |
| A cada alteração | Revisão, testes relevantes, verificação de segredos e análise da necessidade de atualização dos documentos. |
| Semanalmente | Revisar alertas, falhas de autenticação, erros do serviço e dependências. |
| Mensalmente | Conferir execução de backups, credenciais e recursos dos serviços. |
| Trimestralmente | Revisar acessos e testar restauração. |
| Anualmente | Revisar política, inventário, fornecedores e treinamento. |
| Após incidente ou mudança relevante | Reavaliar riscos, controles e procedimentos afetados. |

Registro mínimo de verificação: `data | versão | ambiente | responsável | controle | resultado | evidência sanitizada | ação pendente | prazo`.

Em incidentes, siga [resposta-incidentes.md](resposta-incidentes.md). Não publique evidências privadas em issues públicas ou mensagens abertas.
