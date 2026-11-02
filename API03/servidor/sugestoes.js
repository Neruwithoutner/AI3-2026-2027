// Validação e criação de sugestões (POST /v2/sugestoes). As novas sugestões ficam só em memória.

const CATEGORIAS = ['instalacoes', 'ensino', 'servicos', 'atividades', 'outra'];

// Verifica o corpo contra o schema SugestaoNova; devolve um elemento por campo inválido.
// Propriedades não declaradas (por exemplo numeroAluno) são aceites e ignoradas.
export function validarSugestaoNova(corpo) {
  if (corpo === null || typeof corpo !== 'object' || Array.isArray(corpo)) {
    return [{ campo: '(corpo)', problema: 'tem de ser um objeto JSON com titulo, descricao e categoria' }];
  }
  const detalhes = [];
  const texto = (campo, min, max) => {
    const valor = corpo[campo];
    if (valor === undefined) detalhes.push({ campo, problema: 'é obrigatório' });
    else if (typeof valor !== 'string') detalhes.push({ campo, problema: 'tem de ser uma string' });
    else if (valor.length < min || valor.length > max) detalhes.push({ campo, problema: `tem de ter entre ${min} e ${max} caracteres` });
  };
  texto('titulo', 10, 120);
  texto('descricao', 20, 2000);
  if (corpo.categoria === undefined) detalhes.push({ campo: 'categoria', problema: 'é obrigatória' });
  else if (!CATEGORIAS.includes(corpo.categoria)) detalhes.push({ campo: 'categoria', problema: `tem de ser uma de: ${CATEGORIAS.join(', ')}` });
  return detalhes;
}

// Cria a sugestão com o numeroAluno do token (nunca o do corpo).
export function criarSugestao(sugestoes, corpo, numeroAluno) {
  const agora = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const id = sugestoes.reduce((maior, s) => Math.max(maior, s.id), 0) + 1;
  const sugestao = {
    id,
    titulo: corpo.titulo,
    descricao: corpo.descricao,
    categoria: corpo.categoria,
    numeroAluno,
    estado: 'submetida',
    dataCriacao: agora,
    dataAtualizacao: agora,
    dataResolucao: null
  };
  sugestoes.push(sugestao);
  return sugestao;
}
