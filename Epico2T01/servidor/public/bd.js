// Reporta · IndexedDB (sprint 1: provisório).
// Partilhado pela página (<script src="/bd.js">) e pelo service worker (importScripts('/bd.js')):
// script clássico, sem window, document nem localStorage; as funções ficam em self.bd.
//
// Base reporta-bd (sprint 2):
//   ocorrencias  chave id                       índice porEstado
//   pendentes    chave idLocal (autoIncrement)  índice porCidadao
//   minhas       chave idLocal                  índice porOcorrencia
//   meta         chave chave                    cidadao, categorias, cursor:<cidadao>
//
// Todas as funções devolverão uma Promise resolvida no evento complete da transação.

(() => {
  const NOME_BD = 'reporta-bd';
  const VERSAO_BD = 1;

  const porImplementar = (nome) => () =>
    Promise.reject(new Error(`bd.${nome}: por implementar (sprint 2)`));

  self.bd = Object.freeze({
    NOME_BD,
    VERSAO_BD,
    abrirBD: porImplementar('abrirBD'),
    acrescentarPendente: porImplementar('acrescentarPendente'),   // (dados, cidadao) — gera a chave
    lerPendentesDe: porImplementar('lerPendentesDe'),             // (cidadao)
    registarTentativa: porImplementar('registarTentativa'),       // (idLocal)
    marcarErro: porImplementar('marcarErro'),                     // (idLocal, mensagem)
    confirmarPendente: porImplementar('confirmarPendente'),       // (idLocal, resultado, ocorrencia)
    aplicarAlteracoes: porImplementar('aplicarAlteracoes'),       // (cidadao, alteracoes, cursor)
    lerCursor: porImplementar('lerCursor'),                       // (cidadao)
    lerCidadao: porImplementar('lerCidadao')                      // UUID do dispositivo, em meta
  });
})();
