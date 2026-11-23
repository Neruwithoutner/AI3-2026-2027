# Reporta · Registo — Sprint 1 (contrato e esqueleto)

Este sprint entrega o contrato da API (`reporta.openapi.yaml`, versão 1.0.0), o servidor Express com as 8 rotas de `/v1` a responder `501 Not Implemented`, e o esqueleto da PWA com manifesto e service worker registado. Nenhuma funcionalidade do Reporta está implementada: deteção de duplicados, idempotência, IndexedDB, fila de saída, sincronização e OAuth ficam para os sprints seguintes.

---

## Diagnóstico inicial

**(a) A Ana e o Bruno comunicam o mesmo buraco sem rede, com dez minutos de diferença, e a Ana sincroniza primeiro.**
Quando a pendente da Ana chega, não há semelhante: o servidor cria a ocorrência com `comunicacoes = 1` e responde `201` (`criada`). Quando chega a do Bruno, que nunca viu candidatas porque estava sem rede, o servidor procura semelhantes e encontra a da Ana: mesma categoria, não resolvida e dentro dos 15 m. Funde a comunicação nela, o contador passa a 2 e responde `200` (`reforcada`). No telemóvel do Bruno, a comunicação aparece como «Juntada à n.º …».
Se for a Ana a comunicá-lo duas vezes, são duas pendentes com chaves diferentes. A primeira cria a ocorrência. A segunda encontra-a como semelhante, mas a Ana já a comunicou, por isso o servidor responde `200` (`ja-comunicada`) e o contador **não sobe**: cada cidadão conta uma vez. Se for a mesma pendente reenviada, com a mesma chave, o servidor reconhece a `Idempotency-Key` e devolve a resposta guardada.

**(b) Precisão do GPS de 60 m com um raio de 15 m.**
O ponto pode estar até cerca de 60 m do sítio real, quatro vezes o raio, por isso a deteção pode falhar nos dois sentidos:
- **Duplicado não detetado (falso negativo):** o mesmo buraco, comunicado com um ponto deslocado 40 m, fica fora do raio e nasce uma segunda ocorrência.
- **Fusão errada (falso positivo):** o ponto impreciso cai a menos de 15 m de outro buraco, diferente, e a comunicação é juntada a um problema que não é o seu.

A interface deve mostrar a precisão ao cidadão («±60 m»). Quando for pior do que o raio da categoria, deve avisá-lo e esperar uns segundos por uma leitura melhor (`watchPosition` com `enableHighAccuracy`). Com rede, deve pedir-lhe que ajuste o ponto no mapa e mostrar as candidatas para ele decidir («É esta» / «É outra»). Sem rede, grava a precisão com a comunicação (`localizacao.precisao`) e o servidor decide quando ela chegar.

**(c) A comunicação do Rui, feita sem rede, é fundida na ocorrência 87.**
O registo local do Rui é uma pendente com `idLocal`, sem id do servidor. Quando chega a resposta `200` (`reforcada`, ocorrência 87), o dispositivo **não cria uma ocorrência sua**: liga esse registo à que já existia. Numa só transação, faz três escritas:
- apaga a pendente;
- grava em `minhas` `{ idLocal, ocorrenciaId: 87, resultado: 'reforcada', enviadaEm }`;
- faz `put` da ocorrência 87, com o contador atualizado, em `ocorrencias`.

A lista mostra «Juntada à n.º 87 (6 comunicações)». As mudanças seguintes da 87, como passar a `resolvida`, chegam ao Rui pelo pull.

**(d) Porque não basta o cliente perguntar `GET /v1/ocorrencias/semelhantes` antes de criar.**
A pergunta mostra o estado do servidor **naquele momento** e **só quando há rede**; a decisão final tem de ser do servidor quando a pendente chega. Exemplos em que a pergunta não evita o duplicado:
1. **Sem rede:** o cidadão comunica em modo avião e nunca vê candidatas; a pendente é enviada mais tarde.
2. **Corrida:** a Ana e o Bruno perguntam ao mesmo tempo. Nenhum vê candidatas, ambos escolhem criar e, sem a verificação no servidor, nasceriam duas ocorrências.
3. **Pendente atrasada:** a pergunta é feita às 10h, mas a pendente só sai às 18h. Entretanto, outra pessoa comunicou o mesmo problema.
4. **Pergunta falhada:** o pedido demora mais de 3 s ou dá erro, e a página grava diretamente uma pendente de ocorrência.

---

## 4.1 · Contrato e estratégia

**Contrato.** `reporta.openapi.yaml`, OpenAPI 3.0.3, versão `1.0.0`:

- **esquemas pedidos:** `Categoria` (`codigo`, `nome`, `descricao`, `raio`), `Localizacao` (`lat`, `lng`, `precisao` em metros), `Ocorrencia` (`id`, `categoria`, `descricao`, `localizacao`, `temFotografia`, `estado`, `comunicacoes`, `criadaEm`, `atualizadaEm`, `versao`) e `Erro` (`codigo`, `mensagem`, `detalhes`);
- **esquemas auxiliares:** `CodigoCategoria`, `NovaOcorrencia`, `NovoReforco`, `ResultadoComunicacao`, `Candidatas`, `Alteracoes` e `AlteracaoEstado`;
- **erros:** todas as operações têm uma resposta `default` (`Erro`), que cobre o `501` deste sprint e o `503` dos ensaios.

| Operação | `operationId` | Segurança | Respostas |
| -------- | ------------- | --------- | --------- |
| `GET /v1/categorias` | `listarCategorias` | pública | `200` |
| `GET /v1/ocorrencias/semelhantes` | `procurarSemelhantes` | pública | `200`, `400` |
| `GET /v1/ocorrencias?bbox=` | `listarOcorrencias` | pública | `200`, `400` |
| `POST /v1/ocorrencias` | `comunicarOcorrencia` | `X-Cidadao` | `201` criada; `200` reforçada ou já comunicada; `400`, `401`, `409` |
| `POST /v1/ocorrencias/{id}/reforcos` | `reforcarOcorrencia` | `X-Cidadao` | `201` reforçada; `200` já comunicada; `400`, `401`, `404`, `409`, `410` |
| `GET /v1/ocorrencias/{id}/fotografia` | `obterFotografia` | pública | `200` `image/jpeg`, `404` |
| `GET /v1/ocorrencias/alteracoes` | `listarAlteracoes` | `X-Cidadao` | `200`, `400`, `401` |
| `PATCH /v1/admin/ocorrencias/{id}` | `alterarEstado` | `X-Admin-Token` | `200`, `400`, `403`, `404` |

### Pedidos (tabela de 4.1)

| Pedido | `Cache-Control` | Quem o faz (página / SW) | Funciona sem rede? | Pode ser repetido sem efeitos adicionais? |
| ------ | --------------- | ------------------------ | ------------------ | ----------------------------------------- |
| `GET /v1/categorias` | `public, max-age=86400` | página, ao arrancar; guarda as categorias em `meta` | o pedido não; o formulário usa a cópia em `meta` | sim: só lê |
| `GET /v1/ocorrencias/semelhantes` | `no-store` | página, antes de gravar | não: sem rede (ou sem resposta em 3 s) grava logo uma pendente de ocorrência | sim: só lê |
| `GET /v1/ocorrencias?bbox=` | `no-cache` | página, para o mapa | não: sem rede não há mapa; a lista vem de IndexedDB | sim: só lê |
| `POST /v1/ocorrencias` sem `Idempotency-Key` | `no-store` | nenhum dos nossos clientes (só `curl`) | não | **não**: o resultado da repetição depende do estado do servidor nesse momento (pode dar `ja-comunicada` por acaso ou criar uma segunda ocorrência) |
| `POST /v1/ocorrencias` com `Idempotency-Key` | `no-store` | service worker, em `executarSincronizacao()` | não: fica em `pendentes` e sai quando houver rede | **sim**, com a mesma chave e o mesmo corpo durante 24 h: devolve a resposta guardada com `Idempotent-Replayed: true` |
| `POST /v1/ocorrencias/{id}/reforcos` com `Idempotency-Key` | `no-store` | service worker, em `executarSincronizacao()` | não: fica em `pendentes` (tipo `reforco`) | **sim**, nas mesmas condições; o contador só sobe uma vez |
| `GET /v1/ocorrencias/alteracoes` | `private, no-store` | service worker, depois do push | não: a lista local continua visível | sim: só lê |

**Antes de avançar.**

- **O que identifica o cidadão em cada pedido protegido?**
  - **Sem OAuth:** o cabeçalho `X-Cidadao`, com um UUID gerado na primeira utilização (`crypto.randomUUID()`) e guardado em IndexedDB (loja `meta`). A página e o service worker leem-no de lá e juntam-no a cada pedido protegido. Cada pendente guarda o `cidadao` com que foi criada.
  - **Com OAuth:** o cookie de sessão `HttpOnly` criado pelo servidor depois de trocar o código pelo token do fornecedor. Nem a página nem o service worker o leem: o browser junta-o aos pedidos para `/v1`.
- **Pode uma resposta de `GET /v1/ocorrencias/semelhantes` vir da Cache API?** Não.
  - A resposta descreve o estado do servidor **naquele momento**. Uma cópia guardada podia mostrar como candidata uma ocorrência já resolvida, com o contador antigo, ou esconder uma criada há minutos por outro cidadão. O cidadão decidiria «É esta» ou «É outra» com informação errada.
  - Cada ponto (`lat`, `lng`) dá um URL diferente, por isso uma cópia quase nunca seria reaproveitada.
  - Sem rede, uma cópia antiga daria uma falsa garantia. O comportamento certo é gravar a pendente e deixar a decisão ao servidor.

  Por isso a resposta é `no-store`, e no service worker nenhum pedido a `/v1/` passa pela Cache API.

---
