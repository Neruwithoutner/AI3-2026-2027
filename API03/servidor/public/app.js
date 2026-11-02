// Cliente da API de Sugestões (v2.1.0).
// O token está num cookie HttpOnly: este código não o lê nem o envia. O browser envia-o
// sozinho nos pedidos a /v2. Para saber quem está autenticado, pede GET /v2/sessao.
//   cookie          → token de autenticação (gerido pelo servidor e pelo browser)
//   localStorage    → configurações da interface (configuracoes.js)
//   sessionStorage  → rascunho da nova sugestão (chave rascunhoSugestao)
import { lerConfiguracoes, guardarConfiguracoes } from './configuracoes.js';

const MENSAGEM_EXPIRADA = 'Sessão expirada. É necessária nova autenticação.';
const MENSAGEM_REDE = 'Não foi possível contactar o servidor. Verifique a ligação e tente novamente.';
const CHAVE_RASCUNHO = 'rascunhoSugestao';
const ORDEM_ESTADOS = ['submetida', 'em_analise', 'aceite', 'rejeitada', 'resolvida'];

let sessaoAtual = null;      // corpo Sessao devolvido pelo servidor
let limiteSessao = 0;        // instante (ms) em que o cookie e o token expiram
let temporizador = null;
let ultimasSugestoes = null; // última lista recebida, para reordenar sem novo pedido
let configuracoes = lerConfiguracoes();

const $ = (id) => document.getElementById(id);
const zonaMensagens = $('mensagens');
const zonaEstado = $('estado');
const aVerificar = $('a-verificar');
const areaEntrada = $('entrada');
const areaSessao = $('sessao');
const formularioEntrada = $('formulario-entrada');
const campoUtilizador = $('utilizador');
const campoPalavraPasse = $('palavraPasse');
const opcaoTema = $('opcao-tema');
const opcaoOrdenacao = $('opcao-ordenacao');
const areaNovaSugestao = $('nova-sugestao');
const formularioSugestao = $('formulario-sugestao');
const botaoSugestoes = $('botao-sugestoes');
const botaoSair = $('botao-sair');
const lista = $('lista-sugestoes');

// ---------- Mensagens ----------

function mostrarErro(texto) {
  zonaEstado.textContent = '';
  zonaMensagens.textContent = `Erro: ${texto}`;
  zonaMensagens.classList.add('erro');
}

function mostrarSucesso(texto) {
  limparMensagens();
  zonaEstado.textContent = `Feito: ${texto}`;
}

function limparMensagens() {
  zonaMensagens.textContent = '';
  zonaMensagens.classList.remove('erro');
  zonaEstado.textContent = '';
}

async function lerMensagemErro(resposta) {
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

// ---------- Configurações (localStorage) ----------

function aplicarConfiguracoes() {
  document.documentElement.dataset.tema = configuracoes.tema;
  opcaoTema.value = configuracoes.tema;
  opcaoOrdenacao.value = configuracoes.ordenacao;
  if (ultimasSugestoes) mostrarSugestoes(ultimasSugestoes);
}

function alterarConfiguracoes() {
  configuracoes = { tema: opcaoTema.value, ordenacao: opcaoOrdenacao.value };
  aplicarConfiguracoes();           // aplicada de imediato…
  guardarConfiguracoes(configuracoes); // …e guardada
}

// ---------- Rascunho (sessionStorage) ----------

function lerRascunho() {
  try {
    const objeto = JSON.parse(sessionStorage.getItem(CHAVE_RASCUNHO));
    if (objeto === null || typeof objeto !== 'object') return null;
    const texto = (v) => (typeof v === 'string' ? v : '');
    return { titulo: texto(objeto.titulo), descricao: texto(objeto.descricao), categoria: texto(objeto.categoria) };
  } catch {
    return null;
  }
}

function guardarRascunho() {
  const dados = new FormData(formularioSugestao);
  const rascunho = {
    titulo: dados.get('titulo'),
    descricao: dados.get('descricao'),
    categoria: dados.get('categoria')
  };
  try {
    if (!rascunho.titulo && !rascunho.descricao && !rascunho.categoria) {
      sessionStorage.removeItem(CHAVE_RASCUNHO);
    } else {
      sessionStorage.setItem(CHAVE_RASCUNHO, JSON.stringify(rascunho));
    }
  } catch { /* sem sessionStorage, o rascunho não é guardado */ }
}

function reporRascunho() {
  const rascunho = lerRascunho();
  formularioSugestao.reset();
  if (!rascunho) return;
  formularioSugestao.elements.titulo.value = rascunho.titulo;
  formularioSugestao.elements.descricao.value = rascunho.descricao;
  // Só repõe uma categoria que exista na lista.
  const categoria = formularioSugestao.elements.categoria;
  if ([...categoria.options].some((o) => o.value === rascunho.categoria)) categoria.value = rascunho.categoria;
}

function apagarRascunho() {
  try { sessionStorage.removeItem(CHAVE_RASCUNHO); } catch { /* nada a apagar */ }
  formularioSugestao.reset();
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
  // O cookie expira ao mesmo tempo (Max-Age): termina sem esperar por um pedido.
  if (restante <= 0) terminarSessaoLocal(MENSAGEM_EXPIRADA);
}

function mostrarEntrada() {
  aVerificar.hidden = true;
  areaSessao.hidden = true;
  areaEntrada.hidden = false;
}

function mostrarSessao(sessao) {
  sessaoAtual = sessao;
  limiteSessao = Date.parse(sessao.expiracao);
  const servicos = sessao.papel === 'servicos';

  $('sessao-nome').textContent = sessao.nome;
  $('sessao-papel').textContent = servicos ? 'Serviços' : 'Aluno';
  $('sessao-expiracao').textContent = new Date(limiteSessao).toLocaleTimeString('pt-PT');
  botaoSugestoes.textContent = servicos ? 'Todas as sugestões' : 'As minhas sugestões';

  // O formulário «Nova sugestão» só existe para alunos; ao aparecer, repõe o rascunho.
  areaNovaSugestao.hidden = servicos;
  if (!servicos) reporRascunho();

  ultimasSugestoes = null;
  lista.replaceChildren();
  aVerificar.hidden = true;
  areaEntrada.hidden = true;
  areaSessao.hidden = false;

  clearInterval(temporizador);
  atualizarRestante();
  temporizador = setInterval(atualizarRestante, 1000);
}

// Termina a sessão na página: apaga o rascunho e volta ao formulário de entrada.
function terminarSessaoLocal(mensagem) {
  sessaoAtual = null;
  limiteSessao = 0;
  clearInterval(temporizador);
  temporizador = null;
  ultimasSugestoes = null;

  apagarRascunho();
  lista.replaceChildren();
  formularioEntrada.reset();
  mostrarEntrada();
  if (mensagem) mostrarErro(mensagem); else limparMensagens();
  campoUtilizador.focus();
}

// Ao abrir a página: o cookie (se existir) é enviado pelo browser.
async function verificarSessao() {
  let resposta;
  try {
    resposta = await fetch('/v2/sessao');
  } catch {
    mostrarEntrada();
    mostrarErro(MENSAGEM_REDE);
    return;
  }
  if (resposta.status === 200) {
    mostrarSessao(await resposta.json());
  } else {
    // 401: sem cookie, ou cookie com token inválido/expirado. Um rascunho que tenha
    // ficado neste separador pertencia a uma sessão que já terminou.
    apagarRascunho();
    mostrarEntrada();
  }
}

async function entrar(evento) {
  evento.preventDefault();
  limparMensagens();

  let resposta;
  try {
    resposta = await fetch('/v2/sessao', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        utilizador: campoUtilizador.value.trim(),
        palavraPasse: campoPalavraPasse.value
      })
    });
  } catch {
    mostrarErro(MENSAGEM_REDE);
    return;
  }

  if (resposta.status === 200) {
    campoPalavraPasse.value = '';
    mostrarSessao(await resposta.json());
    botaoSugestoes.focus();
  } else {
    // 400 e 401: mostra a mensagem do Erro, sem distinguir utilizador inexistente de palavra-passe errada.
    mostrarErro(await lerMensagemErro(resposta));
  }
}

async function sair() {
  try {
    await fetch('/v2/sessao', { method: 'DELETE' });
    terminarSessaoLocal();
  } catch {
    terminarSessaoLocal();
    mostrarErro('Não foi possível contactar o servidor: o cookie de sessão pode não ter sido apagado.');
  }
}

// ---------- Pedidos protegidos ----------

// Faz um pedido a uma operação protegida (o cookie segue sozinho).
// Perante um 401, termina a sessão na página.
async function pedidoAutenticado(url, opcoes = {}) {
  const resposta = await fetch(url, opcoes);
  if (resposta.status === 401) {
    terminarSessaoLocal(MENSAGEM_EXPIRADA);
    return null;
  }
  return resposta;
}

function ordenar(itens) {
  const porData = (a, b) => b.dataCriacao.localeCompare(a.dataCriacao);
  const copia = [...itens];
  if (configuracoes.ordenacao === 'estado') {
    return copia.sort((a, b) =>
      (ORDEM_ESTADOS.indexOf(a.estado) - ORDEM_ESTADOS.indexOf(b.estado)) || porData(a, b));
  }
  return copia.sort(porData);
}

function mostrarSugestoes(itens) {
  lista.replaceChildren();
  if (itens.length === 0) {
    const vazio = document.createElement('li');
    vazio.textContent = 'Não há sugestões.';
    lista.append(vazio);
    return;
  }
  for (const sugestao of ordenar(itens)) {
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
  let resposta;
  try {
    resposta = await pedidoAutenticado('/v2/sugestoes');
  } catch {
    mostrarErro(MENSAGEM_REDE);
    return;
  }
  if (!resposta) return;
  if (!resposta.ok) {
    mostrarErro(await lerMensagemErro(resposta));
    return;
  }
  ultimasSugestoes = (await resposta.json()).itens;
  mostrarSugestoes(ultimasSugestoes);
}

async function submeterSugestao(evento) {
  evento.preventDefault();
  limparMensagens();
  const dados = new FormData(formularioSugestao);

  let resposta;
  try {
    resposta = await pedidoAutenticado('/v2/sugestoes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        titulo: dados.get('titulo'),
        descricao: dados.get('descricao'),
        categoria: dados.get('categoria')
      })
    });
  } catch {
    mostrarErro(MENSAGEM_REDE); // o rascunho fica guardado
    return;
  }
  if (!resposta) return;

  if (resposta.status === 201) {
    const criada = await resposta.json();
    apagarRascunho();
    mostrarSucesso(`sugestão «${criada.titulo}» submetida.`);
    if (ultimasSugestoes) carregarSugestoes();
  } else {
    mostrarErro(await lerMensagemErro(resposta)); // o rascunho fica guardado
  }
}

// ---------- Arranque ----------

aplicarConfiguracoes();
opcaoTema.addEventListener('change', alterarConfiguracoes);
opcaoOrdenacao.addEventListener('change', alterarConfiguracoes);

formularioEntrada.addEventListener('submit', entrar);
formularioSugestao.addEventListener('input', guardarRascunho);
formularioSugestao.addEventListener('change', guardarRascunho);
formularioSugestao.addEventListener('submit', submeterSugestao);
botaoSugestoes.addEventListener('click', () => { limparMensagens(); carregarSugestoes(); });
botaoSair.addEventListener('click', sair);

verificarSessao();
