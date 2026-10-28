# Publicar no Render Free com banco Turso

O serviço web executa no plano Free do Render. Contas, sessões, progresso, respostas e preferências ficam no banco externo Turso, acessado somente pelo backend. Reiniciar ou substituir o servidor web não deve apagar esses dados.

O usuário já possui conta no Render e criou o banco Turso. O token não foi fornecido ao projeto nem deve ser colocado no GitHub ou no chat. A conexão com o banco real ainda depende dessa credencial e da validação depois da publicação.

Esta etapa prepara uma implantação para validação. Antes de divulgar o cadastro ao público, defina o responsável e o canal de privacidade, publique o aviso de privacidade e resolva a base legal e o fluxo de contas para crianças e adolescentes conforme a política. Esses fluxos ainda não estão implementados; o formulário atual não verifica idade nem consentimento de responsável. Use contas de teste de adultos autorizados na validação. O conteúdo público pode ser lido sem cadastro.

## Código e serviço

Repositório: `lucas2001sillva/Estudo-b-blico-`. Branch de publicação: `codex/vereda-biblica`.

Antes de criar o serviço, confirme no GitHub que essa branch contém `package.json`, `server/`, `content/`, `src/` e `render.yaml`. Consulte o histórico da branch para identificar a versão implantada. Um arquivo local de configuração sozinho não envia código nem publica o serviço.

No Render, abra **New → Web Service**, conecte o repositório e escolha a branch de publicação:

| Campo | Valor |
| --- | --- |
| Name | `vereda-biblica` ou outro nome disponível |
| Language / Runtime | Node |
| Branch | `codex/vereda-biblica` |
| Build Command | `npm ci --include=dev --no-audit --no-fund && npm run build && npm prune --omit=dev --no-audit --no-fund` |
| Start Command | `npm start` |
| Instance Type | **Free** |
| Health Check Path | `/api/health` |

O Render fornece `PORT` e o servidor escuta em `0.0.0.0`. Não é necessário contratar um disco persistente no Render para este modo: o banco está no Turso.

## Variáveis no Render

Em **Environment**, o nome da coluna **Key** é definido pelo aplicativo; não precisa aparecer como rótulo na janela do Turso.

| Key | Value |
| --- | --- |
| `NODE_VERSION` | `24` |
| `NODE_ENV` | `production` |
| `REQUIRE_REMOTE_DATABASE` | `1` |
| `SECURE_COOKIES` | `1` |
| `TRUST_PROXY` | `1`, para o proxy imediatamente à frente do serviço no Render |
| `DATABASE_REQUEST_TIMEOUT_MS` | `10000` |
| `DATABASE_URL` | `libsql://vereda-biblica-lucas2001sillva.aws-sa-east-1.turso.io` |
| `DATABASE_AUTH_TOKEN` | Token gerado no Turso para esse banco, preenchido diretamente no Render |

Na janela **Token Created** do Turso, o campo de cima é o token e o campo de baixo é a URL. Use o botão de copiar de cada campo. Guarde o token de forma privada: o provedor informa que ele não será mostrado novamente.

`PUBLIC_ORIGIN` só precisa ser configurado quando a infraestrutura não preservar a origem pública esperada. Se necessário, use a origem HTTPS real do serviço, sem caminhos. Não configure origens abertas para contornar uma falha de autenticação.

O `render.yaml` contém a mesma configuração, com plano explicitamente gratuito e URL do banco preenchida. A criação por **Blueprint** é uma alternativa ao formulário manual e solicitará `DATABASE_AUTH_TOKEN`. Use apenas um dos métodos para criar o serviço.

## Publicar e verificar

Depois de conectar o código e preencher as variáveis, use **Create Web Service** e acompanhe o build. Use o endereço HTTPS fornecido pelo Render; não existe endereço público confirmado antes dessa etapa.

Confira no serviço publicado:

1. A página inicial, os 66 livros, uma referência como João 3:16 e um PDF de consulta.
2. Cadastro e login de uma conta de teste, conclusão de capítulo, estudo, quiz e alteração de tema.
3. A mesma conta em outro navegador, verificando a sincronização.
4. Logout e entrada de outra conta, sem herdar dados privados da anterior.
5. Reinicialização ou novo deploy do serviço web, confirmando que a conta e o progresso continuam no Turso.
6. Uma cópia de backup e uma restauração isolada antes de afirmar que a recuperação está assegurada.

O aplicativo recusa iniciar no Render sem banco remoto e token. Uma falha do Turso deve gerar erro controlado, não criar silenciosamente um SQLite temporário.

## Operação e limites

- Planos gratuitos têm limites e podem suspender recursos por inatividade ou consumo. Confirme as condições exibidas nos painéis; não há promessa de disponibilidade contínua ou capacidade ilimitada.
- Registre as regiões reais da aplicação, banco e backups. Avalie operadores e transferências aplicáveis no aviso de privacidade.
- Rotacione uma credencial exposta ou substituída e atualize o segredo no Render. Teste a nova conexão e a revogação da credencial anterior.
- Recuperação de senha por e-mail, fluxos de contas infantis, exclusão de conta e rotina de backups ainda precisam das implementações e avaliações descritas na política de segurança.

## Desenvolvimento e verificação local

O modo local usa SQLite compatível em `var/vereda.sqlite`, fora do Git, quando `DATABASE_URL` não está definido. Os testes usam arquivos e contêineres temporários.

```sh
npm ci
npm test
npm run build
npm run test:e2e
node scripts/check-remote-database.mjs
```

O último comando exige Docker e testa o protocolo HTTP com o servidor oficial libSQL em loopback. Ele não comprova conexão nem TLS com o banco hospedado do usuário.

O Dockerfile continua disponível. Para construir, use `bash scripts/docker-build.sh`; no modo SQLite local, persista todo `/app/var`, gravável pelo usuário `node`. No modo remoto, os dados estão no banco externo. Certificados de proxy já confiáveis podem ser passados temporariamente ao build, sem desabilitar TLS ou copiá-los à imagem final.

## Referências

- Exemplo oficial Render: <https://raw.githubusercontent.com/render-examples/express-hello-world/main/render.yaml>.
- SDK oficial libSQL: <https://github.com/tursodatabase/libsql-client-ts>.
- Servidor oficial para integração: <https://github.com/tursodatabase/libsql/blob/main/docs/DOCKER.md>.
