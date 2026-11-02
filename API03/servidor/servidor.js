// Arranque, rotas e tratamento de erros do servidor (API v2.1.0).
// Arranque: node --env-file=.env servidor.js
import express from 'express';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  criarRotaTokens, criarRotaSessao, obterSessao, terminarSessao,
  criarExigirToken, exigirPapel, enviarErro
} from './autenticacao.js';
import { validarSugestaoNova, criarSugestao } from './sugestoes.js';

const PORTA = 3000;
const pasta = path.dirname(fileURLToPath(import.meta.url));

// --- Configuração: sem segredo válido, o servidor não arranca. ---
const segredo = process.env.JWT_SEGREDO;
if (!segredo || segredo.length < 32) {
  console.error('Erro: JWT_SEGREDO não está definido ou tem menos de 32 caracteres.');
  console.error('Crie o ficheiro .env a partir de .env.exemplo e arranque com: node --env-file=.env servidor.js');
  process.exit(1);
}

const validade = process.env.JWT_VALIDADE === undefined || process.env.JWT_VALIDADE === ''
  ? 900
  : Number(process.env.JWT_VALIDADE);
if (!Number.isInteger(validade) || validade < 1) {
  console.error('Erro: JWT_VALIDADE tem de ser um número inteiro positivo de segundos.');
  process.exit(1);
}

const lerJSON = (ficheiro) => JSON.parse(readFileSync(path.join(pasta, ficheiro), 'utf8'));
const utilizadores = lerJSON('dados/utilizadores.json');
const sugestoes = lerJSON('dados/sugestoes.json'); // as novas sugestões só ficam em memória
const ficheiroContrato = path.join(pasta, '..', 'sugestoes.openapi.yaml');

const exigirToken = criarExigirToken(segredo);

// --- Aplicação ---
const app = express();
app.disable('x-powered-by');
app.use(express.json());
app.use(express.static(path.join(pasta, 'public')));

// criarToken (pública)
app.post('/v2/tokens', criarRotaTokens({ segredo, validade, utilizadores }));

// Sessão por cookie: criarSessao (pública), obterSessao (protegida), terminarSessao (pública).
app.post('/v2/sessao', criarRotaSessao({ segredo, validade, utilizadores }));
app.get('/v2/sessao', exigirToken, obterSessao);
app.delete('/v2/sessao', terminarSessao);

// criarSugestao (protegida, só alunos): o numeroAluno é o sub do token, nunca o do corpo.
app.post('/v2/sugestoes', exigirToken, exigirPapel('aluno'), (req, res) => {
  const detalhes = validarSugestaoNova(req.body);
  if (detalhes.length > 0) {
    return enviarErro(res, 400, 'O pedido não cumpre o schema SugestaoNova.', detalhes);
  }
  const sugestao = criarSugestao(sugestoes, req.body, req.utilizador.sub);
  res.status(201)
    .set('Location', `/v2/sugestoes/${sugestao.id}`)
    .set('Cache-Control', 'no-store')
    .json(sugestao);
});

// listarSugestoes (protegida): um aluno vê as suas; os serviços veem todas.
app.get('/v2/sugestoes', exigirToken, (req, res) => {
  const { sub, papel } = req.utilizador;
  const visiveis = papel === 'servicos'
    ? sugestoes
    : sugestoes.filter((s) => s.numeroAluno === sub);
  res.set('Cache-Control', 'private, no-cache').json({
    pagina: 1,
    tamanhoPagina: 20,
    total: visiveis.length,
    itens: visiveis.slice(0, 20)
  });
});

// Publicação do contrato.
app.get('/v2/openapi.yaml', (req, res) => {
  res.set('Cache-Control', 'no-cache').type('application/yaml').sendFile(ficheiroContrato);
});

// Qualquer outro caminho da API: 404 com corpo Erro.
app.use('/v2', (req, res) => enviarErro(res, 404, 'Recurso inexistente.'));

// Middleware de erros final: JSON mal formado → 400; qualquer outra exceção → 500.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.type === 'entity.parse.failed') {
    return enviarErro(res, 400, 'O corpo do pedido não é JSON válido.');
  }
  console.error(err);
  enviarErro(res, 500, 'Erro interno do servidor.');
});

app.listen(PORTA, () => {
  console.log(`Servidor em http://localhost:${PORTA} (tokens válidos durante ${validade} s)`);
});
