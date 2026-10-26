// Emissão e verificação de tokens JWT (HS256) e respostas de erro comuns.
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const ALGORITMO = 'HS256';

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

// POST /v2/tokens (criarToken).
export function criarRotaTokens({ segredo, validade, utilizadores }) {
  return async (req, res) => {
    const detalhes = validarCredenciais(req.body);
    if (detalhes.length > 0) {
      return enviarErro(res, 400, 'O pedido não cumpre o schema Credenciais.', detalhes);
    }

    const { utilizador, palavraPasse } = req.body;
    const registo = utilizadores.find((u) => u.utilizador === utilizador);

    // A comparação é feita sempre, mesmo sem utilizador, para o tempo não o denunciar.
    const correta = await bcrypt.compare(palavraPasse, registo ? registo.hashPalavraPasse : HASH_FIXO);
    if (!registo || !correta) {
      return enviarErro(res, 401, MENSAGEM_CREDENCIAIS);
    }

    const token = jwt.sign(
      { nome: registo.nome, papel: registo.papel },
      segredo,
      { algorithm: ALGORITMO, subject: registo.utilizador, expiresIn: validade }
    );

    res.status(200).set('Cache-Control', 'no-store').json({ token, tipo: 'Bearer', expiraEm: validade });
  };
}

function naoAutenticado(res, desafio, mensagem) {
  res.set('WWW-Authenticate', desafio);
  enviarErro(res, 401, mensagem);
}

// Middleware exigirToken: só deixa seguir pedidos com um token válido.
export function criarExigirToken(segredo) {
  return (req, res, next) => {
    // O esquema é insensível a maiúsculas (RFC 9110); o token não tem espaços.
    const correspondencia = /^Bearer ([^\s]+)$/i.exec(req.get('Authorization') ?? '');
    if (!correspondencia) {
      return naoAutenticado(res, 'Bearer', 'É necessário um token de autenticação.');
    }

    let payload;
    try {
      // algorithms: só HS256 (rejeita "none" e qualquer outro algoritmo do cabeçalho).
      // A expiração (exp) é verificada por omissão: não se passa ignoreExpiration.
      payload = jwt.verify(correspondencia[1], segredo, { algorithms: [ALGORITMO] });
    } catch {
      return naoAutenticado(res, 'Bearer error="invalid_token"', 'Token inválido ou expirado.');
    }

    req.utilizador = { sub: payload.sub, nome: payload.nome, papel: payload.papel };
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
