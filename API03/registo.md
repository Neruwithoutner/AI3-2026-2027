# API03 · Registo da ficha

Ficheiros de entrega: `sugestoes.openapi.yaml` (contrato v2.1.0), `servidor/` (servidor e cliente) e este registo. O registo apresenta os resultados dos pontos 16 (servidor) e 17 (browser), a tabela do ponto 18 e as respostas do ponto 19.

---

## Execução e utilizadores de teste

```
cd servidor
npm install
cp .env.exemplo .env        # preencher JWT_SEGREDO com 32 ou mais caracteres aleatórios
node --env-file=.env servidor.js
```

O cliente fica em `http://localhost:3000/`. A página tem de ser aberta por este endereço e não diretamente do disco (`file://`): o browser não carrega módulos JavaScript em `file://`, e o cookie só existe para `localhost:3000`.

| Utilizador | Nome | Papel | Palavra-passe |
| ---------- | ---- | ----- | ------------- |
| `12345` | Ana Silva | `aluno` | `AnaSilva#2026` |
| `67890` | Bruno Costa | `aluno` | `BrunoCosta#2026` |
| `rita.sousa` | Rita Sousa | `servicos` | `RitaSousa#2026` |

---



## 4.4 · Verificação

### Servidor (ponto 16)

![Respostas do ponto 16](../ponto-16.png)

**T8, explicação.** O servidor aceitou o cookie depois de terminada a sessão. O valor do cookie é o token JWT, e o servidor só verifica a assinatura e o `exp`; não guarda registo das sessões. O `DELETE /v2/sessao` apenas pede ao browser que apague a **sua** cópia. Quem tiver copiado o valor antes continua a usá-lo até ao `exp` (15 minutos depois de T1). É o mesmo resultado do T12 da API02; invalidar o token exigiria revogação no servidor.

### Browser (ponto 17)

![Respostas do ponto 17](../ponto-17.png)

### Tabela (ponto 18)

![Tabela comparativa](../ponto-18.png)

## 4.5 · Reflexão (ponto 19)

**1. Cookie vs variável da API02.**

- **Vantagem:** a sessão sobrevive a recarregar a página (e até a fechar o browser, até expirar). O browser envia o token sozinho em cada pedido, e o JavaScript da página não o consegue ler, porque o cookie é `HttpOnly`.
- **Desvantagem:** o cliente deixa de ter acesso ao token e aos seus dados; precisa de `GET /v2/sessao` só para saber quem está autenticado. E, como o browser envia o cookie automaticamente, um pedido pode levá-lo sem a página o querer: é por isso que o cookie tem `SameSite=Strict`, só enviado em pedidos feitos a partir do próprio site. Num computador partilhado, quem abrir o browser antes de o cookie expirar continua autenticado como o utilizador anterior.

**2. T8.** Sim, o servidor aceitou o cookie depois de terminada a sessão (`200`). O `DELETE /v2/sessao` só pede ao browser que apague o cookie; o servidor não guarda sessões e não tem como saber que aquele token foi «terminado». O valor do cookie é o token JWT, que continua válido até ao `exp`. Para o recusar seria necessário um registo de tokens revogados no servidor, fora do âmbito desta ficha.

**3. Configurações noutro computador.** Não acompanham a Ana. O `localStorage` pertence ao **browser** (e à origem), não ao utilizador: noutro computador, ou noutro browser, ela recomeça com os valores por omissão. Pela mesma razão, a Ana e o Bruno, no mesmo computador e browser, partilham as configurações. Para que acompanhassem a Ana, teriam de ser guardadas **no servidor**, associadas ao utilizador autenticado: por exemplo, operações `GET` e `PUT` de configurações protegidas pelo token, com o `localStorage` a servir apenas de cópia local.
