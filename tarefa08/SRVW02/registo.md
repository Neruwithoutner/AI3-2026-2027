

## Execução e utilizadores de teste

```
cd servidor
npm install
cp .env.exemplo .env        # preencher JWT_SEGREDO com 32 ou mais caracteres aleatórios
node --env-file=.env servidor.js
```

O cliente fica em `http://localhost:3000/`; tem de ser aberto por este endereço, não a partir do disco. Para os ensaios, as variáveis seguintes ficam vazias no `.env.exemplo` (desligadas) e só se preenchem quando indicado:

| Variável | Efeito |
| -------- | ------ |
| `SIMULAR_PERDA_RESPOSTA=1` | na primeira vez que cada chave é processada com sucesso, cria a sugestão, guarda a chave e fecha a ligação com `req.socket.destroy()` |
| `SIMULAR_503=3` | os próximos 3 `POST /v2/sugestoes` recebem `503` com `Retry-After: 2`, sem criar nada |
| `JWT_VALIDADE=30` | tokens com 30 s de validade (cenário h) |

| Utilizador | Nome | Papel | Palavra-passe |
| ---------- | ---- | ----- | ------------- |
| `12345` | Ana Silva | `aluno` | `AnaSilva#2026` |
| `67890` | Bruno Costa | `aluno` | `BrunoCosta#2026` |
| `rita.sousa` | Rita Sousa | `servicos` | `RitaSousa#2026` |

---

## Diagnóstico inicial

**(a)** Só no dia seguinte, quando a Ana abre a aplicação e a página entra em `com-sessao`: é aí (ou no evento `online` com a página aberta) que a API04 chama `enviarPendentes()`. A rede voltar uma hora depois não muda nada, porque não há nenhuma página aberta para reagir. Se a sessão já tiver expirado, a sugestão só sai depois de a Ana voltar a entrar.

**(b)** O `fetch` é rejeitado (erro de rede), `enviarPendentes()` mantém a pendente e volta a enviá-la no próximo `online` ou na próxima entrada em `com-sessao`. O servidor não a reconhece e cria outra: no fim existem **duas** sugestões iguais.

**(c)** Não. `navigator.onLine === true` só diz que há uma interface de rede ativa. Exemplos em que o envio falha: um Wi-Fi de hotel com portal de autenticação (há rede, mas os pedidos são intercetados); o servidor em baixo ou a reiniciar; um router ligado sem acesso à internet; uma firewall que bloqueia a porta.

---

## 4.1 · Contrato e estratégia

**Contrato.** Passou de `2.1.0` para `2.2.0`, só com as três alterações pedidas:

- `Sugestao` ganha `versao` (inteiro ≥ 1, `readOnly`, obrigatório);
- `POST /v2/sugestoes` aceita o cabeçalho opcional `Idempotency-Key` (`format: uuid`); o `201` pode trazer `Idempotent-Replayed: true`; o `400` cobre também uma chave que não seja UUID; novo `409` (`Erro`) para chave repetida com corpo diferente;
- nova operação `GET /v2/sugestoes/alteracoes` (`listarAlteracoes`), protegida pelo cookie, com `desde` obrigatório (inteiro ≥ 0); `200` com `{ alteracoes: Sugestao[], cursor }` e `Cache-Control: private, no-store`, `400` e `401`.

`npx @redocly/cli lint sugestoes.openapi.yaml` → **sem erros**, com os 3 avisos já explicados nas fichas anteriores (licença; `/categorias` e `DELETE /sessao` sem resposta 4xx).

### Pedidos (tabela de 4.1)

| Pedido | `Cache-Control` | Depende do cookie? | Quem o faz (página / SW) | Quando | Pode ser repetido sem efeitos adicionais? |
| ------ | --------------- | ------------------ | ------------------------ | ------ | ----------------------------------------- |
| `GET /v2/sessao` | `no-store` | sim | página | ao arrancar e no evento `online` (`verificarSessao`) | sim: só lê |
| `POST /v2/sessao` | `no-store` | sim (cria o cookie) | página | quando o utilizador entra | quase: não cria nada no servidor, mas cada repetição emite um token novo e substitui o cookie |
| `GET /v2/categorias` | `public, max-age=86400` | não | página (respondido pelo SW: cache e atualização em segundo plano) | ao arrancar | sim: só lê |
| `GET /v2/sugestoes` | `private, no-cache` | sim | ninguém: a página deixou de o usar | — (substituído por `alteracoes` com `desde=0`) | sim: só lê |
| `POST /v2/sugestoes` sem `Idempotency-Key` | `no-store` | sim | nenhum dos nossos clientes (clientes 2.1.0, `curl`) | — | **não**: cada repetição cria outra sugestão |
| `POST /v2/sugestoes` com `Idempotency-Key` | `no-store` | sim | SW, em `executarSincronizacao()` | no evento `sync` ou na mensagem `sincronizar` | **sim**, com a mesma chave e o mesmo corpo, durante 24 h: devolve a mesma resposta com `Idempotent-Replayed: true` |
| `GET /v2/sugestoes/alteracoes` | `private, no-store` | sim | SW, em `executarSincronizacao()` | em cada sincronização, depois do push | sim: só lê |

---

## 4.2 · Servidor

| Operação | Implementação |
| -------- | ------------- |
| `POST /v2/sugestoes` sem chave | igual à 2.1.0 |
| chave que não é UUID | `400` «O cabeçalho Idempotency-Key tem de ser um UUID.», com `detalhes` no campo `Idempotency-Key` |
| registo das chaves | `idempotencia.js`: `Map<numeroAluno, Map<chave, { corpo, codigo, location, resposta, expiraEm }>>`, 24 h; as expiradas são apagadas em cada procura; o corpo é comparado em JSON canónico (chaves ordenadas) |
| chave repetida, mesmo corpo | devolve o código, o `Location` e o corpo guardados, com `Idempotent-Replayed: true`; não cria nada |
| chave repetida, corpo diferente | `409` «A Idempotency-Key já foi usada com um corpo diferente.» |
| ordem | valida a chave → procura → valida o corpo (`400` não fica guardado) → cria → guarda a chave → responde |
| `versao` | contador `ultimaVersao` que só cresce (começa no máximo dos dados iniciais, 4); cada criação recebe `proximaVersao()`; o campo aparece em todas as respostas com sugestões |
| `GET /v2/sugestoes/alteracoes` | `exigirToken`; `desde` tem de cumprir `^\d+$` e ser inteiro seguro, senão `400` com `detalhes`; um aluno vê só as suas, os serviços todas; devolve `versao > desde` por ordem crescente; `cursor` = maior `versao` devolvida, ou `desde` |
| `SIMULAR_PERDA_RESPOSTA=1` | depois de criar e guardar a chave, regista no terminal e faz `req.socket.destroy()` só na primeira vez de cada chave |
| `SIMULAR_503=n` | middleware `simular503`, antes de `exigirToken`: enquanto o contador for > 0, responde `503` com `Retry-After: 2` e decrementa |

---


### IndexedDB versão 2 (4.3)

| Loja | Chave | Índices | Conteúdo |
| ---- | ----- | ------- | -------- |
| `sugestoes` | `id` | `porEstado`, `porData` | objetos `Sugestao`, agora com `versao` |
| `pendentes` | `idLocal` (autoIncrement) | `porUtilizador` (novo) | campos da API04 + `chave` (UUID), `tentativas`, `ultimaTentativa` |
| `meta` | `chave` | — | `proprietario` e `cursor:<numeroAluno>` com `{ chave, valor }` |

### Service worker (4.4)

- `executarSincronizacao()` segue a ordem pedida: proprietário (sem ele, ou expirado → `sessao-expirada` sem pedidos); push, uma pendente de cada vez, por `idLocal`, com `registarTentativa` antes de cada `POST`; tratamento por código (`201` → `confirmarPendente`; `400`/`409`/outro 4xx → `marcarErro` e continua; `401` → `sessao-expirada`; `5xx` → lança `erro-servidor`; `fetch` rejeitado → lança `sem-rede`); pull com o cursor; devolve `{ tipo: 'sincronizado', enviadas, recusadas, recebidas, porEnviar }`.
- O corpo do `POST` tem só `titulo`, `descricao` e `categoria`; o `numeroAluno` vem do token.
- `sync` (etiqueta `sincronizar-sugestoes`): `waitUntil(sincronizar())`; avisa as páginas; rejeita só em `sem-rede`/`erro-servidor` (com `ultimaTentativa: evento.lastChance` na mensagem); numa sessão expirada resolve.
- Mensagem `{ tipo: 'sincronizar' }`: `waitUntil`, avisa as páginas com qualquer resultado.
- `emCurso` impede duas sincronizações simultâneas no mesmo arranque do service worker.


### Página (4.5)

- `pedirSync()` (em `pendentes.js`) usa `sync.register` quando existe; sem ele, ou com a permissão recusada, envia a mensagem `sincronizar` (plano B).
- Chamada ao entrar em `com-sessao` (depois de `guardarProprietario`), logo depois de criar uma pendente, no evento `online` e em `visibilitychange` com `document.hidden === false`. Também no botão «Atualizar lista».
- A página deixou de chamar `GET /v2/sugestoes`; a primeira sincronização, com cursor 0, traz a lista completa.
- Criar uma sugestão é sempre offline-first: grava a pendente, mostra-a como «Por enviar» e pede a sincronização. Na primeira pendente chama `navigator.storage.persist()` e regista na consola o resultado e `estimate()` (Chromium dos ensaios: `persist() = false`, cerca de 141 kB usados de uma quota de cerca de 10,7 GB).
- Mensagens do service worker: `sincronizado` → relê IndexedDB e mostra «Sincronizado: N enviadas, M recebidas» (e «K com erro», se houver) ou «Sincronizado» durante 5 s; `sessao-expirada` → com pendentes, `sem-sessao` com «Há N sugestões por enviar. Entre de novo para as enviar.»; `sem-rede`/`erro-servidor` → «Por enviar: N. Nova tentativa automática.»
- Plano B: com `ultimoMeio === 'mensagem'` e resultado `sem-rede`/`erro-servidor`, agenda `pedirSync()` após `min(60, 2^k) × (0,7 + 0,6 × Math.random())` s; `sincronizado` repõe `k = 0`; só existe um `setTimeout` de cada vez.
- Cada pendente mostra «Por enviar», «Por enviar · N tentativas» ou «Erro: <mensagem>».

---

## 4.6 · Verificação

### Servidor (T1 a T4, com o cookie da Ana)

```
curl -c ana.jar -H 'Content-Type: application/json' \
     -d '{"utilizador":"12345","palavraPasse":"AnaSilva#2026"}' http://localhost:3000/v2/sessao
```

| # | Pedido | Resultado obtido |
| - | ------ | ---------------- |
| T1 | `POST /v2/sugestoes` válido com `Idempotency-Key: 3f9c2a71-…-5a7b6d0e8f12`, duas vezes | 1.º `201`, `Location: /v2/sugestoes/5`, `versao: 5`; 2.º `201`, `Location: /v2/sugestoes/5`, `Idempotent-Replayed: true`, mesmo corpo; `GET /v2/sugestoes` → `total: 3` (2 iniciais + a 5): uma só sugestão |
| T2 | mesmo pedido, mesma chave, `titulo` diferente | `409` `{"codigo":409,"mensagem":"A Idempotency-Key já foi usada com um corpo diferente."}` |
| T3 | `GET /v2/sugestoes/alteracoes?desde=0` e depois `?desde=5` | `200`, `Cache-Control: private, no-store`, sugestões 1, 2 e 5 (versões 1, 2, 5), `cursor: 5`; depois `200` `{"alteracoes":[],"cursor":5}` |
| T4 | `?desde=abc`; o mesmo sem cookie | `400` com `detalhes: [{"campo":"desde","problema":"tem de ser um inteiro maior ou igual a 0"}]`; `401` com `WWW-Authenticate: Bearer` |

Verificações adicionais: chave que não é UUID → `400` com `detalhes`; `desde` em falta → `400`; um `400` de validação com chave não fica guardado (o mesmo pedido corrigido com a mesma chave → `201`); sem chave, dois `POST` criam duas sugestões, como na 2.1.0. As respostas foram validadas contra o contrato (`Sugestao`, `Alteracoes`, `Erro`).

### Browser (cenários a a j)



| Cenário | O que se observou |
| ------- | ----------------- |
| (a) Migração | Duas pendentes criadas com a versão da API04 (base v1). Ao abrir a versão nova: base na versão 2, as duas pendentes intactas, cada uma com `chave` (UUID), `tentativas: 0` e `ultimaTentativa: null`; índice `porUtilizador` presente. Com o servidor de volta: Background sync «Registered → Dispatched → Sync completed», «Sincronizado: 2 enviadas, 2 recebidas», `cursor:12345 = 6`. Captura `a-migracao.png` |
| (b) Offline no Chrome | Em offline, a sugestão fica «Por enviar» e aparece a etiqueta `sincronizar-sugestoes` registada. Ao repor a ligação: «Dispatched», `POST` `201` no servidor e «Sincronizado: 1 enviada» sem recarregar. Aparece também «Sync event reregistered», porque o handler `online` chama `pedirSync()` com o evento ainda por terminar; as duas chamadas juntaram-se num único `POST`. Capturas `b1-offline-por-enviar.png`, `b2-enviada.png` |
| (c) Separador fechado | Sugestão criada sem rede, separador fechado (só `about:blank` aberto). Ao repor a rede, o servidor regista o `POST /v2/sugestoes` `201`, feito pelo service worker, sem nenhuma página da aplicação aberta |
| (d) Plano B | Sem `sync`, a sugestão criada offline fica «Por enviar» e a consola mostra `[plano B] sem-rede: falha 1, nova tentativa dentro de … s`. No evento `online`, `POST` imediato. Com o separador escondido e o servidor em baixo: esperas de 2,3 s, 4,8 s, 6,2 s e 20,4 s; ao voltar a ficar visível, `POST` imediato e `201`. Captura `d1-planoB-offline.png` |
| (e) Resposta perdida | Plano B: 1.ª tentativa com a ligação fechada pelo servidor (`ERR_EMPTY_RESPONSE`); 1,7 s depois, 2.ª tentativa `201` com `Idempotent-Replayed: true`. Chrome com Background Sync: «sync event failed — Next Attempt Delay 300000 ms»; 5 min depois o browser repetiu e recebeu a resposta repetida. Em todos os casos, **uma** sugestão no servidor. Nota: com ligações *keep-alive*, o próprio Chrome repete o `POST` de forma transparente e o servidor reconhece-o pela chave; os ensaios usaram `Connection: close` para ver a repetição do nosso código. Capturas `e1-resposta-perdida*.png`, `e2-repeticao*.png` |
| (f) `SIMULAR_503=3` | Tentativas `503`, `503`, `503`, `201`, sempre com a mesma chave. Intervalos 1,59 s, 3,40 s e 8,14 s; seguem o backoff (intervalos esperados [1,4; 2,6], [2,8; 5,2] e [5,6; 10,4] s para k = 1, 2, 3) |
| (g) Erro na do meio | Três pendentes offline (a do meio com título «Curto», criada na consola). Ao repor: `201`, `400`, `201`; a do meio fica «Erro: O pedido não cumpre o schema SugestaoNova. (titulo tem de ter entre 10 e 120 caracteres)», as outras duas enviadas; «Sincronizado: 2 enviadas, 1 com erro». Captura `g-erro-na-do-meio.png` |
| (h) `JWT_VALIDADE=30` | Pendente criada offline; depois da expiração, com a rede reposta, o evento `sync` termina «succeeded» com **0** `POST` no servidor; a página passa a `sem-sessao` com «Há 1 sugestão por enviar. Entre de novo para a enviar.» Depois de nova entrada, `POST` `201`. Captura `h-pendente-mantida.png` |
| (i) Dois browsers | Ana em sessão nos dois perfis. Sugestão criada no perfil «Firefox»; ao voltar ao separador do Chrome (`visibilitychange`), aparece sem recarregar com «Sincronizado: 1 recebida», e `cursor:12345` passa de 2 para 5. Captura `i-outro-browser.png` |
| (j) Dois separadores | Dois separadores com a API04; atualização num deles. O outro continua com o código da API04 e o aviso «Há uma nova versão da aplicação»; a sua ligação à base fecha-se por `versionchange` e as novas aberturas falham com «The requested version (1) is less than the existing version (2)»: mudar a ordenação já não reordena e «Tentar de novo» fica em `a-verificar`. Não houve `POST` duplicados. A cache `interface-v2` foi apagada: ficaram `interface-v3` e `dados-publicos`. Captura `j-outro-separador.png` |

### Gatilhos (tabela de 4.6)

| Gatilho | Chrome: o que acontece | Firefox: o que acontece | Quem executa a sincronização | Que pendentes são enviadas |
| ------- | ---------------------- | ----------------------- | ---------------------------- | -------------------------- |
| criação de uma pendente com ligação | `sync.register`; o evento `sync` dispara de imediato | mensagem `sincronizar`; sincroniza de imediato | service worker | as do proprietário, sem erro, por `idLocal` |
| criação de uma pendente sem ligação | etiqueta registada; o evento espera pela rede | mensagem; `sem-rede`; a página agenda nova tentativa (plano B) | service worker (pedido pela página) | as do proprietário, quando houver rede |
| entrada em `com-sessao` | `pedirSync()` depois de `guardarProprietario`; `sync` imediato | mensagem imediata | service worker | as do utilizador que entrou |
| evento `online` | o browser dispara o `sync` pendente; o handler da página também pede (juntam-se) | mensagem; `POST` imediato (d) | service worker | as do proprietário |
| separador volta a ficar visível | `sync` imediato (traz as alterações, cenário i) | mensagem imediata (d, i) | service worker | as do proprietário |
| a rede volta com o separador fechado | o browser acorda o service worker e dispara `sync` (c) | nada: espera pela próxima abertura da aplicação | service worker (Chrome); ninguém (Firefox) | as do proprietário (Chrome) |
| `503` do servidor | `erro-servidor`; promessa rejeitada; o browser repete (1.ª repetição ao fim de 5 min) e desiste ao fim de algumas | `erro-servidor`; a página repete com `min(60, 2^k) × jitter` (f) | service worker | todas mantidas, com a mesma chave |
| `401` com o separador fechado | `sessao-expirada`; promessa resolvida; sem nova tentativa até nova entrada | sem separador não há sincronização; ao abrir, `sem-sessao` com a contagem | service worker | nenhuma: ficam até nova entrada |

---

## 4.7 · Reflexão

**1. Edições em dois computadores.** Perder-se-ia a edição que chegasse **primeiro** ao servidor. O push envia o objeto completo e o servidor aplica-o por cima do que tem: a segunda a chegar ganha (*last write wins*), mesmo que tenha sido feita antes. Para detetar o conflito, o contrato teria de levar a versão em que a edição se baseou, por exemplo `If-Match` com um `ETag` derivado de `versao` (ou um campo `versaoBase`), com `412`/`409` quando a versão do servidor já for outra. Estratégias de resolução: *last write wins* (simples, perde dados); rejeitar a segunda e pedir ao utilizador que escolha; fusão campo a campo, quando as edições tocam em campos diferentes; estruturas sem conflito (CRDT) ou transformação de operações, quando a fusão tem de ser automática.

**2. Sessão expirada com o separador fechado.** O service worker não tem com que renovar: a palavra-passe não está guardada, o cookie é `HttpOnly` e o token já expirou, e a API não tem renovação. No cenário (h), o `sync` terminou sem `POST`. A alternativa seria um *refresh token* de longa duração num cookie `HttpOnly` próprio, com uma operação de renovação que o service worker pudesse chamar. O risco é alargar a janela de abuso: quem obtiver o cookie ou o dispositivo pode agir em nome da Ana durante semanas, e é preciso revogação no servidor. Guardar a palavra-passe em IndexedDB seria pior, porque qualquer XSS a leria.

**3. Safari e os 7 dias.** As pendentes da Ana são apagadas com o resto da origem e perdem-se: nunca chegaram ao servidor e não existem em mais lado nenhum. `navigator.storage.persist()` existe, mas é o browser que decide; o Safari só tende a conceder a aplicações instaladas no ecrã principal, e no Chromium dos ensaios resolveu `false`. Isto confirma que o cliente é uma cache e não a fonte da verdade: tudo o que não se pode perder tem de ser enviado o mais cedo possível, e o utilizador deve ver que ainda há sugestões «Por enviar».

**4. Servidor reinicia entre as tentativas.** O `Map` em memória perde-se. A segunda tentativa traz uma chave desconhecida e o servidor cria uma **segunda** sugestão: o duplicado que a chave devia evitar. As chaves deviam ficar numa base de dados persistente, gravadas na mesma transação que a sugestão (por exemplo, tabela com chave única `(numeroAluno, chave)`), para que não exista uma sem a outra. O prazo tem de cobrir o maior intervalo realista entre tentativas: as repetições do Background Sync (minutos a horas) e uma reabertura da aplicação. 24 h é um compromisso; uma pendente reenviada depois disso volta a criar um duplicado.

**5. Pedidos e bytes, API04 vs SVW02.** Utilizadora com 200 sugestões (cerca de 314 B cada em JSON) que cria uma por dia:

| | API04 | SVW02 |
| - | ----- | ----- |
| criar uma sugestão | 1 `POST` + `GET /v2/sugestoes` completo | 1 `POST` + 1 `GET …/alteracoes` com 1 sugestão |
| cada abertura / `online` / atualização | `GET /v2/sugestoes` completo, ≈ 63 kB de corpo | `GET …/alteracoes`, ≈ 30 B se nada mudou |
| primeira sincronização num browser novo | ≈ 63 kB | ≈ 63 kB (cursor 0), uma vez |
| por dia, com 3 sincronizações | ≈ 190 kB | ≈ 1 kB |

O número de pedidos é parecido (um pull por gatilho; a SVW02 até tem mais gatilhos, como `visibilitychange`), mas os bytes descem cerca de 200 vezes, porque só viaja o que mudou. Além disso, o servidor devolve no máximo 20 sugestões por `GET /v2/sugestoes`, por isso, com 200, a cópia da API04 nem ficaria completa sem paginação.
