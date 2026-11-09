// Service worker: guarda os ficheiros da interface e as categorias na Cache API.
// Nunca guarda respostas que dependem do cookie (sessão, sugestões): a Cache API
// identifica cada resposta só pelo método e pelo URL, não por quem a pediu.
// Não usa a IndexedDB.

const CACHE_INTERFACE = 'interface-v1';
const CACHE_DADOS = 'dados-publicos';

const FICHEIROS_INTERFACE = [
  '/',
  '/index.html',
  '/estilos.css',
  '/app.js',
  '/configuracoes.js',
  '/bd.js',
  '/pendentes.js'
];
const CAMINHOS_INTERFACE = new Set(FICHEIROS_INTERFACE);

// Instalação: preenche a cache da versão atual (cache: 'reload' ignora a cache HTTP).
self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(CACHE_INTERFACE).then((cache) =>
      cache.addAll(FICHEIROS_INTERFACE.map((url) => new Request(url, { cache: 'reload' }))))
  );
});

// Ativação: apaga as caches de versões anteriores e passa a controlar as páginas abertas.
self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes
        .filter((nome) => nome !== CACHE_INTERFACE && nome !== CACHE_DADOS)
        .map((nome) => caches.delete(nome))))
      .then(() => self.clients.claim())
  );
});

// Atualização pedida pela página (botão «Atualizar a aplicação»).
self.addEventListener('message', (evento) => {
  if (evento.data && evento.data.tipo === 'ativar') self.skipWaiting();
});

// Cache primeiro: responde da cache; só vai à rede se não houver cópia.
async function cachePrimeiro(pedido, caminho) {
  const cache = await caches.open(CACHE_INTERFACE);
  const copia = await cache.match(caminho);
  if (copia) return copia;
  const resposta = await fetch(pedido);
  if (resposta.ok) await cache.put(caminho, resposta.clone());
  return resposta;
}

// Cache e atualização em segundo plano: responde da cache (se houver) e, em paralelo,
// vai buscar uma cópia nova para a próxima vez.
function cacheEAtualizacao(evento) {
  const pedido = evento.request;
  const daRede = caches.open(CACHE_DADOS).then((cache) =>
    fetch(pedido).then((resposta) => {
      if (!resposta.ok) return resposta;
      return cache.put(pedido, resposta.clone()).then(() => resposta);
    }));

  evento.waitUntil(daRede.catch(() => undefined)); // a atualização continua depois da resposta
  evento.respondWith(
    caches.open(CACHE_DADOS)
      .then((cache) => cache.match(pedido))
      .then((copia) => copia || daRede)
  );
}

self.addEventListener('fetch', (evento) => {
  const pedido = evento.request;

  // Qualquer pedido que não seja GET: só rede.
  if (pedido.method !== 'GET') return;

  const url = new URL(pedido.url);
  if (url.origin !== self.location.origin) return;

  // Dados públicos, iguais para todos.
  if (url.pathname === '/v2/categorias') {
    cacheEAtualizacao(evento);
    return;
  }

  // Qualquer outro pedido à API (sessão, sugestões, …): só rede, sem respondWith.
  if (url.pathname === '/v2' || url.pathname.startsWith('/v2/')) return;

  // Ficheiros da interface: cache primeiro.
  if (CAMINHOS_INTERFACE.has(url.pathname)) {
    evento.respondWith(cachePrimeiro(pedido, url.pathname));
  }
  // Resto (por exemplo /favicon.ico): só rede.
});
