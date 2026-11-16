// IndexedDB: cópia local das sugestões, fila de saída (pendentes) e metadados.
// Partilhado pela página (<script src="bd.js">) e pelo service worker (importScripts('/bd.js')).
// Por isso é um script clássico (sem import/export) e não usa window, document,
// localStorage nem alert: as funções ficam disponíveis em self.bd.
//
// Base de dados sugestoes-bd, versão 2:
//   sugestoes  chave id                       índices porEstado (estado), porData (dataCriacao)
//   pendentes  chave idLocal (autoIncrement)  índice porUtilizador (utilizador)       ← v2
//              campos da API04 + chave (UUID), tentativas, ultimaTentativa         ← v2
//   meta       chave chave                    «proprietario» e «cursor:<numeroAluno>» ← v2
//
// Todas as funções devolvem uma Promise resolvida só no evento complete da transação.

(() => {
  const NOME_BD = 'sugestoes-bd';
  const VERSAO_BD = 2;
  const ORDEM_ESTADOS = ['submetida', 'em_analise', 'aceite', 'rejeitada', 'resolvida'];

  let ligacao = null;          // Promise da ligação aberta
  let aoMudarVersao = null;    // função chamada quando outra ligação pede uma versão mais recente

  function abrirBD() {
    if (ligacao) return ligacao;
    ligacao = new Promise((resolver, rejeitar) => {
      const pedido = indexedDB.open(NOME_BD, VERSAO_BD);

      // A estrutura só pode ser criada ou alterada aqui. Cada passo corre só se a
      // base existente for mais antiga, para migrar sem perder dados.
      pedido.onupgradeneeded = (evento) => {
        const bd = pedido.result;
        const tx = pedido.transaction;

        if (evento.oldVersion < 1) {
          const sugestoes = bd.createObjectStore('sugestoes', { keyPath: 'id' });
          sugestoes.createIndex('porEstado', 'estado');
          sugestoes.createIndex('porData', 'dataCriacao');
          bd.createObjectStore('pendentes', { keyPath: 'idLocal', autoIncrement: true });
          bd.createObjectStore('meta', { keyPath: 'chave' });
        }

        if (evento.oldVersion < 2) {
          const pendentes = tx.objectStore('pendentes');
          pendentes.createIndex('porUtilizador', 'utilizador');
          // Pendentes criadas pela versão 1 (API04): ganham chave, tentativas e ultimaTentativa.
          pendentes.openCursor().onsuccess = (e) => {
            const cursor = e.target.result;
            if (!cursor) return;
            cursor.update({
              ...cursor.value,
              chave: cursor.value.chave ?? crypto.randomUUID(),
              tentativas: cursor.value.tentativas ?? 0,
              ultimaTentativa: cursor.value.ultimaTentativa ?? null
            });
            cursor.continue();
          };
        }
      };

      // Outra ligação (página ou service worker antigos) ainda tem a versão anterior aberta.
      pedido.onblocked = () => console.warn('sugestoes-bd: à espera que outra ligação feche');

      pedido.onsuccess = () => {
        const bd = pedido.result;
        // Outra ligação pediu uma versão mais recente: fecha esta para não a bloquear.
        bd.onversionchange = () => {
          bd.close();
          ligacao = null;
          if (aoMudarVersao) aoMudarVersao();
        };
        resolver(bd);
      };
      pedido.onerror = () => {
        ligacao = null;
        rejeitar(pedido.error);
      };
    });
    return ligacao;
  }

  // Executa `trabalho` numa transação e resolve com o valor definido quando a transação termina.
  async function transacao(lojas, modo, trabalho) {
    const bd = await abrirBD();
    return new Promise((resolver, rejeitar) => {
      const tx = bd.transaction(lojas, modo);
      let resultado;
      tx.oncomplete = () => resolver(resultado);
      tx.onerror = () => rejeitar(tx.error);
      tx.onabort = () => rejeitar(tx.error ?? new DOMException('Transação cancelada.', 'AbortError'));
      try {
        trabalho(tx, (valor) => { resultado = valor; });
      } catch (erro) {
        tx.abort();
        rejeitar(erro);
      }
    });
  }

  const agora = () => new Date().toISOString();
  const chaveCursor = (utilizador) => `cursor:${utilizador}`;

  // ---------- Cópia local das sugestões ----------

  function lerSugestoes(ordenacao) {
    return transacao(['sugestoes'], 'readonly', (tx, definir) => {
      const loja = tx.objectStore('sugestoes');
      if (ordenacao === 'estado') {
        // Índice porEstado, estado a estado, pela ordem do fluxo.
        const indice = loja.index('porEstado');
        const grupos = ORDEM_ESTADOS.map(() => []);
        definir(grupos);
        ORDEM_ESTADOS.forEach((estado, posicao) => {
          const pedido = indice.getAll(IDBKeyRange.only(estado));
          pedido.onsuccess = () => { grupos[posicao] = pedido.result; };
        });
        return;
      }
      // Índice porData, do mais recente para o mais antigo.
      const lista = [];
      definir(lista);
      const cursor = loja.index('porData').openCursor(null, 'prev');
      cursor.onsuccess = () => {
        const atual = cursor.result;
        if (!atual) return;
        lista.push(atual.value);
        atual.continue();
      };
    }).then((resultado) => (ordenacao === 'estado' ? resultado.flat() : resultado));
  }

  // Grava as sugestões recebidas e o novo cursor numa só transação (sugestoes e meta).
  // Atualiza também proprietario.atualizadoEm. Resolve com o número de sugestões novas
  // ou com versao mais recente do que a que havia (as já conhecidas não contam).
  function aplicarAlteracoes(utilizador, alteracoes, cursor) {
    return transacao(['sugestoes', 'meta'], 'readwrite', (tx, definir) => {
      const sugestoes = tx.objectStore('sugestoes');
      const meta = tx.objectStore('meta');
      let novas = 0;
      definir(0);

      for (const sugestao of alteracoes) {
        const pedido = sugestoes.get(sugestao.id);
        pedido.onsuccess = () => {
          const atual = pedido.result;
          if (!atual || (atual.versao ?? 0) < sugestao.versao) {
            novas++;
            definir(novas);
          }
          sugestoes.put(sugestao);
        };
      }

      const pedidoCursor = meta.get(chaveCursor(utilizador));
      pedidoCursor.onsuccess = () => {
        const anterior = pedidoCursor.result?.valor ?? 0;
        meta.put({ chave: chaveCursor(utilizador), valor: Math.max(anterior, cursor) });
      };

      const pedidoDono = meta.get('proprietario');
      pedidoDono.onsuccess = () => {
        const dono = pedidoDono.result;
        if (dono && dono.utilizador === utilizador) meta.put({ ...dono, atualizadoEm: agora() });
      };
    });
  }

  function lerCursor(utilizador) {
    return transacao(['meta'], 'readonly', (tx, definir) => {
      const pedido = tx.objectStore('meta').get(chaveCursor(utilizador));
      pedido.onsuccess = () => definir(pedido.result?.valor ?? 0);
    });
  }

  // ---------- Fila de saída (pendentes) ----------

  // Guarda uma sugestão por enviar. A chave de idempotência nasce aqui e acompanha a
  // pendente em todas as tentativas. Resolve com o idLocal gerado.
  function acrescentarPendente(dados, utilizador) {
    return transacao(['pendentes'], 'readwrite', (tx, definir) => {
      const pedido = tx.objectStore('pendentes').add({
        utilizador,
        titulo: dados.titulo,
        descricao: dados.descricao,
        categoria: dados.categoria,
        criadaEm: agora(),
        erro: null,
        chave: crypto.randomUUID(),
        tentativas: 0,
        ultimaTentativa: null
      });
      pedido.onsuccess = () => definir(pedido.result);
    });
  }

  // Todas as pendentes, pela ordem de criação.
  function lerPendentes() {
    return transacao(['pendentes'], 'readonly', (tx, definir) => {
      const pedido = tx.objectStore('pendentes').getAll();
      pedido.onsuccess = () => definir(pedido.result);
    });
  }

  // Pendentes de um utilizador ainda por enviar (sem erro), pela ordem de idLocal.
  function lerPendentesDe(utilizador) {
    return transacao(['pendentes'], 'readonly', (tx, definir) => {
      const pedido = tx.objectStore('pendentes').index('porUtilizador').getAll(IDBKeyRange.only(utilizador));
      pedido.onsuccess = () => definir(pedido.result
        .filter((p) => p.erro === null)
        .sort((a, b) => a.idLocal - b.idLocal));
    });
  }

  // Número de pendentes de um utilizador ainda por enviar (sem erro).
  function contarPendentes(utilizador) {
    return lerPendentesDe(utilizador).then((lista) => lista.length);
  }

  function atualizarPendente(idLocal, alterar) {
    return transacao(['pendentes'], 'readwrite', (tx) => {
      const loja = tx.objectStore('pendentes');
      const pedido = loja.get(idLocal);
      pedido.onsuccess = () => {
        if (pedido.result) loja.put(alterar(pedido.result));
      };
    });
  }

  function registarTentativa(idLocal) {
    return atualizarPendente(idLocal, (p) => ({ ...p, tentativas: (p.tentativas ?? 0) + 1, ultimaTentativa: agora() }));
  }

  function marcarErro(idLocal, mensagem) {
    return atualizarPendente(idLocal, (p) => ({ ...p, erro: mensagem }));
  }

  // Remove a pendente e guarda a Sugestao criada, numa só transação sobre as duas lojas.
  function confirmarPendente(idLocal, sugestao) {
    return transacao(['pendentes', 'sugestoes'], 'readwrite', (tx) => {
      tx.objectStore('pendentes').delete(idLocal);
      tx.objectStore('sugestoes').put(sugestao);
    });
  }

  function descartarPendente(idLocal) {
    return transacao(['pendentes'], 'readwrite', (tx) => {
      tx.objectStore('pendentes').delete(idLocal);
    });
  }

  // ---------- Proprietário ----------

  function lerProprietario() {
    return transacao(['meta'], 'readonly', (tx, definir) => {
      const pedido = tx.objectStore('meta').get('proprietario');
      pedido.onsuccess = () => definir(pedido.result ?? null);
    });
  }

  // Guarda a Sessao como proprietário. Mantém atualizadoEm se for o mesmo utilizador.
  function guardarProprietario(sessao) {
    return transacao(['meta'], 'readwrite', (tx, definir) => {
      const meta = tx.objectStore('meta');
      const pedido = meta.get('proprietario');
      pedido.onsuccess = () => {
        const anterior = pedido.result;
        const registo = {
          chave: 'proprietario',
          utilizador: sessao.utilizador,
          nome: sessao.nome,
          papel: sessao.papel,
          expiracao: sessao.expiracao,
          atualizadoEm: anterior && anterior.utilizador === sessao.utilizador ? anterior.atualizadoEm : null
        };
        meta.put(registo);
        definir(registo);
      };
    });
  }

  // Esvazia as três lojas numa só transação (incluindo o proprietário e os cursores).
  function limparBD() {
    return transacao(['sugestoes', 'pendentes', 'meta'], 'readwrite', (tx) => {
      tx.objectStore('sugestoes').clear();
      tx.objectStore('pendentes').clear();
      tx.objectStore('meta').clear();
    });
  }

  self.bd = Object.freeze({
    abrirBD,
    lerSugestoes,
    aplicarAlteracoes,
    lerCursor,
    acrescentarPendente,
    lerPendentes,
    lerPendentesDe,
    contarPendentes,
    registarTentativa,
    marcarErro,
    confirmarPendente,
    descartarPendente,
    lerProprietario,
    guardarProprietario,
    limparBD,
    // A página regista aqui o aviso «Há uma versão nova da aplicação…».
    definirAoMudarVersao(funcao) { aoMudarVersao = funcao; }
  });
})();
