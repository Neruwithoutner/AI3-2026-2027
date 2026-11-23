// Reporta · formulário de comunicação (sprint 1: provisório).
// Sprint 2: categoria, descrição (10 a 500 caracteres), fotografia reduzida num canvas até 300 KB,
// localização com navigator.geolocation (enableHighAccuracy) e precisão, e as candidatas de
// GET /v1/ocorrencias/semelhantes com os botões «É esta» e «É outra».

export function iniciarFormulario(formulario) {
  console.info('[formulario] por implementar (sprint 2)', formulario?.id);
}

// Reduz a fotografia até caber em `maximoBytes`. Devolve um Blob JPEG.
export async function reduzirFotografia(ficheiro, maximoBytes = 300 * 1024) {
  throw new Error('reduzirFotografia: por implementar (sprint 2)');
}

// Obtém a localização atual: { lat, lng, precisao }.
export async function obterLocalizacao() {
  throw new Error('obterLocalizacao: por implementar (sprint 2)');
}

// Pede as ocorrências semelhantes (timeout de 3 s). Devolve as candidatas.
export async function procurarSemelhantes(categoria, localizacao) {
  throw new Error('procurarSemelhantes: por implementar (sprint 2)');
}
