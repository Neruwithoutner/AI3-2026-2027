// Reporta · servidor Express (API /v1 e PWA). Sprint 1: esqueleto.
//
// Arranque:  npm install  →  cp .env.exemplo .env  →  node --env-file=.env servidor.js
//
// Neste sprint, cada rota do contrato (reporta.openapi.yaml, v1.0.0) responde
// 501 Not Implemented com um corpo Erro. Nenhuma funcionalidade está implementada:
// deteção de duplicados, idempotência, sincronização e OAuth ficam para os sprints seguintes.

const path = require('node:path');
const express = require('express');

const PORTO = Number(process.env.PORTO) || 3000;
const PASTA_PUBLICA = path.join(__dirname, 'public');

const app = express();
app.disable('x-powered-by');

// Corpo JSON (a fotografia chega como data URL de até 300 KB, cerca de 400 KB em base64).
app.use(express.json({ limit: '512kb' }));

// Resposta no formato Erro do contrato: { codigo, mensagem, detalhes? }.
function enviarErro(res, codigo, mensagem, detalhes) {
  const corpo = { codigo, mensagem };
  if (detalhes) corpo.detalhes = detalhes;
  res.status(codigo).set('Cache-Control', 'no-store').json(corpo);
}

// Resposta provisória de uma operação do contrato ainda por implementar.
function naoImplementada(req, res) {
  enviarErro(res, 501, `Operação ainda não implementada: ${req.method} ${req.baseUrl}${req.route.path.replace(":id", "{id}")}.`);
}

// ---------- API /v1: as 8 operações do contrato ----------
// As rotas fixas (/semelhantes, /alteracoes) vêm antes das que têm :id.
const api = express.Router();

api.get('/categorias', naoImplementada);                    // listarCategorias
api.get('/ocorrencias/semelhantes', naoImplementada);       // procurarSemelhantes
api.get('/ocorrencias/alteracoes', naoImplementada);        // listarAlteracoes
api.get('/ocorrencias', naoImplementada);                   // listarOcorrencias (bbox)
api.post('/ocorrencias', naoImplementada);                  // comunicarOcorrencia
api.post('/ocorrencias/:id/reforcos', naoImplementada);     // reforcarOcorrencia
api.get('/ocorrencias/:id/fotografia', naoImplementada);    // obterFotografia
api.patch('/admin/ocorrencias/:id', naoImplementada);       // alterarEstado

// Qualquer outro caminho dentro de /v1: 404 com corpo Erro.
api.use((req, res) => enviarErro(res, 404, `Recurso inexistente: ${req.method} ${req.originalUrl}.`));

app.use('/v1', api);

// ---------- PWA ----------
// O manifesto tem tipo próprio; sw.js nunca vem da cache HTTP, para as atualizações chegarem logo.
app.use(express.static(PASTA_PUBLICA, {
  setHeaders(res, ficheiro) {
    if (ficheiro.endsWith('.webmanifest')) res.type('application/manifest+json');
    if (path.basename(ficheiro) === 'sw.js') res.set('Cache-Control', 'no-cache');
  }
}));

// Qualquer outro caminho: 404 com corpo Erro.
app.use((req, res) => enviarErro(res, 404, `Recurso inexistente: ${req.method} ${req.originalUrl}.`));

// Erros: JSON mal formado ou corpo demasiado grande → 400/413; o resto → 500.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.type === 'entity.parse.failed') return enviarErro(res, 400, 'O corpo do pedido não é JSON válido.');
  if (err.type === 'entity.too.large') return enviarErro(res, 413, 'O corpo do pedido é demasiado grande.');
  console.error(err);
  enviarErro(res, 500, 'Erro interno do servidor.');
});

app.listen(PORTO, () => {
  console.log(`Reporta em http://localhost:${PORTO}  (API em /v1, sprint 1: rotas a responder 501)`);
  if (!process.env.ADMIN_TOKEN) console.log('Aviso: ADMIN_TOKEN vazio no .env (só será usado no sprint seguinte).');
});
