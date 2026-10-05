'use strict'

/** Estado carregado do servidor. */
let estado = { ideias: [], sessoes: [], sessaoAtivaId: null, modoChat: 'local', raizRepo: '' }

/** Historico curto enviado ao chat, para dar contexto a pergunta seguinte. */
const historicoChat = []

const $ = (id) => document.getElementById(id)

/** Escapa texto para insercao em HTML. */
function esc(texto) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function avisar(mensagem, erro = false) {
  const caixa = $('aviso')
  caixa.textContent = mensagem
  caixa.className = erro ? 'aviso erro' : 'aviso'
  caixa.hidden = false
  clearTimeout(avisar.timer)
  avisar.timer = setTimeout(() => {
    caixa.hidden = true
  }, 3200)
}

async function api(caminho, opcoes = {}) {
  const resposta = await fetch(caminho, {
    headers: { 'content-type': 'application/json' },
    ...opcoes,
  })
  const dados = await resposta.json().catch(() => ({}))
  if (!resposta.ok) throw new Error(dados.erro ?? `falha em ${caminho}`)
  return dados
}

function sessaoAtiva() {
  return estado.sessoes.find((s) => s.id === estado.sessaoAtivaId)
}

// ------------------------------------------------------------- carregar

async function carregar() {
  estado = await api('/api/estado')
  $('topo-repo').textContent = estado.raizRepo

  const selo = $('selo-chat')
  selo.textContent = estado.modoChat === 'modelo' ? 'chat com modelo' : 'chat modo local'
  selo.className = estado.modoChat === 'modelo' ? 'selo modelo' : 'selo'

  renderSessao()
  renderIdeias()
  renderSessoes()
}

// -------------------------------------------------------------- sessao

function renderSessao() {
  const sessao = sessaoAtiva()
  const botao = $('btn-sessao')

  if (sessao) {
    $('sessao-titulo').textContent = sessao.titulo
    botao.textContent = 'Encerrar e resumir'
    botao.classList.remove('botao-primario')
    botao.classList.add('botao-fantasma')
    $('contador-perguntas').textContent = `${sessao.perguntas.length} pergunta${sessao.perguntas.length === 1 ? '' : 's'}`
  } else {
    $('sessao-titulo').textContent = 'nenhuma aberta'
    botao.textContent = 'Iniciar sessão'
    botao.classList.add('botao-primario')
    botao.classList.remove('botao-fantasma')
    $('contador-perguntas').textContent = '0 perguntas'
  }
}

$('btn-sessao').addEventListener('click', async () => {
  const sessao = sessaoAtiva()
  try {
    if (sessao) {
      const { sessao: encerrada, markdown } = await api('/api/sessoes/encerrar', { method: 'POST' })
      mostrarResumo(encerrada.resumo, markdown)
      avisar('Sessão encerrada. Resumo salvo em estudo/dados/sessoes/.')
    } else {
      const titulo = prompt('Título da sessão de estudos:', `Estudo de ${new Date().toLocaleDateString('pt-BR')}`)
      if (titulo === null) return
      await api('/api/sessoes/iniciar', { method: 'POST', body: JSON.stringify({ titulo }) })
      avisar('Sessão iniciada.')
    }
    await carregar()
  } catch (erro) {
    avisar(erro.message, true)
  }
})

// ---------------------------------------------------------------- chat

function adicionarMensagem(quem, texto, opcoes = {}) {
  const vazio = $('chat-historico').querySelector('.vazio')
  if (vazio) vazio.remove()

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
      item.textContent = `↩ ideia: ${ideia.titulo}`
      item.addEventListener('click', () => {
        $('filtro-texto').value = ideia.titulo
        renderIdeias()
        document.querySelector(`[data-ideia="${ideia.id}"]`)?.scrollIntoView({ block: 'center' })
      })
      refs.append(item)
    }

    for (const trecho of opcoes.trechos ?? []) {
      const item = document.createElement('button')
      item.className = 'referencia'
      item.textContent = `${trecho.arquivo}:${trecho.linha} — ${trecho.texto.slice(0, 90)}`
      item.title = 'clique para copiar o caminho'
      item.addEventListener('click', async () => {
        await navigator.clipboard.writeText(`${trecho.arquivo}:${trecho.linha}`)
        avisar(`Copiado: ${trecho.arquivo}:${trecho.linha}`)
      })
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
    const resultado = await api('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ pergunta, historico: historicoChat }),
    })
    adicionarMensagem('orientador', resultado.texto, resultado)
    historicoChat.push({ role: 'user', content: pergunta }, { role: 'assistant', content: resultado.texto })
    await carregar()
  } catch (erro) {
    adicionarMensagem('orientador', `Erro: ${erro.message}`)
  } finally {
    botao.disabled = false
    botao.textContent = 'Perguntar'
    campo.focus()
  }
})

// -------------------------------------------------------------- ideias

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

function ideiasFiltradas() {
  const texto = $('filtro-texto').value.trim().toLowerCase()
  const visao = $('filtro-visao').value

  return estado.ideias
    .filter((i) => {
      if (visao === 'projeto' && !i.projeto) return false
      if (visao === 'alta' && i.importancia !== 'alta') return false
      if (visao === 'sessao' && i.sessaoId !== estado.sessaoAtivaId) return false
      if (!texto) return true
      const alvo = `${i.titulo} ${i.corpo} ${i.area} ${(i.tags ?? []).join(' ')}`.toLowerCase()
      return alvo.includes(texto)
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

function renderIdeias() {
  const lista = $('lista-ideias')
  const ideias = ideiasFiltradas()
  $('contador-ideias').textContent = `${estado.ideias.length} ideia${estado.ideias.length === 1 ? '' : 's'}`

  if (ideias.length === 0) {
    lista.innerHTML = '<div class="vazio">Nada aqui ainda. Registre a primeira ideia acima.</div>'
    return
  }

  lista.innerHTML = ''
  for (const ideia of ideias) {
    const bloco = document.createElement('div')
    bloco.dataset.ideia = ideia.id
    const classes = ['ideia']
    if (ideia.projeto) classes.push('projeto')
    if (ideia.importancia === 'alta') classes.push('alta')
    if (ideia.status === 'descartada') classes.push('descartada')
    bloco.className = classes.join(' ')

    const etiquetas = []
    if (ideia.area) etiquetas.push(`<span class="etiqueta area">${esc(ideia.area)}</span>`)
    etiquetas.push(`<span class="etiqueta">${ROTULO[ideia.importancia] ?? ideia.importancia}</span>`)
    for (const tag of ideia.tags ?? []) etiquetas.push(`<span class="etiqueta">${esc(tag)}</span>`)
    if (ideia.origem) etiquetas.push(`<span class="etiqueta origem">${esc(ideia.origem)}</span>`)
    if (ideia.projeto) etiquetas.push('<span class="etiqueta">vale para meus projetos</span>')

    bloco.innerHTML = `
      <div class="ideia-titulo"><span>${esc(ideia.titulo)}</span></div>
      ${ideia.corpo ? `<div class="ideia-corpo">${esc(ideia.corpo)}</div>` : ''}
      <div class="ideia-meta">${etiquetas.join('')}</div>
      <div class="ideia-acoes"></div>`

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

// ------------------------------------------------------------- sessoes

function renderSessoes() {
  const lista = $('lista-sessoes')
  const sessoes = estado.sessoes.slice().reverse()

  if (sessoes.length === 0) {
    lista.innerHTML = '<div class="vazio">Nenhuma sessão ainda. Inicie uma no topo.</div>'
    return
  }

  lista.innerHTML = ''
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
          mostrarResumo(sessao.resumo, markdown)
        } catch (erro) {
          avisar(erro.message, true)
        }
      })
    } else {
      item.style.cursor = 'default'
    }
    lista.append(item)
  }
}

function mostrarResumo(nome, markdown) {
  $('resumo-area').hidden = false
  $('resumo-titulo').textContent = nome
  $('resumo-conteudo').textContent = markdown
}

$('btn-fechar-resumo').addEventListener('click', () => {
  $('resumo-area').hidden = true
})

carregar().catch((erro) => avisar(`Falha ao carregar: ${erro.message}`, true))
