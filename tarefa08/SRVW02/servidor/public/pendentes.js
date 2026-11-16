// Página: pedir a sincronização ao service worker e, sem Background Sync, voltar a pedir
// com espera crescente (plano B). Quem envia as pendentes é o service worker (sincronizacao.js).

export const ETIQUETA_SYNC = 'sincronizar-sugestoes';

let ultimoMeio = null;     // 'sync' (Background Sync) ou 'mensagem' (plano B)
let falhasSeguidas = 0;    // k, no cálculo da espera
let agendamento = null;    // só existe um agendamento de cada vez

// Pede uma sincronização: com Background Sync, o browser dispara o evento sync quando houver
// ligação (mesmo com o separador fechado); sem ele, pede-a já por mensagem.
export async function pedirSync() {
  if (!('serviceWorker' in navigator)) return null;
  const registo = await navigator.serviceWorker.ready;
  if ('sync' in registo) {
    try {
      await registo.sync.register(ETIQUETA_SYNC);
      ultimoMeio = 'sync';
      return ultimoMeio;
    } catch {
      // permissão recusada: segue para o plano B
    }
  }
  registo.active?.postMessage({ tipo: 'sincronizar' });
  ultimoMeio = 'mensagem';
  return ultimoMeio;
}

// Espera do plano B, em segundos: min(60, 2^k) × (0,7 + 0,6 × aleatório).
export function esperaPlanoB(k) {
  return Math.min(60, 2 ** k) * (0.7 + 0.6 * Math.random());
}

// Chamada pela página para cada resultado enviado pelo service worker.
// Devolve a espera agendada (segundos), ou null.
export function tratarResultado(resultado) {
  if (resultado.tipo === 'sincronizado') {
    falhasSeguidas = 0;
    if (agendamento) {
      clearTimeout(agendamento);
      agendamento = null;
    }
    return null;
  }

  // Com Background Sync é o browser que volta a tentar; só o plano B agenda.
  const falhaARepetir = resultado.tipo === 'sem-rede' || resultado.tipo === 'erro-servidor';
  if (!falhaARepetir || ultimoMeio !== 'mensagem') return null;

  falhasSeguidas++;
  if (agendamento) return null;
  const segundos = esperaPlanoB(falhasSeguidas);
  console.info(`[plano B] ${resultado.tipo}: falha ${falhasSeguidas}, nova tentativa dentro de ${segundos.toFixed(1)} s`);
  agendamento = setTimeout(() => {
    agendamento = null;
    pedirSync();
  }, segundos * 1000);
  return segundos;
}
