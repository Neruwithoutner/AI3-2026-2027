// IndexedDB: cópia local de GET /v2/sugestoes e sugestões pendentes de POST /v2/sugestoes.
// Só a página usa este módulo (o service worker não acede à IndexedDB).
//
// Base de dados sugestoes-bd, versão 1:
//   sugestoes  chave id                       índices porEstado (estado), porData (dataCriacao)
//   pendentes  chave idLocal (autoIncrement)  —
//   meta       chave chave                    registo «proprietario»
//
// Todas as funções devolvem uma Promise resolvida só no evento complete da transação.

const NOME_BD = 'sugestoes-bd';
const VERSAO_BD = 1;
const ORDEM_ESTADOS = ['submetida', 'em_analise', 'aceite', 'rejeitada', 'resolvida'];

let ligacao = null; // Promise da ligação aberta, partilhada pelas funções

export function abrirBD() {
  if (ligacao) return ligacao;
  ligacao = new Promise((resolve, reject) => {
    const pedido = indexedDB.open(NOME_BD, VERSAO_BD);

    // A estrutura só pode ser criada ou alterada aqui.
    pedido.onupgradeneeded = () => {
      const bd = pedido.result;
      const sugestoes = bd.createObjectStore('sugestoes', { keyPath: 'id' });
      sugestoes.createIndex('porEstado', 'estado');
      sugestoes.createIndex('porData', 'dataCriacao');
      bd.createObjectStore('pendentes', { keyPath: 'idLocal', autoIncrement: true });
      bd.createObjectStore('meta', { keyPath: 'chave' });
    };

    pedido.onsuccess = () => {
      const bd = pedido.result;
      // Se outra versão da base de dados for aberta noutro separador, liberta esta ligação.
      bd.onversionchange = () => {
        bd.close();
        ligacao = null;
      };
      resolve(bd);
    };
    pedido.onerror = () => {
      ligacao = null;
      reject(pedido.error);
    };
  });
  return ligacao;
}

// Executa `trabalho` numa transação e resolve com o valor definido quando a transação termina.
async function transacao(lojas, modo, trabalho) {
  const bd = await abrirBD();
  return new Promise((resolve, reject) => {
    const tx = bd.transaction(lojas, modo);
    let resultado;
    tx.oncomplete = () => resolve(resultado);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new DOMException('Transação cancelada.', 'AbortError'));
    try {
      trabalho(tx, (valor) => { resultado = valor; });
    } catch (erro) {
      tx.abort();
      reject(erro);
    }
  });
}

// ---------- Cópia local de GET /v2/sugestoes ----------

// Apaga e volta a preencher a loja sugestoes e atualiza o proprietário.atualizadoEm,
// tudo na mesma transação: ou fica a lista nova inteira, ou fica a antiga.
export function substituirSugestoes(lista) {
  return transacao(['sugestoes', 'meta'], 'readwrite', (tx, definir) => {
    const sugestoes = tx.objectStore('sugestoes');
    sugestoes.clear();
    for (const sugestao of lista) sugestoes.put(sugestao);

    const meta = tx.objectStore('meta');
    const pedido = meta.get('proprietario');
    pedido.onsuccess = () => {
      if (!pedido.result) return;
      const atualizado = { ...pedido.result, atualizadoEm: new Date().toISOString() };
      meta.put(atualizado);
      definir(atualizado);
    };
  });
}

// Devolve as sugestões pela ordem da configuração «ordenacao»:
//   recentes → índice porData, do mais recente para o mais antigo;
//   estado   → índice porEstado, estado a estado pela ordem do fluxo (submetida → resolvida).
export function lerSugestoes(ordenacao) {
  return transacao(['sugestoes'], 'readonly', (tx, definir) => {
    const loja = tx.objectStore('sugestoes');

    if (ordenacao === 'estado') {
      const indice = loja.index('porEstado');
      const grupos = ORDEM_ESTADOS.map(() => []);
      definir(grupos);
      ORDEM_ESTADOS.forEach((estado, posicao) => {
        const pedido = indice.getAll(IDBKeyRange.only(estado));
        pedido.onsuccess = () => { grupos[posicao] = pedido.result; };
      });
      // O resultado é achatado depois de a transação terminar (ver abaixo).
      return;
    }

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

// Acrescenta à cópia local uma sugestão criada com 201.
export function acrescentarSugestao(sugestao) {
  return transacao(['sugestoes'], 'readwrite', (tx) => {
    tx.objectStore('sugestoes').put(sugestao);
  });
}

// ---------- Pendentes de POST /v2/sugestoes ----------

// Guarda uma sugestão criada sem ligação; resolve com o idLocal gerado.
export function acrescentarPendente(dados, utilizador) {
  return transacao(['pendentes'], 'readwrite', (tx, definir) => {
    const pedido = tx.objectStore('pendentes').add({
      utilizador,
      titulo: dados.titulo,
      descricao: dados.descricao,
      categoria: dados.categoria,
      criadaEm: new Date().toISOString(),
      erro: null
    });
    pedido.onsuccess = () => definir(pedido.result);
  });
}

// Todas as pendentes, pela ordem de criação (idLocal crescente).
export function lerPendentes() {
  return transacao(['pendentes'], 'readonly', (tx, definir) => {
    const pedido = tx.objectStore('pendentes').getAll();
    pedido.onsuccess = () => definir(pedido.result);
  });
}

export function marcarErro(idLocal, mensagem) {
  return transacao(['pendentes'], 'readwrite', (tx) => {
    const loja = tx.objectStore('pendentes');
    const pedido = loja.get(idLocal);
    pedido.onsuccess = () => {
      if (pedido.result) loja.put({ ...pedido.result, erro: mensagem });
    };
  });
}

// Remove a pendente e acrescenta a Sugestao criada pelo servidor, numa só transação
// sobre as duas lojas: a sugestão nunca aparece duas vezes nem desaparece.
export function confirmarPendente(idLocal, sugestao) {
  return transacao(['pendentes', 'sugestoes'], 'readwrite', (tx) => {
    tx.objectStore('pendentes').delete(idLocal);
    tx.objectStore('sugestoes').put(sugestao);
  });
}

// Botão «Descartar».
export function descartarPendente(idLocal) {
  return transacao(['pendentes'], 'readwrite', (tx) => {
    tx.objectStore('pendentes').delete(idLocal);
  });
}

// ---------- Proprietário da cópia local ----------

export function lerProprietario() {
  return transacao(['meta'], 'readonly', (tx, definir) => {
    const pedido = tx.objectStore('meta').get('proprietario');
    pedido.onsuccess = () => definir(pedido.result ?? null);
  });
}

// Guarda a Sessao como proprietário. Mantém atualizadoEm se for o mesmo utilizador.
export function guardarProprietario(sessao) {
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

// Esvazia as três lojas numa só transação.
export function limparBD() {
  return transacao(['sugestoes', 'pendentes', 'meta'], 'readwrite', (tx) => {
    tx.objectStore('sugestoes').clear();
    tx.objectStore('pendentes').clear();
    tx.objectStore('meta').clear();
  });
}
