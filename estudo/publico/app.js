'use strict'

/** Estado carregado do servidor. */
let estado = { ideias: [], sessoes: [], sessaoAtivaId: null, raizRepo: '' }

/** Arquivo aberto no leitor. */
let arquivoAberto = null
/** Pasta listada no explorador. */
let pastaAtual = ''
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

  renderSessao()
  renderIdeias()
  renderPanorama()
  renderSessoes()

  $('menu-contagem').innerHTML = `${estado.ideias.length} ideia${estado.ideias.length === 1 ? '' : 's'}<br />${estado.sessoes.length} sessão${estado.sessoes.length === 1 ? '' : 'ões'}`
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

/** Desenha o caminho atual como migalhas clicaveis. */
function renderMigalhas(caminho) {
  const el = $('migalhas')
  el.innerHTML = ''

  const raiz = document.createElement('button')
  raiz.className = 'migalha'
  raiz.textContent = 'raiz'
  raiz.title = 'voltar à raiz'
  raiz.addEventListener('click', () => {
    $('busca-arquivo').value = ''
    abrirPasta('')
  })
  el.append(raiz)

  let acumulado = ''
  for (const parte of caminho.split('/').filter(Boolean)) {
    acumulado = acumulado ? `${acumulado}/${parte}` : parte
    const separador = document.createElement('span')
    separador.className = 'migalha-sep'
    separador.textContent = '/'
    el.append(separador)

    const botao = document.createElement('button')
    botao.className = 'migalha'
    botao.textContent = parte
    const alvo = acumulado
    botao.addEventListener('click', () => {
      $('busca-arquivo').value = ''
      abrirPasta(alvo)
    })
    el.append(botao)
  }
}

function renderArvore(dados) {
  renderMigalhas(dados.caminho)
  const arvore = $('arvore')
  arvore.innerHTML = ''

  for (const pasta of dados.pastas) {
    const botao = document.createElement('button')
    botao.className = 'item-arvore pasta'
    botao.innerHTML = '<span class="marca chevron">▸</span><span class="nome">' + esc(pasta.nome) + '</span>'
    botao.addEventListener('click', () => abrirPasta(pasta.caminho))
    arvore.append(botao)
  }

  for (const arquivo of dados.arquivos) {
    const botao = document.createElement('button')
    botao.className = 'item-arvore'
    if (arquivoAberto?.caminho === arquivo.caminho) botao.classList.add('atual')
    botao.innerHTML =
      `<span class="marca ponto-classe ${esc(arquivo.classe)}"></span>` +
      `<span class="nome">${esc(arquivo.nome)}</span>` +
      `<span class="classe">${esc(arquivo.classe)}</span>`
    botao.addEventListener('click', () => abrirArquivo(arquivo.caminho))
    arvore.append(botao)
  }

  if (dados.pastas.length === 0 && dados.arquivos.length === 0) {
    arvore.innerHTML = '<div class="arvore-vazio">pasta vazia</div>'
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

    const migalhas = $('migalhas')
    migalhas.innerHTML = ''
    const rotulo = document.createElement('span')
    rotulo.className = 'migalha-rotulo'
    rotulo.textContent = `${resultados.length} arquivos com “${termo}”`
    migalhas.append(rotulo)

    if (resultados.length === 0) {
      arvore.innerHTML = '<div class="vazio">Nada encontrado.</div>'
      return
    }
    for (const item of resultados) {
      const botao = document.createElement('button')
      botao.className = 'item-arvore'
      botao.innerHTML =
        `<span class="marca ponto-classe ${esc(item.classe)}"></span>` +
        `<span class="nome" title="${esc(item.caminho)}">${esc(item.caminho)}</span>`
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

// ------------------------------------------------------------ foco

/** Entra e sai do modo foco: o resto da tela embaça, o leitor toma a cena. */
function alternarFoco() {
  const ativo = document.body.classList.toggle('foco')
  $('btn-foco').textContent = ativo ? 'sair do foco' : 'focar'
  $('btn-foco').title = ativo ? 'Esc para sair' : 'distrações embaçadas'
}

$('btn-foco').addEventListener('click', alternarFoco)

document.addEventListener('keydown', (evento) => {
  if (evento.key === 'Escape' && document.body.classList.contains('foco')) alternarFoco()
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

$('btn-sel-copiar').addEventListener('click', async () => {
  if (!selecaoAtual) return
  await navigator.clipboard.writeText(selecaoAtual.texto)
  avisar('Trecho copiado.')
  $('acoes-selecao').hidden = true
})

$('btn-sel-ideia').addEventListener('click', () => {
  if (!selecaoAtual) return
  mostrarVisao('ideias')
  $('ideia-corpo').value = selecaoAtual.texto
  lembrarOrigem(selecaoAtual.linha ? `${arquivoAberto.caminho}:${selecaoAtual.linha}` : arquivoAberto.caminho)
  $('ideia-titulo').focus()
  $('acoes-selecao').hidden = true
})

// ----------------------------------------------------------- ideias

/**
 * Guarda de onde a ideia veio. Fica fora do formulario de proposito: a origem
 * e deduzida do contexto, nao e uma escolha de quem registra.
 */
let origemPendente = ''

function lembrarOrigem(origem) {
  origemPendente = origem
  const caixa = $('origem-pendente')
  caixa.hidden = !origem
  caixa.textContent = origem ? `veio de ${origem}` : ''
}

$('form-ideia').addEventListener('submit', async (evento) => {
  evento.preventDefault()
  try {
    await api('/api/ideias', {
      method: 'POST',
      body: JSON.stringify({
        titulo: $('ideia-titulo').value,
        corpo: $('ideia-corpo').value,
        origem: origemPendente,
      }),
    })
    $('ideia-titulo').value = ''
    $('ideia-corpo').value = ''
    lembrarOrigem('')
    $('ideia-titulo').focus()
    avisar('Ideia registrada.')
    await carregar()
  } catch (erro) {
    avisar(erro.message, true)
  }
})

let filtroArea = ''

function ideiasFiltradas() {
  const texto = $('filtro-texto').value.trim().toLowerCase()

  return estado.ideias
    .filter((i) => {
      if (filtroArea && i.area !== filtroArea) return false
      if (!texto) return true
      const alvo = `${i.titulo} ${i.corpo} ${i.area ?? ''} ${(i.tags ?? []).join(' ')}`
      return alvo.toLowerCase().includes(texto)
    })
    // Mais recente primeiro: o registro cresce pelo fim.
    .sort((a, b) => b.criadaEm.localeCompare(a.criadaEm))
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
    bloco.className = ideia.status === 'descartada' ? 'ideia descartada' : 'ideia'

    bloco.innerHTML = `
      <div class="ideia-titulo"><span>${esc(ideia.titulo)}</span></div>
      ${ideia.corpo ? `<div class="ideia-corpo">${esc(ideia.corpo)}</div>` : ''}
      <div class="ideia-meta"></div>
      <div class="ideia-acoes"></div>`

    // So mostra o que a ideia tiver: o registro simples nao preenche nada disso.
    const meta = bloco.querySelector('.ideia-meta')
    if (ideia.area) {
      const etiqueta = document.createElement('span')
      etiqueta.className = 'etiqueta area'
      etiqueta.textContent = ideia.area
      meta.append(etiqueta)
    }
    for (const tag of ideia.tags ?? []) {
      const etiqueta = document.createElement('span')
      etiqueta.className = 'etiqueta'
      etiqueta.textContent = tag
      meta.append(etiqueta)
    }
    if (ideia.origem) ligarOrigem(ideia, meta)

    const acoes = bloco.querySelector('.ideia-acoes')
    const criar = (texto, aoClicar) => {
      const botao = document.createElement('button')
      botao.className = 'botao botao-fantasma'
      botao.textContent = texto
      botao.addEventListener('click', aoClicar)
      acoes.append(botao)
    }

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

// -------------------------------------------------------- panorama

function renderPanorama() {
  const ideias = estado.ideias
  const conteudo = $('panorama-conteudo')
  conteudo.innerHTML = ''

  const porSessao = ideias.filter((i) => i.sessaoId).length
  conteudo.insertAdjacentHTML(
    'beforeend',
    `<div class="destaque-numero">${ideias.length}</div>
     <div class="destaque-texto">ideias registradas${porSessao ? ` · ${porSessao} dentro de sessões` : ''}</div>`,
  )

  // Indice de titulos: com o registro crescendo, achar uma ideia pelo nome e o
  // que mais se faz. Clicar rola ate o cartao.
  if (ideias.length > 0) {
    const caixa = document.createElement('div')
    caixa.className = 'panorama-grupo'
    caixa.innerHTML = '<h3>Índice</h3>'
    for (const ideia of ideias.slice().reverse()) {
      const item = document.createElement('button')
      item.className = 'indice-item'
      item.textContent = ideia.titulo
      item.title = ideia.titulo
      item.addEventListener('click', () => {
        $('filtro-texto').value = ''
        filtroArea = ''
        renderIdeias()
        const cartao = document.querySelector(`[data-ideia="${ideia.id}"]`)
        cartao?.scrollIntoView({ block: 'center' })
        cartao?.classList.add('piscando')
        setTimeout(() => cartao?.classList.remove('piscando'), 1200)
      })
      caixa.append(item)
    }
    conteudo.append(caixa)
  }

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
    $('filtro-texto').value = ''
    renderIdeias()
    avisar(filtroArea ? `Filtrando por área: ${nome}` : 'Filtro de área removido.')
  })

  grupo('Por etiqueta', contagem((i) => i.tags ?? []), (nome) => {
    filtroArea = ''
    $('filtro-texto').value = nome
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
      <div class="dados">${inicio.toLocaleString('pt-BR')} · ${duracao} · ${total} ideia${total === 1 ? '' : 's'}</div>`

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
