// Idempotência de POST /v2/sugestoes (cabeçalho Idempotency-Key).
// As chaves ficam em memória, indexadas por utilizador (numeroAluno) e chave, durante 24 horas.

export const PADRAO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALIDADE_MS = 24 * 60 * 60 * 1000;

// Map<numeroAluno, Map<chave, registo>>
const porUtilizador = new Map();

// JSON com as propriedades ordenadas, para comparar corpos sem depender da ordem das chaves.
export function jsonCanonico(valor) {
  if (Array.isArray(valor)) return `[${valor.map(jsonCanonico).join(',')}]`;
  if (valor !== null && typeof valor === 'object') {
    return `{${Object.keys(valor).sort().map((k) => `${JSON.stringify(k)}:${jsonCanonico(valor[k])}`).join(',')}}`;
  }
  return JSON.stringify(valor);
}

function apagarExpiradas(agora) {
  for (const [utilizador, chaves] of porUtilizador) {
    for (const [chave, registo] of chaves) {
      if (registo.expiraEm <= agora) chaves.delete(chave);
    }
    if (chaves.size === 0) porUtilizador.delete(utilizador);
  }
}

// Devolve o registo guardado para (utilizador, chave), ou null.
export function procurarChave(utilizador, chave) {
  apagarExpiradas(Date.now());
  return porUtilizador.get(utilizador)?.get(chave.toLowerCase()) ?? null;
}

// Guarda a resposta dada a (utilizador, chave). Só é chamada depois de a sugestão ser criada.
export function guardarChave(utilizador, chave, { corpo, codigo, location, resposta }) {
  if (!porUtilizador.has(utilizador)) porUtilizador.set(utilizador, new Map());
  porUtilizador.get(utilizador).set(chave.toLowerCase(), {
    corpo: jsonCanonico(corpo),
    codigo,
    location,
    resposta,
    expiraEm: Date.now() + VALIDADE_MS
  });
}
