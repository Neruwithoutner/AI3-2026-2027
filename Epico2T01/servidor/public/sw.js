// Reporta · service worker (sprint 1: install e activate provisórios, ainda sem estratégia de cache).
//
// Sprint 2:
//   - install: pré-carregar a interface na cache interface-v1;
//   - fetch: cache-first para a interface; /v1/ nunca passa pela Cache API; mosaicos do mapa network-only;
//   - sync (etiqueta sincronizar-reporta) e mensagem { tipo: 'sincronizar' } → executarSincronizacao().

importScripts('/bd.js', '/sincronizacao.js');

const VERSAO = 'sprint-1';

self.addEventListener('install', (evento) => {
  console.info(`[sw ${VERSAO}] install`);
  // Provisório: ativa logo a nova versão. Com a cache da interface, passará a esperar pela página.
  evento.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (evento) => {
  console.info(`[sw ${VERSAO}] activate`);
  // Passa a controlar as páginas já abertas, sem esperar por um recarregamento.
  evento.waitUntil(self.clients.claim());
});
