# API02 · Registo da ficha

Ficheiros de entrega: `sugestoes.openapi.yaml` (contrato v2.0.0), `servidor/` (servidor e cliente) e este registo. O registo responde aos pontos «Antes de avançar», preenche as tabelas de verificação (pontos 27, 28 e 30), regista as observações do cliente (ponto 29) e a reflexão crítica (ponto 31).

---

## Execução e utilizadores de teste

```
cd servidor
npm install
cp .env.exemplo .env        # preencher JWT_SEGREDO com 32 ou mais caracteres aleatórios
node --env-file=.env servidor.js
```

O cliente fica em `http://localhost:3000/` e o contrato em `http://localhost:3000/v2/openapi.yaml`. É necessário Node.js 20.6 ou superior (`--env-file`).

| Utilizador | Nome | Papel | Palavra-passe |
| ---------- | ---- | ----- | ------------- |
| `12345` | Ana Silva | `aluno` | `AnaSilva#2026` |
| `67890` | Bruno Costa | `aluno` | `BrunoCosta#2026` |
| `rita.sousa` | Rita Sousa | `servicos` | `RitaSousa#2026` |

As palavras-passe constam apenas deste registo. `dados/utilizadores.json` guarda só o hash bcrypt (custo 10), gerado com `node gerar-hash.js <palavra-passe>`.

---

## 2.2 · Diagnóstico inicial

**(a)** O `numeroAluno` no corpo é apenas o que o cliente **afirma**. Qualquer pessoa pode escrever `"12345"` num pedido, e o servidor não tem nada que o ligue a quem enviou o pedido.

**(b)** Com um JWT intercetado é possível **ler** o payload (`sub`, `nome`, `papel`, `exp`), porque base64url não é cifra, e **usá-lo** tal como está até expirar, porque no esquema Bearer a posse basta. Sem o segredo **não** é possível alterar o payload nem criar outro token: a assinatura deixa de corresponder.

**(c)** Perante um `401`, o cliente pode autenticar-se de novo e repetir o pedido. Perante um `403`, repetir com a mesma identidade dá o mesmo resultado; só outra identidade (outro papel) o mudaria.

**(d)** Com `Authorization`, o mesmo URL devolve conteúdos diferentes consoante quem pede. Sem `private`, uma cache partilhada podia guardar a resposta de um utilizador e entregá-la a outro.

---

## 4.1 · Contrato: «Antes de avançar»

### Que cliente da v1 deixa de funcionar (ver CA1)

Deixa de funcionar **todo o cliente da v1 que use sugestões ou acompanhamentos**: não envia `Authorization` e as sete operações protegidas respondem `401`. Um cliente que só lê categorias e estatísticas continua a funcionar, mudando apenas o URL base para `/v2`.

Na reflexão da API01 (pergunta sobre a `v1` e uma propriedade obrigatória nova), a conclusão foi que uma alteração que **obriga o cliente a enviar algo novo** quebra os clientes existentes e exige `v2`. A exigência do token é exatamente isso, aplicada a quase todos os pedidos: por isso a versão passa a `2.0.0` e o URL base a `/v2`, em vez de `1.1.0` em `/v1`. Esta alteração é também a resposta à última pergunta do CA5 da API01 («um aluno só edita as suas sugestões?»), que ficou sem resposta por exigir autenticação.

### Cliente da v1 envia `numeroAluno` no `POST /sugestoes` (ver CA2)

O contrato **aceita** esse corpo. `SugestaoNova` deixou de declarar `numeroAluno`, mas, sem `additionalProperties: false` (excluído), uma propriedade não declarada é permitida. O servidor deve **ignorar** o valor e gravar como `numeroAluno` o `sub` do token; usar o valor do corpo voltaria a pôr a identidade nas mãos do cliente. A `description` de `criarSugestao` regista isso.

### Cache: respostas que dependem da identidade (ver CA4)



Nenhuma resposta dependente da identidade ficou com `public`.

### Notas sobre o contrato

- **Exemplo do `401` de `listarSugestoes`.** O `401` é referido com `$ref` a `NaoAutenticado`, e tudo o que está ao lado de um `$ref` é ignorado. Por isso o exemplo está dentro da resposta `NaoAutenticado` e aplica-se a todas as operações que a referem, incluindo `listarSugestoes`.
- **Exemplo do `200` de `criarToken`.** É um JWT real, assinado com um segredo usado só para o exemplo (não o do servidor), com o payload do enquadramento (Ana Silva, `iat` 1791554400, `exp` 1791555300).
- **Exemplo do `200` de `obterSugestao`.** Passou a ter `numeroAluno: '12345'` (a Ana), coerente com os dados do servidor.
- **`responsavel`.** Mantém o `pattern` da API01 (`^[A-Z][a-z]+ [A-Z][a-z]+$`). O nome vem agora do token, por isso um membro dos serviços com nome acentuado (por exemplo «João Gonçalves») produziria acompanhamentos que não cumprem o contrato. Com os utilizadores de teste não acontece, mas é uma limitação herdada.

**Validação:** `npx @redocly/cli lint sugestoes.openapi.yaml` → válido, sem erros. Ficam dois avisos já existentes na API01: falta `license` em `info` e `listarCategorias` não tem resposta `4xx`. O `@apidevtools/swagger-parser` também o dá como válido.

---

## 4.2 · Servidor: «Antes de avançar»

### Opções passadas a `jwt.verify` (ver CA5)

```js
jwt.verify(token, segredo, { algorithms: ['HS256'] })
```


O token `alg: none` de T11 é recusado pela biblioteca mesmo sem `algorithms` (`jwt signature is required`). A opção continua necessária: sem ela, é o cabeçalho do token, escrito por quem o envia, que escolhe o algoritmo dentro dos que a biblioteca aceita por omissão.

Limite: o jsonwebtoken não exige que o token tenha `exp`. Os tokens deste servidor têm sempre `exp` (`expiresIn`), e só quem tem o segredo poderia criar um sem ele.

### Outras decisões de implementação

- **Hash fixo.** Quando o utilizador não existe, `bcrypt.compare` corre contra um hash fixo (custo 10, de uma palavra-passe aleatória que não pertence a ninguém). Medido: T2 e T3 demoram ambos cerca de 0,08 s.
- **Esquema `Bearer`.** É aceite em maiúsculas ou minúsculas, porque o RFC 9110 define os esquemas como insensíveis a maiúsculas.
- **`JWT_VALIDADE` inválido** (não inteiro ou menor que 1) também impede o arranque, com mensagem explícita.
- **Caminhos `/v2` não implementados** respondem `404` com corpo `Erro`, em vez da página HTML do Express.
- **bcrypt e 128 caracteres.** O bcrypt só usa os primeiros 72 bytes da palavra-passe; o contrato admite até 128 caracteres. Duas palavras-passe longas iguais nos primeiros 72 bytes seriam equivalentes.

---

## 4.4 · Verificação

### Contrato (ponto 27)

Cada alteração foi introduzida sozinha, sobre o ficheiro correto. Ferramentas: PyYAML (sintaxe), `@redocly/cli lint` e `@apidevtools/swagger-parser` (o motor do Swagger Editor). O PyYAML deu `OK` nas seis: nenhuma é um erro de sintaxe YAML.


### Servidor (ponto 28)

Pedidos feitos com `curl -i` ao servidor em execução. Omitem-se `Date`, `Connection`, `Keep-Alive`, `ETag` e `Content-Length`. Todas as respostas têm `Content-Type: application/json; charset=utf-8`.


**Passo da verificação que falhou** (erro interno do `jsonwebtoken`, não enviado ao cliente):

Também se alterou um único carácter do texto base64url do payload, sem o descodificar: a resposta foi a mesma de T9.

**T12, explicação.** O token continua a ser aceite até ao seu `exp`. O servidor não guarda registo das sessões: verifica apenas a assinatura e a expiração. «Terminar sessão» só apaga a cópia do token que o cliente tinha. Invalidar o token exigiria revogação no servidor, excluída desta ficha (ver reflexão).

**Conformidade dos corpos com o contrato.** As respostas de T1, T8, T2–T6 e as quatro sugestões de `dados/sugestoes.json` foram validadas com os schemas `Token`, `ListaSugestoes`, `Erro` e `Sugestao` do contrato (Ajv): todas conformes.




---

## 4.5 · Reflexão crítica (ponto 31)

**1. Termo de sessão (T12).** O termo de sessão apenas descartou a cópia do token que o cliente tinha. Para o servidor nada mudou, e quem tiver copiado o token continua a usá-lo até ao `exp`. Invalidar o token no servidor exigiria uma lista de tokens revogados (ou um registo de sessões) consultada em cada pedido. Isso devolve estado ao servidor e anula a vantagem do token autossuficiente, que é verificar sem consultar nada. A revogação está excluída da ficha: fica para uma fase posterior.

**2. Validade.**
- **15 segundos:** um token roubado serve quase nada, e uma mudança de papel aplica-se logo. Mas, sem renovação, o utilizador teria de se autenticar a cada 15 s, haveria um `POST /tokens` (e um bcrypt) constante, e uma diferença de relógios ou um pedido lento bastaria para o token chegar expirado.
- **15 dias:** comodidade, mas um token roubado vale 15 dias, uma mudança de papel pode demorar 15 dias a ter efeito e terminar sessão não protege de nada.

15 minutos é um compromisso entre a janela de exposição e o número de autenticações.

**3. Variável do módulo, `localStorage` e cookie `HttpOnly`.** Em `localStorage`, o token fica em disco, sobrevive ao fecho do browser e qualquer script da origem o lê numa linha: um XSS exfiltra-o e usa-o noutro lado. Na variável do módulo, não fica em disco e não há forma direta de outro script o ler pelo nome. Um XSS ainda pode agir dentro da página (fazer pedidos, intercetar `fetch`): a exposição diminui, não desaparece. Um cookie `HttpOnly` impediria o JavaScript de ler o token, mas o browser envia-o automaticamente em cada pedido ao servidor. Isso introduz **CSRF**: outra página pode provocar pedidos autenticados. Teria de haver `SameSite` ou tokens anti-CSRF, e os cookies estão excluídos da ficha.

**4. Papel no token.**
- **No token (opção atual):** a autorização decide-se sem consultar nada. Uma mudança de papel só tem efeito quando o token expira, até 15 minutos depois (CA6).
- **Alternativa — o token só tem o `sub`, e o servidor consulta o papel em cada pedido:** a mudança é imediata, mas cada pedido passa a consultar o registo de utilizadores, e o token deixa de ser autossuficiente quanto à autorização.

**5. Outro serviço a verificar tokens.** Com HS256, a mesma chave assina e verifica. O serviço de estatísticas precisaria do segredo, e quem tem o segredo também pode **emitir** tokens para qualquer utilizador e papel. Cada serviço a mais é mais um sítio por onde o segredo pode ser divulgado. A solução habitual é um algoritmo assimétrico (por exemplo RS256): o servidor de autenticação assina com a chave privada e os outros só verificam com a pública. O servidor desta ficha está especificado em HS256, por isso fica para uma fase posterior.

**6. Tentativas sucessivas em `POST /tokens`.** O contrato não tem forma de exprimir um limite: no máximo, uma frase na `description` ou uma resposta declarada, que apenas descreve. O limite teria de ser imposto no **servidor** (ou num proxy à frente dele), contando tentativas por utilizador e por endereço. A resposta seria `429 Too Many Requests` com `Retry-After`. O custo do bcrypt torna cada tentativa mais lenta, mas não impede um ataque paciente. Fica para uma fase posterior.

**7. Bearer sem HTTPS.** Nenhuma. O token viaja em claro no cabeçalho, e quem observar a rede pode copiá-lo e usá-lo até expirar. A palavra-passe do `POST /tokens` também viaja em claro. Em `localhost`, o tráfego não sai da máquina, por isso serve para desenvolvimento. Em produção, o transporte tem de ser HTTPS, como indica o URL base do contrato (`https://api.estgv.exemplo/v2`).

**8. Contrato, servidor e testes.**
- **Contrato:** descreve. `security`, `401`, `403` e `404` e as `description` são compromissos. O linter só verifica a forma do documento, e as regras de papel e de propriedade estão em texto, que nenhuma ferramenta lê.
- **Servidor:** é o único que **garante**, e só o que está implementado: `exigirToken` e o filtro de `GET /v2/sugestoes`. `exigirPapel` existe mas nenhuma rota implementada o usa (seria aplicado, por exemplo, a `registarAcompanhamento` com `exigirPapel('servicos')`). A regra «um aluno só edita as suas sugestões» não está implementada, porque `PUT` e `DELETE` não fazem parte desta ficha: neste momento nada a garante.
- **Testes:** mostram que o servidor se comporta como o contrato **nos casos testados** (T1–T12). Não provam que se comporta assim em todos.
