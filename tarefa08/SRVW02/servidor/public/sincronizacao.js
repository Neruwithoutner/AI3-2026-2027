// Sincronização nos dois sentidos, executada pelo service worker (importScripts('/sincronizacao.js')).
// Script clássico; usa self.bd (bd.js). Não lê o cookie: o browser junta-o aos pedidos.
//
//   1. push: envia a fila de saída (pendentes), uma de cada vez, com Idempotency-Key;
//   2. pull: pede GET /v2/sugestoes/alteracoes?desde=<cursor> e aplica o resultado.
//
// Resultado: { tipo: 'sincronizado', enviadas, recusadas, recebidas, porEnviar }
//         ou { tipo: 'sessao-expirada', porEnviar }.
// Falhas a repetir mais tarde: lança um erro com tipo 'sem-rede' ou 'erro-servidor'.

function erroSincronizacao(tipo, mensagem, porEnviar) {
  return Object.assign(new Error(mensagem), { tipo, porEnviar });
}

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

async function executarSincronizacao() {
  const bd = self.bd;

  // Sem proprietário, ou com a sessão já expirada: não faz pedidos.
  const proprietario = await bd.lerProprietario();
  if (!proprietario) return { tipo: 'sessao-expirada', porEnviar: 0 };
  const utilizador = proprietario.utilizador;
  if (Date.parse(proprietario.expiracao) <= Date.now()) {
    return { tipo: 'sessao-expirada', porEnviar: await bd.contarPendentes(utilizador) };
  }

  // ---------- Push: fila de saída ----------
  let enviadas = 0;
  let recusadas = 0;
  const pendentes = await bd.lerPendentesDe(utilizador);

  for (const pendente of pendentes) {
    await bd.registarTentativa(pendente.idLocal);

    let resposta;
    try {
      resposta = await fetch('/v2/sugestoes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': pendente.chave
        },
        // Só os campos de SugestaoNova: o numeroAluno vem do token.
        body: JSON.stringify({
          titulo: pendente.titulo,
          descricao: pendente.descricao,
          categoria: pendente.categoria
        })
      });
    } catch {
      // Sem rede, ou resposta perdida: a pendente fica, com a mesma chave.
      throw erroSincronizacao('sem-rede', 'Sem ligação ao servidor.', await bd.contarPendentes(utilizador));
    }

    if (resposta.status === 201) {
      // Criada agora, ou repetição reconhecida (Idempotent-Replayed: true).
      await bd.confirmarPendente(pendente.idLocal, await resposta.json());
      enviadas++;
    } else if (resposta.status === 400 || resposta.status === 409) {
      // O pedido está errado: repeti-lo não adianta. Marca e passa à seguinte.
      await bd.marcarErro(pendente.idLocal, await mensagemDoErro(resposta));
      recusadas++;
    } else if (resposta.status === 401) {
      return { tipo: 'sessao-expirada', porEnviar: await bd.contarPendentes(utilizador), enviadas, recusadas };
    } else if (resposta.status >= 500) {
      throw erroSincronizacao('erro-servidor', `O servidor respondeu ${resposta.status}.`, await bd.contarPendentes(utilizador));
    } else {
      // Outro 4xx (por exemplo 403): também não adianta repetir.
      await bd.marcarErro(pendente.idLocal, await mensagemDoErro(resposta));
      recusadas++;
    }
  }

  // ---------- Pull: o que mudou no servidor ----------
  const desde = await bd.lerCursor(utilizador);
  let resposta;
  try {
    resposta = await fetch(`/v2/sugestoes/alteracoes?desde=${encodeURIComponent(desde)}`);
  } catch {
    throw erroSincronizacao('sem-rede', 'Sem ligação ao servidor.', await bd.contarPendentes(utilizador));
  }
  if (resposta.status === 401) {
    return { tipo: 'sessao-expirada', porEnviar: await bd.contarPendentes(utilizador), enviadas, recusadas };
  }
  if (!resposta.ok) {
    throw erroSincronizacao('erro-servidor', `O servidor respondeu ${resposta.status}.`, await bd.contarPendentes(utilizador));
  }
  const { alteracoes, cursor } = await resposta.json();
  // Alterações e novo cursor na mesma transação.
  const recebidas = await bd.aplicarAlteracoes(utilizador, alteracoes, cursor);

  return {
    tipo: 'sincronizado',
    enviadas,
    recusadas,
    recebidas,
    porEnviar: await bd.contarPendentes(utilizador)
  };
}
