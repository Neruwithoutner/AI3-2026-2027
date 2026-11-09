// Envio das sugestões pendentes (criadas sem ligação) para POST /v2/sugestoes.
// Não muda o estado da interface: devolve o resultado e é o app.js que decide.
import { lerPendentes, confirmarPendente, marcarErro } from './bd.js';

let aDecorrer = false;

async function mensagemDoErro(resposta) {
  try {
    const corpo = await resposta.json();
    if (corpo && typeof corpo.mensagem === 'string') {
      const detalhes = Array.isArray(corpo.detalhes)
        ? corpo.detalhes.map((d) => `${d.campo} ${d.problema}`).join('; ')
        : '';
      return detalhes ? `${corpo.mensagem} (${detalhes})` : corpo.mensagem;
    }
  } catch { /* corpo não é JSON */ }
  return `O servidor respondeu ${resposta.status}.`;
}

// Envia, pela ordem de criação, as pendentes de `utilizador` que não têm erro.
// Resultado: { estado, enviadas, comErro, porEnviar }, com estado
//   'concluido'   — todas as que podiam ser enviadas foram tratadas;
//   'sem-sessao'  — 401: parou e manteve todas;
//   'sem-ligacao' — fetch rejeitado: parou e manteve todas;
//   'erro-servidor' — 5xx: parou e manteve todas, para tentar mais tarde;
//   'ignorado'    — já havia um envio a decorrer.
export async function enviarPendentes(utilizador) {
  if (aDecorrer) return { estado: 'ignorado', enviadas: 0, comErro: 0, porEnviar: 0 };
  aDecorrer = true;

  let enviadas = 0;
  let comErro = 0;
  const contarRestantes = async () =>
    (await lerPendentes()).filter((p) => p.utilizador === utilizador).length;

  try {
    const minhas = (await lerPendentes())
      .filter((p) => p.utilizador === utilizador && p.erro === null)
      .sort((a, b) => a.idLocal - b.idLocal);

    for (const pendente of minhas) {
      let resposta;
      try {
        resposta = await fetch('/v2/sugestoes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // Só os campos de SugestaoNova: o numeroAluno vem do token.
          body: JSON.stringify({
            titulo: pendente.titulo,
            descricao: pendente.descricao,
            categoria: pendente.categoria
          })
        });
      } catch {
        return { estado: 'sem-ligacao', enviadas, comErro, porEnviar: await contarRestantes() };
      }

      if (resposta.status === 201) {
        await confirmarPendente(pendente.idLocal, await resposta.json());
        enviadas++;
      } else if (resposta.status === 401) {
        return { estado: 'sem-sessao', enviadas, comErro, porEnviar: await contarRestantes() };
      } else if (resposta.status >= 500) {
        return { estado: 'erro-servidor', enviadas, comErro, porEnviar: await contarRestantes() };
      } else {
        // 400 (e outro 4xx): esta pendente não será aceite tal como está; passa à seguinte.
        await marcarErro(pendente.idLocal, await mensagemDoErro(resposta));
        comErro++;
      }
    }
    return { estado: 'concluido', enviadas, comErro, porEnviar: await contarRestantes() };
  } finally {
    aDecorrer = false;
  }
}
