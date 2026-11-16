// Leitura de cookies sem cookie-parser.
// O cabeçalho Cookie tem a forma: nome1=valor1; nome2=valor2

// Devolve o valor do cookie `nome`, ou undefined se o pedido não o tiver.
export function lerCookie(req, nome) {
  const cabecalho = req.get('Cookie');
  if (!cabecalho) return undefined;

  for (const par of cabecalho.split(';')) {
    const posicao = par.indexOf('=');
    if (posicao === -1) continue;
    if (par.slice(0, posicao).trim() !== nome) continue;

    const valor = par.slice(posicao + 1).trim();
    // O Express (res.cookie) codifica o valor com encodeURIComponent.
    try {
      return decodeURIComponent(valor);
    } catch {
      return valor;
    }
  }
  return undefined;
}
