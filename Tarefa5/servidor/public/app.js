// Cliente da API de Sugestões (v2): obtém, conserva e envia o token.
// O token fica apenas nesta variável do módulo (não em localStorage nem em sessionStorage):
// perde-se ao recarregar ou fechar a página.
let token = null;
let limiteSessao = 0;     // instante (ms, relógio local) em que o token expira
let temporizador = null;

const MENSAGEM_EXPIRADA = 'Sessão expirada. É necessária nova autenticação.';

const $ = (id) => document.getElementById(id);
const formulario = $('formulario-entrada');
const campoUtilizador = $('utilizador');
const campoPalavraPasse = $('palavraPasse');
const areaEntrada = $('entrada');
const areaSessao = $('sessao');
const zonaMensagens = $('mensagens');
const botaoSugestoes = $('botao-sugestoes');
const botaoSair = $('botao-sair');
const lista = $('lista-sugestoes');

// ---------- Mensagens ----------

function mostrarErro(texto) {
  zonaMensagens.textContent = `Erro: ${texto}`;
  zonaMensagens.classList.add('erro');
}

function limparMensagem() {
  zonaMensagens.textContent = '';
  zonaMensagens.classList.remove('erro');
}

// ---------- Payload ----------

// Devolve o payload do JWT como objeto. Não verifica a assinatura (o cliente não tem
// o segredo): o resultado serve apenas para a interface.
export function descodificarPayload(jwt) {
  const parte = jwt.split('.')[1];
  let base64 = parte.replace(/-/g, '+').replace(/_/g, '/');   // base64url → base64
  base64 += '='.repeat((4 - (base64.length % 4)) % 4);        // repor o preenchimento
  const binario = atob(base64);                               // uma "letra" por byte
  const bytes = Uint8Array.from(binario, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder('utf-8').decode(bytes));  // bytes → texto UTF-8
}

// ---------- Sessão ----------

function formatarRestante(ms) {
  const segundos = Math.max(0, Math.ceil(ms / 1000));
  const m = String(Math.floor(segundos / 60)).padStart(2, '0');
  const s = String(segundos % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function atualizarRestante() {
  const restante = limiteSessao - Date.now();
  $('sessao-restante').textContent = formatarRestante(restante);
  if (restante <= 0) terminarSessao(MENSAGEM_EXPIRADA);
}

function iniciarSessao(resposta) {
  token = resposta.token;
  // expiraEm é relativo à emissão: não depende de o relógio local coincidir com o do servidor.
  limiteSessao = Date.now() + resposta.expiraEm * 1000;

  const payload = descodificarPayload(token);
  $('sessao-nome').textContent = payload.nome;
  $('sessao-papel').textContent = payload.papel === 'servicos' ? 'Serviços' : 'Aluno';
  $('sessao-expiracao').textContent = new Date(payload.exp * 1000).toLocaleTimeString('pt-PT');
  botaoSugestoes.textContent = payload.papel === 'servicos' ? 'Todas as sugestões' : 'As minhas sugestões';

  lista.replaceChildren();
  areaEntrada.hidden = true;
  areaSessao.hidden = false;
  atualizarRestante();
  temporizador = setInterval(atualizarRestante, 1000);
  botaoSugestoes.focus();
}

function terminarSessao(mensagem) {
  token = null;
  limiteSessao = 0;
  clearInterval(temporizador);
  temporizador = null;

  lista.replaceChildren();
  formulario.reset();
  areaSessao.hidden = true;
  areaEntrada.hidden = false;
  if (mensagem) mostrarErro(mensagem); else limparMensagem();
  campoUtilizador.focus();
}

// ---------- Pedidos ----------

async function lerMensagemErro(resposta) {
  try {
    const corpo = await resposta.json();
    if (corpo && typeof corpo.mensagem === 'string') return corpo.mensagem;
  } catch { /* corpo não é JSON */ }
  return `O servidor respondeu ${resposta.status}.`;
}

async function entrar(evento) {
  evento.preventDefault();
  limparMensagem();

  let resposta;
  try {
    resposta = await fetch('/v2/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        utilizador: campoUtilizador.value.trim(),
        palavraPasse: campoPalavraPasse.value
      })
    });
  } catch {
    mostrarErro('Não foi possível contactar o servidor. Verifique a ligação e tente novamente.');
    return;
  }

  if (resposta.status === 200) {
    const corpo = await resposta.json();
    campoPalavraPasse.value = '';
    iniciarSessao(corpo);
  } else {
    // 400 e 401: mostra a mensagem do Erro, sem distinguir utilizador inexistente de palavra-passe errada.
    mostrarErro(await lerMensagemErro(resposta));
  }
}

// GET com Authorization: Bearer; perante um 401, termina a sessão.
async function pedidoAutenticado(url) {
  const tokenUsado = token;
  const resposta = await fetch(url, { headers: { Authorization: `Bearer ${tokenUsado}` } });
  if (token !== tokenUsado) return null;          // a sessão terminou durante o pedido
  if (resposta.status === 401) {
    terminarSessao(MENSAGEM_EXPIRADA);
    return null;
  }
  return resposta;
}

function mostrarSugestoes(itens) {
  lista.replaceChildren();
  if (itens.length === 0) {
    const vazio = document.createElement('li');
    vazio.textContent = 'Não há sugestões.';
    lista.append(vazio);
    return;
  }
  for (const sugestao of itens) {
    const item = document.createElement('li');
    const titulo = document.createElement('strong');
    titulo.textContent = sugestao.titulo;
    const detalhes = document.createElement('span');
    detalhes.className = 'detalhes';
    detalhes.textContent = `Categoria: ${sugestao.categoria} · Estado: ${sugestao.estado}`;
    item.append(titulo, detalhes);
    lista.append(item);
  }
}

async function carregarSugestoes() {
  limparMensagem();
  let resposta;
  try {
    resposta = await pedidoAutenticado('/v2/sugestoes');
  } catch {
    mostrarErro('Não foi possível contactar o servidor. Verifique a ligação e tente novamente.');
    return;
  }
  if (!resposta) return;
  if (!resposta.ok) {
    mostrarErro(await lerMensagemErro(resposta));
    return;
  }
  const corpo = await resposta.json();
  mostrarSugestoes(corpo.itens);
}

// ---------- Eventos ----------

formulario.addEventListener('submit', entrar);
botaoSugestoes.addEventListener('click', carregarSugestoes);
botaoSair.addEventListener('click', () => terminarSessao());
