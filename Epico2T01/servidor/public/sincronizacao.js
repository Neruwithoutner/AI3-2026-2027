// Reporta · sincronização (sprint 1: provisório). Só usado pelo service worker (importScripts).
// Sprint 2: executarSincronizacao() envia as pendentes do cidadão, uma de cada vez e por ordem de
// idLocal, com a respetiva Idempotency-Key, trata cada resposta e, com a fila vazia, faz o pull de
// GET /v1/ocorrencias/alteracoes?desde=<cursor>.
//
// Resultado: { tipo: 'sincronizado', criadas, reforcadas, recusadas, recebidas, porEnviar }.

async function executarSincronizacao() {
  console.info('[sw] executarSincronizacao(): por implementar (sprint 2)');
  return { tipo: 'sincronizado', criadas: 0, reforcadas: 0, recusadas: 0, recebidas: 0, porEnviar: 0 };
}
