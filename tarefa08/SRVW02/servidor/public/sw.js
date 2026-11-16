// Service worker: guarda os ficheiros da interface e as categorias na Cache API
// e executa a sincronização das sugestões (fila de saída e alterações do servidor).
// Nunca guarda respostas que dependem do cookie (sessão, sugestões): a Cache API
// identifica cada resposta só pelo método e pelo URL, não por quem a pediu.
// Os pedidos que o próprio service worker faz com fetch() não passam pelo seu evento fetch.

importScripts('/bd.js', '/sincronizacao.js'); // self.bd e executarSincronizacao()

const CACHE_INTERFACE = 'interface-v3';
const CACHE_DADOS = 'dados-publicos';

const FICHEIROS_INTERFACE = [
  '/',
  '/index.html',
  '/estilos.css',
  '/app.js',
  '/configuracoes.js',
  '/bd.js',
  '/pendentes.js',
  '/sincronizacao.js'
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

// ---------- Sincronização ----------

const ETIQUETA_SYNC = 'sincronizar-sugestoes';

// Única exceção à regra de não guardar estado em variáveis globais: a promessa da
// sincronização em curso, para não haver duas ao mesmo tempo dentro do mesmo arranque.
let emCurso = null;

function sincronizar() {
  emCurso ??= executarSincronizacao().finally(() => { emCurso = null; });
  return emCurso;
}

// Envia o resultado a todas as páginas abertas (se não houver nenhuma, não faz nada).
async function avisarPaginas(mensagem) {
  for (const cliente of await self.clients.matchAll({ type: 'window' })) {
    cliente.postMessage(mensagem);
  }
}

const resultadoDoErro = (erro) => ({
  tipo: erro.tipo === 'sem-rede' || erro.tipo === 'erro-servidor' ? erro.tipo : 'erro-servidor',
  porEnviar: erro.porEnviar ?? 0,
  mensagem: erro.message
});

// Background Sync (Chromium): o browser acorda o service worker quando houver ligação,
// mesmo com o separador fechado. Rejeitar a promessa pede ao browser nova tentativa.
self.addEventListener('sync', (evento) => {
  if (evento.tag !== ETIQUETA_SYNC) return;
  evento.waitUntil((async () => {
    try {
      const resultado = await sincronizar();
      await avisarPaginas(resultado); // sessão expirada: resolve (repetir não adianta)
    } catch (erro) {
      const resultado = { ...resultadoDoErro(erro), ultimaTentativa: evento.lastChance };
      await avisarPaginas(resultado);
      throw erro; // sem-rede ou erro-servidor: o browser volta a tentar mais tarde
    }
  })());
});

// Mensagens da página: { tipo: 'sincronizar' } (plano B) e { tipo: 'ativar' } (atualização).
self.addEventListener('message', (evento) => {
  const tipo = evento.data && evento.data.tipo;
  if (tipo === 'ativar') {
    self.skipWaiting();
  } else if (tipo === 'sincronizar') {
    evento.waitUntil(
      sincronizar()
        .then((resultado) => avisarPaginas(resultado))
        .catch((erro) => avisarPaginas(resultadoDoErro(erro)))
    );
  }
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
