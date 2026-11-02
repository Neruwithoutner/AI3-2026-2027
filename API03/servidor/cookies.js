
export function lerCookie(req, nome) {
  const cabecalho = req.get('Cookie');
  if (!cabecalho) return undefined;

  for (const par of cabecalho.split(';')) {
    const posicao = par.indexOf('=');
    if (posicao === -1) continue;
    if (par.slice(0, posicao).trim() !== nome) continue;

    const valor = par.slice(posicao + 1).trim();
    try {
      return decodeURIComponent(valor);
    } catch {
      return valor;
    }
  }
  return undefined;
}
