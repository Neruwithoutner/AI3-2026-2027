## Execução e utilizadores de teste

```
cd servidor
npm install
cp .env.exemplo .env        # preencher JWT_SEGREDO com 32 ou mais caracteres aleatórios
node --env-file=.env servidor.js
```

O cliente fica em `http://localhost:3000/`. O service worker só funciona em HTTPS ou em `localhost`, e a página tem de ser aberta por este endereço, não a partir do disco.

| Utilizador | Nome | Papel | Palavra-passe |
| ---------- | ---- | ----- | ------------- |
| `12345` | Ana Silva | `aluno` | `AnaSilva#2026` |
| `67890` | Bruno Costa | `aluno` | `BrunoCosta#2026` |
| `rita.sousa` | Rita Sousa | `servicos` | `RitaSousa#2026` |

---

## Diagnóstico inicial

**(a)** Na API03, ao abrir, a página faz `GET /v2/sessao`. O browser junta o cookie, se existir: com `200` há sessão, com `401` não há. A página não pode ler o cookie porque é `HttpOnly`; mesmo que o lesse, não teria o segredo para verificar o token nem saberia se o servidor o aceita.

**(b)** Na API03, sem ligação, a página nem abre: o browser não consegue obter o `index.html`, o `app.js` e os restantes ficheiros, e mostra a sua própria página de erro.

**(c)** O `POST` não é idempotente: cada pedido cria um recurso novo, por isso repeti-lo cria um duplicado. O `PUT` substitui o recurso pelo mesmo conteúdo: repeti-lo deixa o servidor no mesmo estado.

---

## 4.1 · Contrato e estratégia

**Contrato.** Ficou igual ao da API03 (comparado byte a byte), na versão `2.1.0`, e o `npx @redocly/cli lint sugestoes.openapi.yaml` continua **sem erros**, com os 3 avisos já explicados na API03. Confirmou-se que:

- `listarCategorias` tem `security: []` e `Cache-Control: public, max-age=86400`;
- o `201` de `criarSugestao` tem `Location` e `Cache-Control: no-store`.

**Antes de avançar.** Todas as linhas com «sim» na coluna «Depende do cookie?» têm a estratégia «só rede». O service worker só guarda os ficheiros da interface e `GET /v2/categorias`, que são iguais para todos. A Cache API identifica cada resposta apenas pelo método e pelo URL; se `GET /v2/sugestoes` lá fosse guardado, a lista de quem a pediu primeiro seria entregue a quem a pedisse a seguir no mesmo browser.

---

## 4.2 · Servidor

| Operação | Implementação |
| -------- | ------------- |
| `GET /v2/categorias` | pública (sem `exigirToken`); devolve as cinco categorias (`instalacoes`, `ensino`, `servicos`, `atividades`, `outra`), cada uma com `codigo` e `descricao`, com `Cache-Control: public, max-age=86400` |
| `POST /v2/sugestoes` | já vinha da API03: `exigirToken` e `exigirPapel('aluno')`; corpo que não cumpre `SugestaoNova` → `400` com um elemento em `detalhes` por campo; o `numeroAluno` do corpo é ignorado e usa-se o `sub` do token; sucesso → `201` com `Location: /v2/sugestoes/{id}` e `Cache-Control: no-store` |

---

## 4.3 a 4.5 · Cliente

```
public/
├── index.html
├── estilos.css
├── app.js              # estados da interface, sessão, listagem
├── configuracoes.js    # (API03)
├── bd.js               # IndexedDB
├── pendentes.js        # envio das sugestões pendentes
└── sw.js               # service worker (na raiz, para controlar todo o site)
```

**Estados.** `mudarEstado(estado)` em `app.js` é o único sítio onde o estado muda. Guarda-o em `document.body.dataset.estado` e mostra, com o atributo `hidden`, a área com `data-area` igual ao estado. A zona `#ligacao`, com `aria-live="polite"`, indica o estado da ligação. A lista e o formulário (`#trabalho`) aparecem em `com-sessao` e, em `sem-ligacao`, só quando há cópia local válida.

| Estado | Entra quando | Mostra |
| ------ | ------------ | ------ |
| `a-verificar` | ao abrir a página, e com «Tentar de novo» | «A verificar sessão…» |
| `sem-sessao` | `GET /v2/sessao` → `401`; sessão expirada; qualquer pedido → `401`; `DELETE /v2/sessao` → `204` | formulário de entrada |
| `com-sessao` | `GET` ou `POST /v2/sessao` → `200` | área de sessão, formulário «Nova sugestão» (alunos), lista |
| `sem-ligacao` | qualquer `fetch` rejeitado | aviso, «Tentar de novo» e, se a sessão do proprietário ainda não expirou, a cópia local com «Cópia de HH:MM — pode estar desatualizada» |

**Decisões de implementação**

- **Uma só função para a Sessao.** A `Sessao` recebida em qualquer situação (arranque, entrar, regresso da ligação) passa por `aplicarSessao()`. Se o utilizador for diferente do proprietário da cópia local, a IndexedDB é apagada antes de se mostrar seja o que for. Também se apaga o rascunho, que pertencia a quem saiu. Depois, a `Sessao` é guardada como `proprietario`, a página passa a `com-sessao`, envia as pendentes e atualiza a lista.
- **Mensagem ao regressar a ligação.** Se `GET /v2/sessao` devolver `401` e houver pendentes do proprietário, a página passa a `sem-sessao` com «Há N sugestões por enviar. Entre de novo para as enviar.».
- **Service worker.**
  - Na ativação, chama `clients.claim()`, para controlar logo a página na primeira visita.
  - Por isso também há um `controllerchange` na primeira instalação. Nesse caso, a página não é recarregada: volta a pedir as categorias, agora através do service worker, para ficarem em cache. A página só recarrega no `controllerchange` que se segue ao clique em «Atualizar a aplicação».
- **Ordenação por estado.** `lerSugestoes('estado')` percorre o índice `porEstado` estado a estado (`IDBKeyRange.only`), pela ordem do fluxo: `submetida`, `em_analise`, `aceite`, `rejeitada`, `resolvida`. Um único cursor daria a ordem alfabética (`aceite` primeiro). `lerSugestoes('recentes')` usa um cursor `prev` no índice `porData`.
- **Transações.** Todas as funções de `bd.js` resolvem a Promise no `complete` da transação. `substituirSugestoes` faz `clear` e `put` da lista e atualiza `proprietario.atualizadoEm` numa só transação (lojas `sugestoes` e `meta`). `confirmarPendente` faz `delete` na loja `pendentes` e `put` na loja `sugestoes` numa só transação.
- **`enviarPendentes()`.** Uma variável `aDecorrer` faz com que uma segunda chamada não faça nada. Respostas:
  - `201` → `confirmarPendente`;
  - `400` → `marcarErro`, e passa à seguinte;
  - `401` → para;
  - `fetch` rejeitado → para;
  - casos não previstos na ficha: `5xx` → para e mantém, para tentar mais tarde; outros `4xx` → `marcarErro`.
  
  A função não muda o estado: devolve o resultado e é o `app.js` que chama `mudarEstado`.
- **Corpo do `POST`.** Só `titulo`, `descricao` e `categoria`, tanto no envio direto como no das pendentes.
- **Formulário.** Usa `required`, `minlength` e `maxlength`. As categorias vêm de `GET /v2/categorias`. Se não houver categorias, o `fieldset` fica desativado e aparece uma explicação.

---

## 4.6 · Verificação

### Servidor (ponto 23)

Pedidos feitos com `curl -i`, com `-c`/`-b cookies.txt` a partir de `POST /v2/sessao` da Ana. Omitem-se `Date`, `Connection`, `Keep-Alive` e `Content-Length`; todas as respostas têm `Content-Type: application/json; charset=utf-8`.

### Browser (ponto 24)

Verificado no Chromium (Playwright), com perfis persistentes.

**Outros comportamentos verificados**

| Situação | Resultado |
| -------- | --------- |
| entrar com palavra-passe errada | «Erro: Utilizador ou palavra-passe inválidos.», palavra-passe limpa, foco no campo da palavra-passe |
| entrar com sucesso | foco no título «Sessão» |
| entrar sem ligação | `sem-ligacao` com «Erro: Sem ligação: não é possível entrar.» |
| expiração em `com-sessao` (`JWT_VALIDADE=30`) | aos `00:00`, `sem-sessao` com «Erro: A sessão expirou. Entre de novo.»; rascunho, pendentes e cópia local mantêm-se; foco no campo «Utilizador» |
| «Terminar sessão» com pendentes | `<dialog>` «Há 1 sugestão por enviar, que será apagada. Terminar sessão?»; «Cancelar» mantém a sessão |
| pendente recusada (resposta `400` simulada no teste) | aparece «Não enviada: O pedido não cumpre o schema SugestaoNova. (…)», com «Descartar» |
| servidor parado, com as categorias em cache | página servida pelo service worker, `sem-ligacao`, formulário ativo |
| servidor parado, sem categorias na Cache API nem na cache HTTP | formulário desativado, com «Não é possível criar sugestões: as categorias não foram obtidas…» |
| 360 px | sem deslocamento horizontal |

Observações:

- **Cache HTTP.** Ao apagar só a cache `dados-publicos`, as categorias continuaram a chegar com o servidor parado. O pedido do service worker passa pela cache HTTP do browser, que respeita `public, max-age=86400` e guarda a resposta durante um dia. Para testar o caso «sem categorias» foi preciso limpar também a cache HTTP. Ou seja, quem respeita o `Cache-Control` é a cache HTTP, não a Cache API.
- **Duas maneiras de simular a falta de ligação.** A opção «Offline» do browser impede os pedidos da página, mas nos testes automáticos não impediu os pedidos feitos pelo próprio service worker. Os casos que dependem da rede do service worker (categorias) foram por isso verificados também com o servidor parado.


## 4.7 · Reflexão (ponto 26)

**1. Que operação de autenticação continua impossível sem ligação?**
**Autenticar**, isto é, entrar e saber se a sessão é válida. Verificar a palavra-passe exige os hashes que estão no servidor, e emitir o token exige o segredo, que só o servidor conhece. O cookie é `HttpOnly`, por isso a página nem o consegue ler, e mesmo que lesse não poderia verificar a assinatura. Também é impossível **terminar** a sessão: só o servidor pode apagar o cookie, com `Set-Cookie`. Por isso o botão fica desativado em `sem-ligacao`. Sem ligação, a interface só mostra dados guardados e guarda pedidos para mais tarde; não decide nada sobre a identidade.

**2. E se a ligação caísse depois de o servidor criar a sugestão e antes de chegar a resposta?**
O `fetch` seria rejeitado e a sugestão iria para as pendentes, apesar de já existir no servidor. No reenvio, o servidor criaria uma **segunda** sugestão igual, porque o `POST` não é idempotente. Evitar isto exige uma **chave de idempotência**:
- o cliente gera um identificador para cada pendente, por exemplo com `crypto.randomUUID()`, e envia-o num cabeçalho como `Idempotency-Key` em `POST /v2/sugestoes`;
- o servidor guarda as chaves já usadas e, ao receber uma chave repetida, devolve a sugestão já criada em vez de criar outra.

No contrato, o cabeçalho seria um parâmetro **opcional**: os clientes atuais continuam a funcionar, por isso a API passaria a **2.2.0**. Se fosse obrigatório, partia os clientes existentes e seria uma **3.0.0**. Alternativa sem cabeçalho: um `PUT /v2/sugestoes/{idCliente}`, idempotente por natureza, também como operação nova (2.2.0).

**3. Background Sync API.**
Permitiria enviar as pendentes quando a ligação voltasse, mesmo com a página fechada: o browser acordaria o service worker com um evento `sync`. Hoje, se a Ana fechar o browser, as pendentes só são enviadas quando ela voltar a abrir a página e entrar. O cookie continuaria a ser uma limitação: dura 15 minutos (`Max-Age` e `exp`). Se a ligação voltasse mais tarde, o envio receberia `401`, e o service worker não pode voltar a autenticar-se, porque não tem a palavra-passe (nem a deve ter). Além disso, nesta ficha o service worker não acede à IndexedDB, onde estão as pendentes.

**4. Computador partilhado.**
Depois de a sessão da Ana expirar, a lista dela e as pendentes continuam no disco, na IndexedDB. Qualquer pessoa que use o mesmo browser pode vê-las em F12 → Aplicação → IndexedDB, sem palavra-passe. Regras desta ficha que reduzem o risco:
- a cópia só é **mostrada** na interface se a sessão do proprietário ainda não tiver expirado;
- a cópia é **apagada** quando entra outro utilizador e quando a Ana termina sessão;
- o rascunho é apagado ao terminar sessão e quando muda o utilizador.

Continua por resolver: se a Ana fechar o browser sem terminar sessão e ninguém entrar depois, os dados ficam indefinidamente, sem cifra, legíveis por quem abrir as ferramentas de programador. Durante os 15 minutos de validade, quem usar o computador também tem o cookie da Ana.

**5. A Ana muda de computador.**
- **Configurações:** não a acompanham. Ficam no `localStorage` daquele browser, como já se concluiu na API03; para a acompanharem teriam de ser guardadas no servidor, associadas à conta.
- **Pendentes:** também não, e aqui é mais grave. Uma pendente só existe na IndexedDB do computador onde foi criada e só é enviada quando a Ana voltar a entrar **nesse** browser. Se nunca voltar, a sugestão nunca chega ao servidor (e é apagada se outra pessoa entrar lá).
- **Sugestões já enviadas:** acompanham-na, porque estão no servidor; a cópia local é só uma cópia.
