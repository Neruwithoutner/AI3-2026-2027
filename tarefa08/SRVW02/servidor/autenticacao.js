// Emissão e verificação de tokens JWT (HS256), sessão por cookie e respostas de erro comuns.
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { lerCookie } from './cookies.js';

const ALGORITMO = 'HS256';
export const NOME_COOKIE = 'sessao';
const CAMINHO_COOKIE = '/v2';

// Mesmo pattern que Credenciais.utilizador no contrato.
const PADRAO_UTILIZADOR = /^([0-9]{5,8}|[a-z]+\.[a-z]+)$/;

// Hash bcrypt (custo 10) de uma palavra-passe aleatória que não pertence a ninguém.
// Usado quando o utilizador não existe, para que a resposta demore o mesmo
// que uma palavra-passe errada.
const HASH_FIXO = '$2b$10$i/o/aBLppSyNewXbpdbV7eTLpJI2zfW63hjLve6fA1aSwUm5RuGUG';

const MENSAGEM_CREDENCIAIS = 'Utilizador ou palavra-passe inválidos.';

// Envia um corpo Erro, sempre com Cache-Control: no-store.
export function enviarErro(res, codigo, mensagem, detalhes) {
  const corpo = { codigo, mensagem };
  if (detalhes && detalhes.length > 0) corpo.detalhes = detalhes;
  res.status(codigo).set('Cache-Control', 'no-store').json(corpo);
}

// Verifica o corpo contra o schema Credenciais; devolve um elemento por campo inválido.
function validarCredenciais(corpo) {
  if (corpo === null || typeof corpo !== 'object' || Array.isArray(corpo)) {
    return [{ campo: '(corpo)', problema: 'tem de ser um objeto JSON com utilizador e palavraPasse' }];
  }
  const detalhes = [];
  const { utilizador, palavraPasse } = corpo;

  if (utilizador === undefined) {
    detalhes.push({ campo: 'utilizador', problema: 'é obrigatório' });
  } else if (typeof utilizador !== 'string') {
    detalhes.push({ campo: 'utilizador', problema: 'tem de ser uma string' });
  } else if (!PADRAO_UTILIZADOR.test(utilizador)) {
    detalhes.push({ campo: 'utilizador', problema: 'tem de ser um número de aluno (5 a 8 algarismos) ou um identificador nome.apelido' });
  }

  if (palavraPasse === undefined) {
    detalhes.push({ campo: 'palavraPasse', problema: 'é obrigatória' });
  } else if (typeof palavraPasse !== 'string') {
    detalhes.push({ campo: 'palavraPasse', problema: 'tem de ser uma string' });
  } else if (palavraPasse.length < 8 || palavraPasse.length > 128) {
    detalhes.push({ campo: 'palavraPasse', problema: 'tem de ter entre 8 e 128 caracteres' });
  }

  return detalhes;
}

// Verificação comum a POST /v2/tokens e POST /v2/sessao.
// Se as credenciais forem válidas devolve o registo do utilizador; senão já respondeu 400 ou 401.
async function autenticar(req, res, utilizadores) {
  const detalhes = validarCredenciais(req.body);
  if (detalhes.length > 0) {
    enviarErro(res, 400, 'O pedido não cumpre o schema Credenciais.', detalhes);
    return null;
  }

  const { utilizador, palavraPasse } = req.body;
  const registo = utilizadores.find((u) => u.utilizador === utilizador);

  // A comparação é feita sempre, mesmo sem utilizador, para o tempo não o denunciar.
  const correta = await bcrypt.compare(palavraPasse, registo ? registo.hashPalavraPasse : HASH_FIXO);
  if (!registo || !correta) {
    enviarErro(res, 401, MENSAGEM_CREDENCIAIS);
    return null;
  }
  return registo;
}

function emitirToken(registo, segredo, validade) {
  return jwt.sign(
    { nome: registo.nome, papel: registo.papel },
    segredo,
    { algorithm: ALGORITMO, subject: registo.utilizador, expiresIn: validade }
  );
}

// Corpo Sessao (contrato) a partir dos dados do token.
function sessao({ sub, nome, papel, exp }) {
  return { utilizador: sub, nome, papel, expiracao: new Date(exp * 1000).toISOString().replace('.000Z', 'Z') };
}

// POST /v2/tokens (criarToken).
export function criarRotaTokens({ segredo, validade, utilizadores }) {
  return async (req, res) => {
    const registo = await autenticar(req, res, utilizadores);
    if (!registo) return;
    const token = emitirToken(registo, segredo, validade);
    res.status(200).set('Cache-Control', 'no-store').json({ token, tipo: 'Bearer', expiraEm: validade });
  };
}

// POST /v2/sessao (criarSessao): o mesmo token, mas entregue num cookie HttpOnly.
export function criarRotaSessao({ segredo, validade, utilizadores }) {
  return async (req, res) => {
    const registo = await autenticar(req, res, utilizadores);
    if (!registo) return;
    const token = emitirToken(registo, segredo, validade);
    const { exp } = jwt.decode(token);

    res.cookie(NOME_COOKIE, token, {
      httpOnly: true,
      sameSite: 'strict',
      path: CAMINHO_COOKIE,
      maxAge: validade * 1000 // no Express, maxAge é indicado em milissegundos
    });
    res.status(200).set('Cache-Control', 'no-store')
      .json(sessao({ sub: registo.utilizador, nome: registo.nome, papel: registo.papel, exp }));
  };
}

// GET /v2/sessao (obterSessao): protegida com exigirToken.
export function obterSessao(req, res) {
  res.status(200).set('Cache-Control', 'no-store').json(sessao(req.utilizador));
}

// DELETE /v2/sessao (terminarSessao): pede ao browser que apague o cookie.
export function terminarSessao(req, res) {
  res.clearCookie(NOME_COOKIE, { path: CAMINHO_COOKIE });
  res.status(204).set('Cache-Control', 'no-store').end();
}

function naoAutenticado(res, desafio, mensagem) {
  res.set('WWW-Authenticate', desafio);
  enviarErro(res, 401, mensagem);
}

// Middleware exigirToken: só deixa seguir pedidos com um token válido.
// O token vem do cabeçalho Authorization; se este não existir, do cookie sessao.
export function criarExigirToken(segredo) {
  return (req, res, next) => {
    const autorizacao = req.get('Authorization');
    let token;

    if (autorizacao !== undefined) {
      // O esquema é insensível a maiúsculas (RFC 9110); o token não tem espaços.
      const correspondencia = /^Bearer ([^\s]+)$/i.exec(autorizacao);
      if (!correspondencia) {
        return naoAutenticado(res, 'Bearer', 'É necessário um token de autenticação.');
      }
      token = correspondencia[1];
    } else {
      token = lerCookie(req, NOME_COOKIE);
      if (!token) {
        return naoAutenticado(res, 'Bearer', 'É necessário um token de autenticação.');
      }
    }

    let payload;
    try {
      // algorithms: só HS256 (rejeita "none" e qualquer outro algoritmo do cabeçalho).
      // A expiração (exp) é verificada por omissão: não se passa ignoreExpiration.
      payload = jwt.verify(token, segredo, { algorithms: [ALGORITMO] });
    } catch {
      return naoAutenticado(res, 'Bearer error="invalid_token"', 'Token inválido ou expirado.');
    }

    req.utilizador = { sub: payload.sub, nome: payload.nome, papel: payload.papel, exp: payload.exp };
    next();
  };
}

// exigirPapel(papel): responde 403 se o papel do token não for o indicado.
export function exigirPapel(papel) {
  return (req, res, next) => {
    if (req.utilizador?.papel !== papel) {
      return enviarErro(res, 403, 'O seu papel não permite esta operação.');
    }
    next();
  };
}
