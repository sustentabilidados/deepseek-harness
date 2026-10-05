'use strict'

/** Estado carregado do servidor. */
let estado = { ideias: [], sessoes: [], sessaoAtivaId: null, modoChat: 'local', raizRepo: '' }

/** Historico curto enviado ao chat, para dar contexto a pergunta seguinte. */
const historicoChat = []

/** Arquivo aberto no leitor. */
let arquivoAberto = null
/** Pasta listada no explorador. */
let pastaAtual = ''
/** Se o chat deve considerar o arquivo aberto. */
let usarContexto = true
/** Se o leitor mostra markdown formatado. */
let modoFormatado = true

const $ = (id) => document.getElementById(id)

// esc() e formatarMarkdown() vem de markdown.js, carregado antes deste arquivo.

function avisar(mensagem, erro = false) {
  const caixa = $('aviso')
  caixa.textContent = mensagem
  caixa.className = erro ? 'aviso erro' : 'aviso'
  caixa.hidden = false
  clearTimeout(avisar.timer)
  avisar.timer = setTimeout(() => {
    caixa.hidden = true
  }, 3400)
}

async function api(caminho, opcoes = {}) {
  const resposta = await fetch(caminho, { headers: { 'content-type': 'application/json' }, ...opcoes })
  const dados = await resposta.json().catch(() => ({}))
  if (!resposta.ok) throw new Error(dados.erro ?? `falha em ${caminho}`)
  return dados
}

function sessaoAtiva() {
  return estado.sessoes.find((s) => s.id === estado.sessaoAtivaId)
}

// --------------------------------------------------------- navegacao

function mostrarVisao(nome) {
  for (const botao of document.querySelectorAll('.menu-item')) {
    botao.classList.toggle('ativo', botao.dataset.visao === nome)
  }
  for (const secao of document.querySelectorAll('.visao')) {
    secao.classList.toggle('ativa', secao.id === `visao-${nome}`)
  }
}

for (const botao of document.querySelectorAll('.menu-item')) {
  botao.addEventListener('click', () => mostrarVisao(botao.dataset.visao))
}

// -------------------------------------------------------- carregar

async function carregar() {
  estado = await api('/api/estado')
  $('topo-repo').textContent = estado.raizRepo

  const selo = $('selo-chat')
  selo.textContent = estado.modoChat === 'modelo' ? 'chat com modelo' : 'chat modo local'
  selo.className = estado.modoChat === 'modelo' ? 'selo modelo' : 'selo'

  renderSessao()
  renderIdeias()
  renderPanorama()
  renderSessoes()

  $('menu-contagem').innerHTML = `${estado.ideias.length} ideia${estado.ideias.length === 1 ? '' : 's'}<br />${estado.sessoes.length} sessão${estado.sessoes.length === 1 ? '' : 'ões'}`

  atualizarContextoChat()
}

// ---------------------------------------------------------- sessao

function renderSessao() {
  const sessao = sessaoAtiva()
  const botao = $('btn-sessao')

  if (sessao) {
    $('sessao-titulo').textContent = sessao.titulo
    botao.textContent = 'Encerrar e resumir'
    botao.classList.remove('botao-primario')
    botao.classList.add('botao-fantasma')
  } else {
    $('sessao-titulo').textContent = 'nenhuma aberta'
    botao.textContent = 'Iniciar sessão'
    botao.classList.add('botao-primario')
    botao.classList.remove('botao-fantasma')
  }
}

$('btn-sessao').addEventListener('click', async () => {
  try {
    if (sessaoAtiva()) {
      const { sessao, markdown } = await api('/api/sessoes/encerrar', { method: 'POST' })
      await carregar()
      mostrarVisao('sessoes')
      abrirResumoPorNome(sessao.resumo, markdown)
      avisar('Sessão encerrada. Resumo salvo em estudo/dados/sessoes/.')
    } else {
      const titulo = prompt('Título da sessão de estudos:', `Estudo de ${new Date().toLocaleDateString('pt-BR')}`)
      if (titulo === null) return
      await api('/api/sessoes/iniciar', { method: 'POST', body: JSON.stringify({ titulo }) })
      await carregar()
      avisar('Sessão iniciada.')
    }
  } catch (erro) {
    avisar(erro.message, true)
  }
})

// ----------------------------------------------------- explorador

async function abrirPasta(caminho) {
  try {
    const dados = await api(`/api/arvore?caminho=${encodeURIComponent(caminho)}`)
    pastaAtual = caminho
    renderArvore(dados)
  } catch (erro) {
    avisar(erro.message, true)
  }
}

function renderArvore(dados) {
  $('migalhas').textContent = `/${dados.caminho}`

  const arvore = $('arvore')
  arvore.innerHTML = ''

  if (dados.pai !== undefined && dados.caminho) {
    const voltar = document.createElement('button')
    voltar.className = 'item-arvore pasta'
    voltar.innerHTML = '<span class="marca">←</span><span class="nome">voltar</span>'
    voltar.addEventListener('click', () => abrirPasta(dados.pai))
    arvore.append(voltar)
  }

  for (const pasta of dados.pastas) {
    const botao = document.createElement('button')
    botao.className = 'item-arvore pasta'
    botao.innerHTML = `<span class="marca">▸</span><span class="nome">${esc(pasta.nome)}</span>`
    botao.addEventListener('click', () => abrirPasta(pasta.caminho))
    arvore.append(botao)
  }

  for (const arquivo of dados.arquivos) {
    const botao = document.createElement('button')
    botao.className = 'item-arvore'
    if (arquivoAberto?.caminho === arquivo.caminho) botao.classList.add('atual')
    botao.innerHTML = `<span class="marca">·</span><span class="nome">${esc(arquivo.nome)}</span><span class="classe">${esc(arquivo.classe)}</span>`
    botao.addEventListener('click', () => abrirArquivo(arquivo.caminho))
    arvore.append(botao)
  }
}

$('busca-arquivo').addEventListener('input', async (evento) => {
  const termo = evento.target.value.trim()
  if (termo.length < 2) {
    await abrirPasta(pastaAtual)
    return
  }
  try {
    const { resultados } = await api(`/api/procurar?q=${encodeURIComponent(termo)}`)
    const arvore = $('arvore')
    arvore.innerHTML = ''
    $('migalhas').textContent = `${resultados.length} arquivos com "${termo}"`

    if (resultados.length === 0) {
      arvore.innerHTML = '<div class="vazio">Nada encontrado.</div>'
      return
    }
    for (const item of resultados) {
      const botao = document.createElement('button')
      botao.className = 'item-arvore'
      botao.innerHTML = `<span class="marca">·</span><span class="nome" title="${esc(item.caminho)}">${esc(item.caminho)}</span>`
      botao.addEventListener('click', () => abrirArquivo(item.caminho))
      arvore.append(botao)
    }
  } catch (erro) {
    avisar(erro.message, true)
  }
})

for (const atalho of document.querySelectorAll('.atalho')) {
  atalho.addEventListener('click', () => {
    const alvo = atalho.dataset.ir
    $('busca-arquivo').value = ''
    if (alvo.endsWith('.md')) {
      abrirArquivo(alvo)
      const pasta = alvo.includes('/') ? alvo.slice(0, alvo.lastIndexOf('/')) : ''
      abrirPasta(pasta)
    } else {
      abrirPasta(alvo)
    }
  })
}

// ---------------------------------------------------------- leitor

async function abrirArquivo(caminho, linha = 0) {
  try {
    const dados = await api(`/api/arquivo?caminho=${encodeURIComponent(caminho)}`)
    arquivoAberto = dados
    modoFormatado = dados.classe === 'documentacao' || dados.classe === 'regras'
    mostrarVisao('estudar')
    renderLeitor(linha)
    atualizarContextoChat(caminho)
    if (linha) avisar(`Aberto em ${caminho}:${linha}`)
  } catch (erro) {
    avisar(erro.message, true)
  }
}

function renderLeitor(linhaDestacada = 0) {
  if (!arquivoAberto) return
  $('leitor-vazio').hidden = true
  $('leitor-conteudo').hidden = false

  $('leitor-caminho').textContent = arquivoAberto.caminho
  $('leitor-meta').innerHTML = `
    <span class="etiqueta area">${esc(arquivoAberto.classe)}</span>
    <span class="etiqueta">${arquivoAberto.linhas} linhas</span>
    <span class="etiqueta">${Math.max(1, Math.round(arquivoAberto.tamanho / 1024))} KB</span>`

  const formatavel = arquivoAberto.classe === 'documentacao' || arquivoAberto.classe === 'regras'
  $('btn-renderizado').hidden = !formatavel

  const corpo = $('leitor-corpo')
  if (formatavel && modoFormatado) {
    corpo.className = 'leitor-corpo formatado'
    corpo.innerHTML = formatarMarkdown(arquivoAberto.conteudo)
    $('btn-renderizado').textContent = 'ver cru'
  } else {
    corpo.className = 'leitor-corpo'
    const linhas = arquivoAberto.conteudo.split('\n')
    corpo.innerHTML = linhas
      .map(
        (texto, i) =>
          `<div class="linha${linhaDestacada === i + 1 ? ' destacada' : ''}" data-linha="${i + 1}"><span class="num">${i + 1}</span><span class="codigo">${esc(texto) || ' '}</span></div>`,
      )
      .join('')
    $('btn-renderizado').textContent = formatavel ? 'ver formatado' : 'ver formatado'

    if (linhaDestacada) {
      const alvo = corpo.querySelector(`[data-linha="${linhaDestacada}"]`)
      alvo?.scrollIntoView({ block: 'center' })
    }
  }

  // marca o arquivo atual na arvore, se estiver visivel
  for (const item of document.querySelectorAll('.item-arvore')) {
    item.classList.toggle('atual', item.textContent.includes(arquivoAberto.caminho.split('/').pop()))
  }
}

$('btn-renderizado').addEventListener('click', () => {
  modoFormatado = !modoFormatado
  renderLeitor()
})

$('btn-perguntar-arquivo').addEventListener('click', () => {
  $('campo-pergunta').value = `O que este arquivo faz e o que eu deveria aprender com ele?\n`
  $('campo-pergunta').focus()
})

// ---------------------------------------------------- selecao

let selecaoAtual = null

document.addEventListener('mouseup', (evento) => {
  const barra = $('acoes-selecao')
  if (barra.contains(evento.target)) return

  const selecao = window.getSelection()
  const texto = selecao?.toString().trim() ?? ''
  const dentroDoLeitor = $('leitor-corpo').contains(selecao?.anchorNode ?? null)

  if (!texto || texto.length < 3 || !dentroDoLeitor) {
    barra.hidden = true
    return
  }

  let linha = 0
  const elemento = selecao.anchorNode?.parentElement?.closest('.linha')
  if (elemento) linha = Number(elemento.dataset.linha)

  selecaoAtual = { texto, linha }
  const caixa = selecao.getRangeAt(0).getBoundingClientRect()
  barra.style.left = `${Math.min(caixa.left, window.innerWidth - 320)}px`
  barra.style.top = `${Math.min(caixa.bottom + 8, window.innerHeight - 60)}px`
  barra.hidden = false
})

$('btn-sel-perguntar').addEventListener('click', () => {
  if (!selecaoAtual) return
  const trecho = selecaoAtual.texto.length > 600 ? `${selecaoAtual.texto.slice(0, 600)}…` : selecaoAtual.texto
  $('campo-pergunta').value = `Explica em linguagem natural o que isto significa e quando eu deveria pedir isso a um modelo:\n\n"${trecho}"\n`
  $('acoes-selecao').hidden = true
  $('campo-pergunta').focus()
})

$('btn-sel-ideia').addEventListener('click', () => {
  if (!selecaoAtual) return
  mostrarVisao('ideias')
  $('ideia-corpo').value = selecaoAtual.texto
  $('ideia-origem').value = selecaoAtual.linha ? `${arquivoAberto.caminho}:${selecaoAtual.linha}` : arquivoAberto.caminho
  $('ideia-titulo').focus()
  $('acoes-selecao').hidden = true
})

// ------------------------------------------------------------ chat

function atualizarContextoChat(caminho) {
  const caixa = $('chat-contexto')
  const usar = usarContexto && (caminho ?? arquivoAberto?.caminho)
  caixa.hidden = !usar
  if (usar) $('chat-contexto-nome').textContent = caminho ?? arquivoAberto.caminho
}

$('btn-tirar-contexto').addEventListener('click', () => {
  usarContexto = !usarContexto
  atualizarContextoChat()
  if (!usarContexto && arquivoAberto) {
    $('btn-tirar-contexto').title = 'voltar a perguntar sobre este arquivo'
    avisar('Chat perguntando sobre o repositório todo.')
  } else {
    avisar(`Chat perguntando sobre ${arquivoAberto?.caminho ?? 'o repositório'}.`)
  }
})

function adicionarMensagem(quem, texto, opcoes = {}) {
  $('chat-historico').querySelector('.vazio')?.remove()

  const bloco = document.createElement('div')
  bloco.className = quem === 'eu' ? 'mensagem eu' : 'mensagem'
  bloco.innerHTML = `<div class="quem">${quem === 'eu' ? 'você' : 'orientador'}</div>
    <div class="texto">${esc(texto)}</div>`

  if (opcoes.trechos?.length || opcoes.ideias?.length) {
    const refs = document.createElement('div')
    refs.className = 'referencias'

    for (const ideia of opcoes.ideias ?? []) {
      const item = document.createElement('button')
      item.className = 'referencia'
      item.textContent = `✦ ideia: ${ideia.titulo}`
      item.addEventListener('click', () => {
        mostrarVisao('ideias')
        $('filtro-texto').value = ideia.titulo
        renderIdeias()
      })
      refs.append(item)
    }

    for (const trecho of opcoes.trechos ?? []) {
      const item = document.createElement('button')
      item.className = trecho.foco ? 'referencia foco' : 'referencia'
      item.textContent = `${trecho.arquivo}:${trecho.linha}`
      item.title = trecho.texto
      item.addEventListener('click', () => abrirArquivo(trecho.arquivo, trecho.linha))
      refs.append(item)
    }
    bloco.append(refs)
  }

  if (quem !== 'eu') {
    const acoes = document.createElement('div')
    acoes.className = 'acoes'
    const botao = document.createElement('button')
    botao.className = 'botao botao-fantasma'
    botao.textContent = 'registrar como ideia'
    botao.addEventListener('click', () => {
      mostrarVisao('ideias')
      $('ideia-corpo').value = texto
      const primeira = opcoes.trechos?.[0]
      if (primeira) $('ideia-origem').value = `${primeira.arquivo}:${primeira.linha}`
      $('ideia-titulo').focus()
    })
    acoes.append(botao)
    bloco.append(acoes)
  }

  const historico = $('chat-historico')
  historico.append(bloco)
  historico.scrollTop = historico.scrollHeight
}

$('btn-limpar-chat').addEventListener('click', () => {
  historicoChat.length = 0
  $('chat-historico').innerHTML =
    '<div class="vazio">Pergunte em linguagem natural. Sem chave de API eu mostro trechos do repositório e o que você já registrou, sem inventar.</div>'
})

$('form-chat').addEventListener('submit', async (evento) => {
  evento.preventDefault()
  const campo = $('campo-pergunta')
  const pergunta = campo.value.trim()
  if (!pergunta) return

  campo.value = ''
  adicionarMensagem('eu', pergunta)
  const botao = $('btn-perguntar')
  botao.disabled = true
  botao.textContent = '…'

  try {
    const arquivo = usarContexto ? (arquivoAberto?.caminho ?? '') : ''
    const resultado = await api('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ pergunta, historico: historicoChat, arquivo }),
    })
    adicionarMensagem('orientador', resultado.texto, resultado)
    historicoChat.push({ role: 'user', content: pergunta }, { role: 'assistant', content: resultado.texto })
    await carregar()
  } catch (erro) {
    adicionarMensagem('orientador', `Erro: ${erro.message}`)
  } finally {
    botao.disabled = false
    botao.textContent = 'Perguntar'
  }
})

// ----------------------------------------------------------- ideias

$('form-ideia').addEventListener('submit', async (evento) => {
  evento.preventDefault()
  try {
    await api('/api/ideias', {
      method: 'POST',
      body: JSON.stringify({
        titulo: $('ideia-titulo').value,
        corpo: $('ideia-corpo').value,
        area: $('ideia-area').value,
        tags: $('ideia-tags').value.split(','),
        importancia: $('ideia-importancia').value,
        projeto: $('ideia-projeto').checked,
        origem: $('ideia-origem').value,
      }),
    })
    for (const id of ['ideia-titulo', 'ideia-corpo', 'ideia-tags', 'ideia-origem']) $(id).value = ''
    $('ideia-titulo').focus()
    avisar('Ideia registrada.')
    await carregar()
  } catch (erro) {
    avisar(erro.message, true)
  }
})

const ROTULO = { alta: 'alta', media: 'média', baixa: 'baixa' }

let filtroArea = ''

function ideiasFiltradas() {
  const texto = $('filtro-texto').value.trim().toLowerCase()
  const visao = $('filtro-visao').value

  return estado.ideias
    .filter((i) => {
      if (visao === 'projeto' && !i.projeto) return false
      if (visao === 'alta' && i.importancia !== 'alta') return false
      if (visao === 'sessao' && i.sessaoId !== estado.sessaoAtivaId) return false
      if (filtroArea && i.area !== filtroArea) return false
      if (!texto) return true
      const alvo = `${i.titulo} ${i.corpo} ${i.area} ${(i.tags ?? []).join(' ')}`
      return alvo.toLowerCase().includes(texto)
    })
    .sort((a, b) => {
      if (a.projeto !== b.projeto) return a.projeto ? -1 : 1
      const ordem = { alta: 0, media: 1, baixa: 2 }
      if (ordem[a.importancia] !== ordem[b.importancia]) return ordem[a.importancia] - ordem[b.importancia]
      return b.criadaEm.localeCompare(a.criadaEm)
    })
}

async function alterarIdeia(id, mudanca) {
  try {
    await api(`/api/ideias/${id}`, { method: 'PATCH', body: JSON.stringify(mudanca) })
    await carregar()
  } catch (erro) {
    avisar(erro.message, true)
  }
}

/** Transforma "caminho/arquivo.md:42" em algo clicavel. */
function ligarOrigem(ideia, elemento) {
  const casou = ideia.origem.match(/^([^\s:]+\.\w+):(\d+)$/)
  const etiqueta = document.createElement('span')
  etiqueta.className = 'etiqueta origem'
  etiqueta.textContent = ideia.origem
  if (casou) {
    etiqueta.title = 'abrir no leitor'
    etiqueta.addEventListener('click', () => abrirArquivo(casou[1], Number(casou[2])))
  }
  elemento.append(etiqueta)
}

function renderIdeias() {
  const lista = $('lista-ideias')
  const ideias = ideiasFiltradas()
  lista.innerHTML = ''

  if (ideias.length === 0) {
    lista.innerHTML =
      '<div class="vazio">Nada aqui ainda. Registre a primeira técnica ou hábito acima — pode escrever como se estivesse pedindo a um modelo de IA.</div>'
    return
  }

  for (const ideia of ideias) {
    const bloco = document.createElement('div')
    bloco.dataset.ideia = ideia.id
    const classes = ['ideia']
    if (ideia.projeto) classes.push('projeto')
    if (ideia.importancia === 'alta') classes.push('alta')
    if (ideia.status === 'descartada') classes.push('descartada')
    bloco.className = classes.join(' ')

    bloco.innerHTML = `
      <div class="ideia-titulo"><span>${esc(ideia.titulo)}</span></div>
      ${ideia.corpo ? `<div class="ideia-corpo">${esc(ideia.corpo)}</div>` : ''}
      <div class="ideia-meta"></div>
      <div class="ideia-acoes"></div>`

    const meta = bloco.querySelector('.ideia-meta')
    if (ideia.area) {
      const etiqueta = document.createElement('span')
      etiqueta.className = 'etiqueta area'
      etiqueta.textContent = ideia.area
      meta.append(etiqueta)
    }
    const importancia = document.createElement('span')
    importancia.className = 'etiqueta'
    importancia.textContent = ROTULO[ideia.importancia] ?? ideia.importancia
    meta.append(importancia)
    for (const tag of ideia.tags ?? []) {
      const etiqueta = document.createElement('span')
      etiqueta.className = 'etiqueta'
      etiqueta.textContent = tag
      meta.append(etiqueta)
    }
    if (ideia.origem) ligarOrigem(ideia, meta)
    if (ideia.projeto) {
      const etiqueta = document.createElement('span')
      etiqueta.className = 'etiqueta'
      etiqueta.textContent = 'vale para projetos'
      meta.append(etiqueta)
    }

    const acoes = bloco.querySelector('.ideia-acoes')
    const criar = (texto, aoClicar) => {
      const botao = document.createElement('button')
      botao.className = 'botao botao-fantasma'
      botao.textContent = texto
      botao.addEventListener('click', aoClicar)
      acoes.append(botao)
    }

    criar(ideia.projeto ? 'tirar de projeto' : 'vale para projeto', () =>
      alterarIdeia(ideia.id, { projeto: !ideia.projeto }),
    )
    criar('editar', () => {
      const titulo = prompt('Título:', ideia.titulo)
      if (titulo === null) return
      const corpo = prompt('Descrição:', ideia.corpo)
      if (corpo === null) return
      alterarIdeia(ideia.id, { titulo, corpo })
    })
    criar(ideia.status === 'descartada' ? 'reativar' : 'descartar', () =>
      alterarIdeia(ideia.id, { status: ideia.status === 'descartada' ? 'aberta' : 'descartada' }),
    )
    criar('excluir', async () => {
      if (!confirm(`Excluir "${ideia.titulo}"?`)) return
      try {
        await api(`/api/ideias/${ideia.id}`, { method: 'DELETE' })
        await carregar()
      } catch (erro) {
        avisar(erro.message, true)
      }
    })

    lista.append(bloco)
  }
}

$('filtro-texto').addEventListener('input', renderIdeias)
$('filtro-visao').addEventListener('change', renderIdeias)

// -------------------------------------------------------- panorama

function renderPanorama() {
  const ideias = estado.ideias
  const conteudo = $('panorama-conteudo')
  conteudo.innerHTML = ''

  const projeto = ideias.filter((i) => i.projeto)
  conteudo.insertAdjacentHTML(
    'beforeend',
    `<div class="destaque-numero">${ideias.length}</div>
     <div class="destaque-texto">ideias registradas · ${projeto.length} valem para seus projetos</div>`,
  )

  const contagem = (chave) => {
    const mapa = new Map()
    for (const ideia of ideias) {
      const valores = chave(ideia)
      for (const valor of [].concat(valores)) {
        if (!valor) continue
        mapa.set(valor, (mapa.get(valor) ?? 0) + 1)
      }
    }
    return [...mapa].sort((a, b) => b[1] - a[1])
  }

  const grupo = (titulo, dados, aoClicar) => {
    if (dados.length === 0) return
    const maximo = dados[0][1]
    const caixa = document.createElement('div')
    caixa.className = 'panorama-grupo'
    caixa.innerHTML = `<h3>${titulo}</h3>`

    for (const [nome, total] of dados.slice(0, 10)) {
      const barra = document.createElement('div')
      barra.className = 'barra'
      barra.innerHTML = `<span class="barra-nome" title="${esc(nome)}">${esc(nome)}</span>
        <span class="barra-trilha"><span class="barra-preenchida" style="width:${(total / maximo) * 100}%"></span></span>
        <span class="barra-numero">${total}</span>`
      barra.addEventListener('click', () => aoClicar(nome))
      caixa.append(barra)
    }
    conteudo.append(caixa)
  }

  grupo('Por área', contagem((i) => i.area), (nome) => {
    filtroArea = filtroArea === nome ? '' : nome
    $('filtro-visao').value = 'todas'
    $('filtro-texto').value = ''
    renderIdeias()
    avisar(filtroArea ? `Filtrando por área: ${nome}` : 'Filtro de área removido.')
  })

  grupo('Por etiqueta', contagem((i) => i.tags ?? []), (nome) => {
    filtroArea = ''
    $('filtro-visao').value = 'todas'
    $('filtro-texto').value = nome
    renderIdeias()
  })

  grupo('Por importância', contagem((i) => ROTULO[i.importancia] ?? i.importancia), (nome) => {
    filtroArea = ''
    $('filtro-texto').value = ''
    $('filtro-visao').value = nome === 'alta' ? 'alta' : 'todas'
    renderIdeias()
  })
}

// --------------------------------------------------------- sessoes

function renderSessoes() {
  const lista = $('lista-sessoes')
  const sessoes = estado.sessoes.slice().reverse()
  lista.innerHTML = ''

  if (sessoes.length === 0) {
    lista.innerHTML = '<div class="vazio">Nenhuma sessão ainda. Inicie uma no topo da tela.</div>'
    return
  }

  for (const sessao of sessoes) {
    const total = estado.ideias.filter((i) => i.sessaoId === sessao.id).length
    const item = document.createElement('div')
    item.className = 'sessao-item'
    const inicio = new Date(sessao.iniciadaEm)
    const fim = sessao.encerradaEm ? new Date(sessao.encerradaEm) : null
    const duracao = fim ? `${Math.max(1, Math.round((fim - inicio) / 60000))} min` : 'em andamento'

    item.innerHTML = `<div class="titulo">${esc(sessao.titulo)}</div>
      <div class="dados">${inicio.toLocaleString('pt-BR')} · ${duracao} · ${total} ideia${total === 1 ? '' : 's'} · ${sessao.perguntas.length} pergunta${sessao.perguntas.length === 1 ? '' : 's'}</div>`

    if (sessao.resumo) {
      item.addEventListener('click', async () => {
        try {
          const { markdown } = await api(`/api/sessoes/${sessao.resumo}`)
          abrirResumoPorNome(sessao.resumo, markdown, item)
        } catch (erro) {
          avisar(erro.message, true)
        }
      })
    }
    lista.append(item)
  }
}

let resumoAtual = null

function abrirResumoPorNome(nome, markdown, item) {
  resumoAtual = { nome, markdown }
  $('resumo-titulo').textContent = nome
  $('resumo-conteudo').innerHTML = `<div class="formatado">${formatarMarkdown(markdown)}</div>`
  for (const outro of document.querySelectorAll('.sessao-item')) outro.classList.remove('atual')
  item?.classList.add('atual')
}

$('btn-baixar-resumo').addEventListener('click', () => {
  if (!resumoAtual) return avisar('Escolha uma sessão primeiro.', true)
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([resumoAtual.markdown], { type: 'text/markdown' }))
  link.download = resumoAtual.nome
  link.click()
  URL.revokeObjectURL(link.href)
})

// ------------------------------------------------------------ inicio

carregar()
  .then(() => abrirPasta(''))
  .catch((erro) => avisar(`Falha ao carregar: ${erro.message}`, true))
