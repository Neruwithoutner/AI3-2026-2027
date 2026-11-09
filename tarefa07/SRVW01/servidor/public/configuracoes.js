// Configurações da interface, guardadas no localStorage (chave «configuracoes»).
// O utilizador pode alterar este valor nas ferramentas de programador, por isso
// tudo o que se lê é validado.

const CHAVE = 'configuracoes';

// Valores permitidos (o primeiro de cada lista é o valor por omissão).
export const VALORES = {
  tema: ['claro', 'escuro'],
  ordenacao: ['recentes', 'estado']
};

export const POR_OMISSAO = { tema: 'claro', ordenacao: 'recentes' };

function validas(objeto) {
  return objeto !== null
    && typeof objeto === 'object'
    && !Array.isArray(objeto)
    && VALORES.tema.includes(objeto.tema)
    && VALORES.ordenacao.includes(objeto.ordenacao);
}

// Lê as configurações. Se não existirem, não forem JSON válido ou tiverem valores
// fora da tabela, devolve os valores por omissão.
export function lerConfiguracoes() {
  try {
    const texto = localStorage.getItem(CHAVE);
    if (texto === null) return { ...POR_OMISSAO };
    const objeto = JSON.parse(texto);
    if (!validas(objeto)) return { ...POR_OMISSAO };
    return { tema: objeto.tema, ordenacao: objeto.ordenacao };
  } catch {
    // JSON inválido, ou localStorage indisponível (por exemplo, bloqueado pelo browser)
    return { ...POR_OMISSAO };
  }
}

// Guarda as configurações no localStorage.
export function guardarConfiguracoes(configuracoes) {
  try {
    localStorage.setItem(CHAVE, JSON.stringify({
      tema: configuracoes.tema,
      ordenacao: configuracoes.ordenacao
    }));
  } catch {
    // Sem localStorage, a configuração vale só até recarregar a página.
  }
}
