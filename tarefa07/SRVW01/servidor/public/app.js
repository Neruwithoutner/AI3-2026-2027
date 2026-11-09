// Cliente da API de Sugestões.
// A interface está sempre num de quatro estados: a-verificar, sem-sessao, com-sessao, sem-ligacao.
// mudarEstado() é o único sítio onde o estado muda.
//
//   cookie          → token (HttpOnly; o browser envia-o sozinho)
//   localStorage    → configurações (configuracoes.js)
//   sessionStorage  → rascunho da nova sugestão
//   Cache API       → ficheiros da interface e categorias (sw.js)
//   IndexedDB       → cópia local das sugestões e sugestões pendentes (bd.js)
import { lerConfiguracoes, guardarConfiguracoes } from './configuracoes.js';
import * as bd from './bd.js';
import { enviarPendentes } from './pendentes.js';

const ESTADOS = ['a-verificar', 'sem-sessao', 'com-sessao', 'sem-ligacao'];
const MENSAGEM_EXPIRADA = 'A sessão expirou. Entre de novo.';
const MENSAGEM_SEM_LIGACAO_ENTRAR = 'Sem ligação: não é possível entrar.';
const CHAVE_RASCUNHO = 'rascunhoSugestao';

let estadoAtual = null;
let sessaoAtual = null;    // Sessao recebida do servidor (só em com-sessao)
let proprietario = null;   // registo «proprietario» da IndexedDB (dono da cópia local)
let configuracoes = lerConfiguracoes();
let categoriasCarregadas = false;
let registoSW = null;
let atualizacaoPedida = false;
let versaoLista = 0;       // evita que uma leitura antiga substitua uma mais recente

const $ = (id) => document.getElementById(id);
const zonaLigacao = $('ligacao');
const zonaMensagens = $('mensagens');
const zonaEstado = $('estado');
const formularioEntrada = $('formulario-entrada');
const campoUtilizador = $('utilizador');
const campoPalavraPasse = $('palavraPasse');
const botaoEntrar = $('botao-entrar');
const tituloSessao = $('titulo-sessao');
const trabalho = $('trabalho');
const areaNovaSugestao = $('nova-sugestao');
const formularioSugestao = $('formulario-sugestao');
const camposSugestao = $('campos-sugestao');
const seletorCategoria = $('sugestao-categoria');
const avisoSemCategorias = $('sem-categorias');
const listaPendentes = $('lista-pendentes');
const listaSugestoes = $('lista-sugestoes');
const listaInfo = $('lista-info');
const botaoAtualizarLista = $('botao-atualizar-lista');
const botaoSair = $('botao-sair');
const explicacaoSair = $('sair-explicacao');
const copiaLocal = $('copia-local');
const dialogoSair = $('dialogo-sair');
const opcaoTema = $('opcao-tema');
const opcaoOrdenacao = $('opcao-ordenacao');

// ---------- Utilitários ----------

const hora = (iso) => new Date(iso).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
const copiaValida = () => proprietario !== null && Date.parse(proprietario.expiracao) > Date.now();
const papelAtual = () => (sessaoAtual ?? proprietario)?.papel;
const textoPendentes = (n) => (n === 1
  ? 'Há 1 sugestão por enviar. Entre de novo para a enviar.'
  : `Há ${n} sugestões por enviar. Entre de novo para as enviar.`);

function mostrarErro(texto) {
  zonaEstado.textContent = '';
  zonaMensagens.textContent = `Erro: ${texto}`;
  zonaMensagens.classList.add('erro');
}

function mostrarSucesso(texto) {
  zonaMensagens.textContent = '';
  zonaMensagens.classList.remove('erro');
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

function atualizarIndicacaoLigacao(extra) {
  const textos = {
    'a-verificar': 'A verificar a ligação ao servidor…',
    'sem-sessao': 'Ligado ao servidor.',
    'com-sessao': 'Ligado ao servidor.',
    'sem-ligacao': 'Sem ligação ao servidor.'
  };
  zonaLigacao.textContent = extra ?? textos[estadoAtual] ?? '';
}

// ---------- Estados ----------

// Único sítio onde o estado muda.
function mudarEstado(estado, { mensagem } = {}) {
  if (!ESTADOS.includes(estado)) throw new Error(`Estado desconhecido: ${estado}`);
  estadoAtual = estado;
  document.body.dataset.estado = estado;

  for (const area of document.querySelectorAll('[data-area]')) {
    area.hidden = area.dataset.area !== estado;
  }
  if (estado !== 'com-sessao') sessaoAtual = null;

  // «Terminar sessão» precisa do servidor: desativado sem ligação.
  botaoSair.disabled = estado === 'sem-ligacao';
  explicacaoSair.hidden = estado !== 'sem-ligacao';
  botaoAtualizarLista.hidden = estado !== 'com-sessao';

  limparMensagens();
  if (mensagem) mostrarErro(mensagem);
  atualizarIndicacaoLigacao();

  if (estado === 'com-sessao') mostrarDadosSessao();
  atualizarAreaTrabalho();
}

// A lista e o formulário aparecem em com-sessao e, em sem-ligacao, só com cópia local válida.
function atualizarAreaTrabalho() {
  const semLigacaoComCopia = estadoAtual === 'sem-ligacao' && copiaValida();
  trabalho.hidden = !(estadoAtual === 'com-sessao' || semLigacaoComCopia);

  copiaLocal.hidden = !semLigacaoComCopia;
  if (semLigacaoComCopia) {
    $('copia-nome').textContent = proprietario.nome;
    $('copia-hora').textContent = proprietario.atualizadoEm
      ? `Cópia de ${hora(proprietario.atualizadoEm)} — pode estar desatualizada`
      : 'Ainda não há cópia da lista neste browser.';
  }

  if (!trabalho.hidden) {
    const aluno = papelAtual() === 'aluno';
    areaNovaSugestao.hidden = !aluno;
    if (aluno) reporRascunho();
    mostrarLista();
  }
}

function mostrarDadosSessao() {
  $('sessao-nome').textContent = sessaoAtual.nome;
  $('sessao-papel').textContent = sessaoAtual.papel === 'servicos' ? 'Serviços' : 'Aluno';
  $('sessao-expiracao').textContent = new Date(sessaoAtual.expiracao).toLocaleTimeString('pt-PT');
  atualizarTempoRestante();
}

function atualizarTempoRestante() {
  const restante = Math.max(0, Math.ceil((Date.parse(sessaoAtual.expiracao) - Date.now()) / 1000));
  const m = String(Math.floor(restante / 60)).padStart(2, '0');
  const s = String(restante % 60).padStart(2, '0');
  $('sessao-restante').textContent = `${m}:${s}`;
  return restante;
}

// Corre a cada segundo.
function aCadaSegundo() {
  if (estadoAtual === 'com-sessao' && sessaoAtual) {
    if (atualizarTempoRestante() <= 0) {
      // Expirou: não se apagam o rascunho, as pendentes nem a cópia local.
      mudarEstado('sem-sessao', { mensagem: MENSAGEM_EXPIRADA });
      campoUtilizador.focus();
    }
  } else if (estadoAtual === 'sem-ligacao' && !copiaLocal.hidden && !copiaValida()) {
    atualizarAreaTrabalho(); // a última sessão expirou: deixa de mostrar a cópia local
  }
}

// ---------- Sessão ----------

// Chamado sempre que se obtém uma Sessao (arranque, entrar, regresso da ligação).
async function aplicarSessao(sessao) {
  const anterior = await bd.lerProprietario();
  if (anterior && anterior.utilizador !== sessao.utilizador) {
    // A cópia local era de outra pessoa: apaga-a antes de mostrar o que quer que seja.
    await bd.limparBD();
    apagarRascunho();
  }
  proprietario = await bd.guardarProprietario(sessao);
  sessaoAtual = sessao;
  mudarEstado('com-sessao');
  await tentarEnviarPendentes();
  if (estadoAtual === 'com-sessao') await atualizarLista();
}

async function contarPendentesDoProprietario() {
  if (!proprietario) return 0;
  return (await bd.lerPendentes()).filter((p) => p.utilizador === proprietario.utilizador).length;
}

// GET /v2/sessao: 200 → com-sessao; 401 → sem-sessao; fetch rejeitado → sem-ligacao.
async function verificarSessao() {
  let resposta;
  try {
    resposta = await fetch('/v2/sessao');
  } catch {
    mudarEstado('sem-ligacao');
    return;
  }
  if (resposta.status === 200) {
    await aplicarSessao(await resposta.json());
  } else if (resposta.status === 401) {
    const n = await contarPendentesDoProprietario();
    mudarEstado('sem-sessao', n > 0 ? { mensagem: textoPendentes(n) } : {});
  } else {
    mudarEstado('sem-sessao', { mensagem: await lerMensagemErro(resposta) });
  }
}

async function entrar(evento) {
  evento.preventDefault();
  limparMensagens();
  botaoEntrar.disabled = true;
  botaoEntrar.textContent = 'A entrar…';

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
    mudarEstado('sem-ligacao', { mensagem: MENSAGEM_SEM_LIGACAO_ENTRAR });
    return;
  } finally {
    botaoEntrar.disabled = false;
    botaoEntrar.textContent = 'Entrar';
  }

  if (resposta.status === 200) {
    const sessao = await resposta.json();
    campoPalavraPasse.value = '';
    await aplicarSessao(sessao);
    if (estadoAtual === 'com-sessao') tituloSessao.focus();
  } else {
    // 400 ou 401: sem distinguir utilizador inexistente de palavra-passe errada.
    mostrarErro(await lerMensagemErro(resposta));
    campoPalavraPasse.value = '';
    campoPalavraPasse.focus();
  }
}

async function terminarSessao() {
  const pendentes = await bd.lerPendentes();
  if (pendentes.length > 0) {
    $('dialogo-texto').textContent = pendentes.length === 1
      ? 'Há 1 sugestão por enviar, que será apagada. Terminar sessão?'
      : `Há ${pendentes.length} sugestões por enviar, que serão apagadas. Terminar sessão?`;
    dialogoSair.returnValue = '';
    dialogoSair.showModal();
    await new Promise((resolve) => dialogoSair.addEventListener('close', resolve, { once: true }));
    if (dialogoSair.returnValue !== 'confirmar') return;
  }

  let resposta;
  try {
    resposta = await fetch('/v2/sessao', { method: 'DELETE' });
  } catch {
    mudarEstado('sem-ligacao');
    return;
  }
  if (resposta.status === 204) {
    await bd.limparBD();
    proprietario = null;
    apagarRascunho();
    mudarEstado('sem-sessao');
    campoUtilizador.focus();
  } else {
    mostrarErro(await lerMensagemErro(resposta));
  }
}

// ---------- Lista (GET /v2/sugestoes → IndexedDB → ecrã) ----------

async function atualizarLista() {
  if (estadoAtual !== 'com-sessao') return;
  let resposta;
  try {
    resposta = await fetch('/v2/sugestoes');
  } catch {
    mudarEstado('sem-ligacao');
    return;
  }
  if (resposta.status === 401) {
    mudarEstado('sem-sessao', { mensagem: MENSAGEM_EXPIRADA });
    return;
  }
  if (!resposta.ok) {
    mostrarErro(await lerMensagemErro(resposta));
    return;
  }
  const corpo = await resposta.json();
  proprietario = (await bd.substituirSugestoes(corpo.itens)) ?? proprietario;
  await mostrarLista();
}

function itemSugestao(sugestao) {
  const item = document.createElement('li');
  const titulo = document.createElement('strong');
  titulo.textContent = sugestao.titulo;
  const detalhes = document.createElement('span');
  detalhes.className = 'detalhes';
  detalhes.textContent = `Categoria: ${sugestao.categoria} · Estado: ${sugestao.estado}`;
  item.append(titulo, detalhes);
  return item;
}

function itemPendente(pendente) {
  const item = document.createElement('li');
  item.className = pendente.erro ? 'pendente com-erro' : 'pendente';
  const titulo = document.createElement('strong');
  titulo.textContent = pendente.titulo;
  const etiqueta = document.createElement('span');
  etiqueta.className = 'etiqueta';
  etiqueta.textContent = pendente.erro ? `Não enviada: ${pendente.erro}` : 'Por enviar';
  const detalhes = document.createElement('span');
  detalhes.className = 'detalhes';
  detalhes.textContent = `Categoria: ${pendente.categoria} · Criada às ${hora(pendente.criadaEm)}`;
  const descartar = document.createElement('button');
  descartar.type = 'button';
  descartar.className = 'secundario pequeno';
  descartar.textContent = 'Descartar';
  descartar.setAttribute('aria-label', `Descartar «${pendente.titulo}»`);
  descartar.addEventListener('click', async () => {
    await bd.descartarPendente(pendente.idLocal);
    await mostrarLista();
  });
  item.append(titulo, etiqueta, detalhes, descartar);
  return item;
}

// Mostra sempre a partir da IndexedDB (sem pedidos à rede).
async function mostrarLista() {
  const versao = ++versaoLista;
  const dono = sessaoAtual?.utilizador ?? proprietario?.utilizador;
  const [pendentes, sugestoes] = await Promise.all([
    bd.lerPendentes(),
    bd.lerSugestoes(configuracoes.ordenacao)
  ]);
  if (versao !== versaoLista) return;

  listaPendentes.replaceChildren(...pendentes.filter((p) => p.utilizador === dono).map(itemPendente));
  listaSugestoes.replaceChildren(...sugestoes.map(itemSugestao));
  if (sugestoes.length === 0) {
    const vazio = document.createElement('li');
    vazio.textContent = 'Não há sugestões.';
    listaSugestoes.append(vazio);
  }

  if (estadoAtual === 'com-sessao') {
    listaInfo.textContent = proprietario?.atualizadoEm ? `Atualizado às ${hora(proprietario.atualizadoEm)}` : '';
  } else if (estadoAtual === 'sem-ligacao') {
    listaInfo.textContent = proprietario?.atualizadoEm
      ? `Cópia de ${hora(proprietario.atualizadoEm)} — pode estar desatualizada`
      : '';
  }
}

// ---------- Pendentes ----------

async function tentarEnviarPendentes() {
  if (estadoAtual !== 'com-sessao' || !sessaoAtual) return;
  const resultado = await enviarPendentes(sessaoAtual.utilizador);

  if (resultado.estado === 'sem-sessao') {
    mudarEstado('sem-sessao', { mensagem: textoPendentes(resultado.porEnviar) });
    return;
  }
  if (resultado.estado === 'sem-ligacao') {
    mudarEstado('sem-ligacao');
    return;
  }
  if (resultado.enviadas > 0 || resultado.comErro > 0) {
    const partes = [];
    if (resultado.enviadas === 1) partes.push('1 sugestão por enviar foi enviada');
    else if (resultado.enviadas > 1) partes.push(`${resultado.enviadas} sugestões por enviar foram enviadas`);
    if (resultado.comErro === 1) partes.push('1 foi recusada pelo servidor');
    else if (resultado.comErro > 1) partes.push(`${resultado.comErro} foram recusadas pelo servidor`);
    mostrarSucesso(`${partes.join('; ')}.`);
    await mostrarLista();
  }
}

// ---------- Rascunho (sessionStorage, como na API03) ----------

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
  const rascunho = { titulo: dados.get('titulo'), descricao: dados.get('descricao'), categoria: dados.get('categoria') };
  try {
    if (!rascunho.titulo && !rascunho.descricao && !rascunho.categoria) sessionStorage.removeItem(CHAVE_RASCUNHO);
    else sessionStorage.setItem(CHAVE_RASCUNHO, JSON.stringify(rascunho));
  } catch { /* sem sessionStorage */ }
}

function reporRascunho() {
  const rascunho = lerRascunho();
  if (!rascunho) return;
  formularioSugestao.elements.titulo.value = rascunho.titulo;
  formularioSugestao.elements.descricao.value = rascunho.descricao;
  if ([...seletorCategoria.options].some((o) => o.value === rascunho.categoria)) {
    seletorCategoria.value = rascunho.categoria;
  }
}

function apagarRascunho() {
  try { sessionStorage.removeItem(CHAVE_RASCUNHO); } catch { /* nada a apagar */ }
  formularioSugestao.reset();
}

// ---------- Nova sugestão (POST /v2/sugestoes) ----------

// As categorias vêm de GET /v2/categorias, servidas pelo service worker (cache e atualização).
async function carregarCategorias() {
  try {
    const resposta = await fetch('/v2/categorias');
    if (!resposta.ok) throw new Error(String(resposta.status));
    const categorias = await resposta.json();
    const escolhida = seletorCategoria.value || lerRascunho()?.categoria || '';
    seletorCategoria.replaceChildren(new Option('Escolher…', ''),
      ...categorias.map((c) => new Option(c.descricao ? `${c.codigo} — ${c.descricao}` : c.codigo, c.codigo)));
    if (categorias.some((c) => c.codigo === escolhida)) seletorCategoria.value = escolhida;
    categoriasCarregadas = true;
  } catch {
    // Sem rede e sem cópia em cache: mantém as que já tinha, se tinha.
  }
  camposSugestao.disabled = !categoriasCarregadas;
  avisoSemCategorias.hidden = categoriasCarregadas;
}

async function guardarComoPendente(dados) {
  await bd.acrescentarPendente(dados, proprietario.utilizador);
  apagarRascunho();
  mostrarSucesso('sugestão guardada neste browser; será enviada quando houver ligação e sessão.');
  await mostrarLista();
}

async function submeterSugestao(evento) {
  evento.preventDefault();
  if (!proprietario) return;
  const formulario = new FormData(formularioSugestao);
  // Só os campos de SugestaoNova: o numeroAluno vem do token.
  const dados = {
    titulo: formulario.get('titulo'),
    descricao: formulario.get('descricao'),
    categoria: formulario.get('categoria')
  };

  if (estadoAtual === 'sem-ligacao') {
    await guardarComoPendente(dados);
    return;
  }

  let resposta;
  try {
    resposta = await fetch('/v2/sugestoes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dados)
    });
  } catch {
    mudarEstado('sem-ligacao');
    await guardarComoPendente(dados);
    return;
  }

  if (resposta.status === 201) {
    const criada = await resposta.json();
    await bd.acrescentarSugestao(criada);
    apagarRascunho();
    mostrarSucesso(`sugestão «${criada.titulo}» submetida.`);
    await mostrarLista();
  } else if (resposta.status === 401) {
    mudarEstado('sem-sessao', { mensagem: MENSAGEM_EXPIRADA }); // o rascunho fica guardado
    campoUtilizador.focus();
  } else {
    mostrarErro(await lerMensagemErro(resposta)); // o rascunho fica guardado
  }
}

// ---------- Configurações (localStorage, como na API03) ----------

function aplicarConfiguracoes() {
  document.documentElement.dataset.tema = configuracoes.tema;
  opcaoTema.value = configuracoes.tema;
  opcaoOrdenacao.value = configuracoes.ordenacao;
}

function alterarConfiguracoes() {
  const ordenacaoAnterior = configuracoes.ordenacao;
  configuracoes = { tema: opcaoTema.value, ordenacao: opcaoOrdenacao.value };
  aplicarConfiguracoes();
  guardarConfiguracoes(configuracoes);
  // Nova ordenação: volta a ler a IndexedDB, sem pedido à rede.
  if (configuracoes.ordenacao !== ordenacaoAnterior && !trabalho.hidden) mostrarLista();
}

// ---------- Service worker ----------

function mostrarAtualizacao() {
  $('atualizacao').hidden = false;
}

async function registarServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    registoSW = await navigator.serviceWorker.register('/sw.js');
  } catch {
    return;
  }

  // Já existe uma versão nova à espera (por exemplo, instalada numa visita anterior).
  if (registoSW.waiting && navigator.serviceWorker.controller) mostrarAtualizacao();

  registoSW.addEventListener('updatefound', () => {
    const nova = registoSW.installing;
    if (!nova) return;
    nova.addEventListener('statechange', () => {
      if (nova.state === 'installed' && navigator.serviceWorker.controller) mostrarAtualizacao();
    });
  });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (atualizacaoPedida) {
      window.location.reload();
    } else {
      // Primeira instalação: a página passou a ser controlada; volta a pedir as
      // categorias, agora através do service worker, para ficarem em cache.
      carregarCategorias();
    }
  });
}

function ativarNovaVersao() {
  if (!registoSW || !registoSW.waiting) return;
  atualizacaoPedida = true;
  registoSW.waiting.postMessage({ tipo: 'ativar' });
}

// ---------- Ligação ----------

window.addEventListener('online', async () => {
  atualizarIndicacaoLigacao('A rede voltou; a contactar o servidor…');
  if (!categoriasCarregadas) carregarCategorias();
  // GET /v2/sessao e, se houver sessão, envio das pendentes (dentro de aplicarSessao).
  await verificarSessao();
});

window.addEventListener('offline', () => {
  // Só atualiza a indicação: sem-ligacao resulta sempre de um fetch rejeitado.
  atualizarIndicacaoLigacao('O browser indica que está sem rede.');
});

// ---------- Arranque ----------

aplicarConfiguracoes();
registarServiceWorker();
mudarEstado('a-verificar');

opcaoTema.addEventListener('change', alterarConfiguracoes);
opcaoOrdenacao.addEventListener('change', alterarConfiguracoes);
formularioEntrada.addEventListener('submit', entrar);
formularioSugestao.addEventListener('input', guardarRascunho);
formularioSugestao.addEventListener('change', guardarRascunho);
formularioSugestao.addEventListener('submit', submeterSugestao);
botaoAtualizarLista.addEventListener('click', () => { limparMensagens(); atualizarLista(); });
botaoSair.addEventListener('click', terminarSessao);
$('botao-tentar').addEventListener('click', () => { mudarEstado('a-verificar'); verificarSessao(); });
$('botao-atualizar').addEventListener('click', ativarNovaVersao);
setInterval(aCadaSegundo, 1000);

(async () => {
  try {
    proprietario = await bd.lerProprietario();
  } catch {
    proprietario = null; // IndexedDB indisponível: funciona sem cópia local
  }
  await Promise.all([carregarCategorias(), verificarSessao()]);
})();
