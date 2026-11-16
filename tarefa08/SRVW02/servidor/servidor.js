// Arranque, rotas e tratamento de erros do servidor (API v2.2.0, ficha API05).
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
import { PADRAO_UUID, jsonCanonico, procurarChave, guardarChave } from './idempotencia.js';

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

// Contador de versões: só cresce. Cada criação (ou alteração) recebe o valor seguinte.
let ultimaVersao = sugestoes.reduce((maior, s) => Math.max(maior, s.versao ?? 0), 0);
const proximaVersao = () => ++ultimaVersao;

// Simulações para os ensaios (desligadas por omissão).
const simularPerdaResposta = process.env.SIMULAR_PERDA_RESPOSTA === '1';
let restantes503 = Number.parseInt(process.env.SIMULAR_503 ?? '', 10);
if (!Number.isInteger(restantes503) || restantes503 < 0) restantes503 = 0;
const ficheiroContrato = path.join(pasta, '..', 'sugestoes.openapi.yaml');

const exigirToken = criarExigirToken(segredo);

// As cinco categorias do domínio (schema Categoria: descricao entre 3 e 80 caracteres).
const CATEGORIAS = [
  { codigo: 'instalacoes', descricao: 'Edifícios, salas, equipamentos e espaços exteriores' },
  { codigo: 'ensino', descricao: 'Aulas, horários, avaliação e materiais de apoio' },
  { codigo: 'servicos', descricao: 'Secretaria, biblioteca, cantina e outros serviços' },
  { codigo: 'atividades', descricao: 'Eventos, workshops, desporto e vida associativa' },
  { codigo: 'outra', descricao: 'Assuntos que não cabem nas restantes categorias' }
];

// --- Aplicação ---
const app = express();
app.disable('x-powered-by');
app.use(express.json());
app.use(express.static(path.join(pasta, 'public')));

// criarToken (pública)
app.post('/v2/tokens', criarRotaTokens({ segredo, validade, utilizadores }));

// listarCategorias (pública): igual para todos, pode ficar em qualquer cache durante um dia.
app.get('/v2/categorias', (req, res) => {
  res.set('Cache-Control', 'public, max-age=86400').json(CATEGORIAS);
});

// Sessão por cookie: criarSessao (pública), obterSessao (protegida), terminarSessao (pública).
app.post('/v2/sessao', criarRotaSessao({ segredo, validade, utilizadores }));
app.get('/v2/sessao', exigirToken, obterSessao);
app.delete('/v2/sessao', terminarSessao);

// Simulação de falha do servidor: os próximos SIMULAR_503 pedidos recebem 503, sem criar nada.
function simular503(req, res, next) {
  if (restantes503 > 0) {
    restantes503--;
    res.set('Retry-After', '2');
    return enviarErro(res, 503, 'Serviço temporariamente indisponível (simulado).');
  }
  next();
}

// criarSugestao (protegida, só alunos): o numeroAluno é o sub do token, nunca o do corpo.
// Com Idempotency-Key, uma repetição com o mesmo corpo devolve a resposta guardada.
app.post('/v2/sugestoes', simular503, exigirToken, exigirPapel('aluno'), (req, res) => {
  const utilizador = req.utilizador.sub;
  const chave = req.get('Idempotency-Key');

  if (chave !== undefined) {
    if (!PADRAO_UUID.test(chave)) {
      return enviarErro(res, 400, 'O cabeçalho Idempotency-Key tem de ser um UUID.',
        [{ campo: 'Idempotency-Key', problema: 'tem de ser um UUID, por exemplo 6f1c2a4e-8b3d-4c1f-9a7e-2d5b8c0f1e34' }]);
    }
    const anterior = procurarChave(utilizador, chave);
    if (anterior) {
      if (anterior.corpo !== jsonCanonico(req.body)) {
        return enviarErro(res, 409, 'A Idempotency-Key já foi usada com um corpo diferente.');
      }
      return res.status(anterior.codigo)
        .set('Location', anterior.location)
        .set('Cache-Control', 'no-store')
        .set('Idempotent-Replayed', 'true')
        .json(anterior.resposta);
    }
  }

  const detalhes = validarSugestaoNova(req.body);
  if (detalhes.length > 0) {
    // Um 400 de validação não fica associado à chave.
    return enviarErro(res, 400, 'O pedido não cumpre o schema SugestaoNova.', detalhes);
  }

  const sugestao = criarSugestao(sugestoes, req.body, utilizador, proximaVersao());
  const location = `/v2/sugestoes/${sugestao.id}`;

  if (chave !== undefined) {
    // A chave só é guardada depois de a sugestão estar criada.
    guardarChave(utilizador, chave, { corpo: req.body, codigo: 201, location, resposta: sugestao });
    if (simularPerdaResposta) {
      // Simulação: a sugestão foi criada e a chave guardada, mas a resposta perde-se.
      console.log(`[simulação] resposta perdida para a chave ${chave} (sugestão ${sugestao.id} criada)`);
      req.socket.destroy();
      return;
    }
  }

  res.status(201)
    .set('Location', location)
    .set('Cache-Control', 'no-store')
    .json(sugestao);
});

// listarAlteracoes (protegida): sugestões com versao > desde, por ordem crescente de versao.
// Mesma visibilidade que listarSugestoes: um aluno vê as suas; os serviços veem todas.
app.get('/v2/sugestoes/alteracoes', exigirToken, (req, res) => {
  const desde = req.query.desde;
  if (typeof desde !== 'string' || !/^\d+$/.test(desde) || !Number.isSafeInteger(Number(desde))) {
    return enviarErro(res, 400, 'O parâmetro desde tem de ser um inteiro maior ou igual a 0.',
      [{ campo: 'desde', problema: desde === undefined ? 'é obrigatório' : 'tem de ser um inteiro maior ou igual a 0' }]);
  }
  const n = Number(desde);
  const { sub, papel } = req.utilizador;
  const alteracoes = sugestoes
    .filter((s) => (papel === 'servicos' || s.numeroAluno === sub) && s.versao > n)
    .sort((a, b) => a.versao - b.versao);
  const cursor = alteracoes.length > 0 ? alteracoes[alteracoes.length - 1].versao : n;
  res.set('Cache-Control', 'private, no-store').json({ alteracoes, cursor });
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
  if (simularPerdaResposta) console.log('[simulação] SIMULAR_PERDA_RESPOSTA ativa');
  if (restantes503 > 0) console.log(`[simulação] SIMULAR_503: os próximos ${restantes503} POST /v2/sugestoes recebem 503`);
});
