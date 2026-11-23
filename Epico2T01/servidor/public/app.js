// Reporta · página (sprint 1).
// Neste sprint: regista o service worker e mostra o estado da ligação.
// Sprint 2: identificador do cidadão, lista «As minhas comunicações», pedirSync() e plano B.

import { iniciarFormulario } from './formulario.js';

const estadoSw = document.getElementById('estado-sw');
const estadoLigacao = document.getElementById('estado-ligacao');

// ---------- Service worker ----------
// sw.js fica na raiz para o seu âmbito (scope) cobrir toda a aplicação.
async function registarServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    estadoSw.textContent = 'não suportado neste browser';
    return;
  }
  try {
    const registo = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    console.info('[app] service worker registado, âmbito', registo.scope);
    await navigator.serviceWorker.ready;
    estadoSw.textContent = 'ativo';
  } catch (erro) {
    console.error('[app] falha ao registar o service worker:', erro);
    estadoSw.textContent = 'falhou o registo';
  }
}

// ---------- Estado da ligação ----------
// navigator.onLine só diz que há uma interface de rede ativa; serve aqui apenas como indicação.
function mostrarLigacao() {
  const comRede = navigator.onLine;
  estadoLigacao.textContent = comRede ? 'Com rede' : 'Sem rede';
  estadoLigacao.classList.toggle('com-rede', comRede);
  estadoLigacao.classList.toggle('sem-rede', !comRede);
}

// ---------- Provisórias (sprint 2) ----------
// Pede ao service worker uma sincronização (evento sync ou, no plano B, postMessage).
export async function pedirSync() {
  console.info('[app] pedirSync(): por implementar (sprint 2)');
}

// Tempo de espera, em milissegundos, depois de `falhas` falhas seguidas (1, 2, 3…). Anexo do enunciado.
export function tempoDeEspera(falhas) {
  const segundos = [1, 2, 4, 8, 16, 32, 60];
  const base = segundos[Math.min(falhas, segundos.length) - 1];
  const variacao = 0.7 + Math.random() * 0.6;   // entre 70 % e 130 % do valor base
  return Math.round(base * variacao * 1000);
}

// ---------- Arranque ----------
window.addEventListener('online', mostrarLigacao);
window.addEventListener('offline', mostrarLigacao);
mostrarLigacao();
iniciarFormulario(document.getElementById('formulario'));
registarServiceWorker();
