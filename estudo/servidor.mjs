#!/usr/bin/env node
/**
 * Ambiente de estudo do DeepSeek Harness.
 *
 * Servidor HTTP local, sem dependencias externas, que sustenta tres coisas:
 *   1. o registro de ideias (bons habitos, tecnicas e decisoes que valem para projetos);
 *   2. o chat de duvidas, respostas e orientacoes rapidas;
 *   3. o resumo de fim de sessao de estudos.
 *
 * Rode com: node estudo/servidor.mjs
 */

import { createServer } from 'node:http'
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname, extname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

// ---------------------------------------------------------------- caminhos

const BASE = dirname(fileURLToPath(import.meta.url))
const RAIZ_REPO = resolve(BASE, '..')
const PASTA_DADOS = join(BASE, 'dados')
const ARQ_ESTADO = join(PASTA_DADOS, 'estado.json')
const PASTA_SESSOES = join(PASTA_DADOS, 'sessoes')
const PASTA_PUBLICA = join(BASE, 'publico')

const PORTA = Number(process.env.PORTA_ESTUDO ?? 4321)
const HOST = '127.0.0.1'

/** Fontes varridas pelo buscador do chat. Caminhos relativos a raiz do repo. */
const FONTES_BUSCA = ['docs', 'AGENTS.md', 'README.md', 'packages']

/** Peso de relevancia por pasta: quanto maior, mais alto o resultado aparece. */
const PESO_FONTE = {
  'AGENTS.md': 6,
  README: 5,
  docs: 4,
  packages: 2,
}

// ---------------------------------------------------------------- utilidades

/** Remove acentos e caixa para comparacao. */
function normalizar(texto) {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/**
 * Quebra a consulta em termos pesquisaveis.
 *
 * Hifen e underline ficam dentro do termo, porque neste repositorio o nome
 * composto e que identifica a coisa ("agent-loop", "capability-seam"). O termo
 * composto pesa mais que cada pedaco solto.
 *
 * @param {string} consulta Texto da pergunta.
 * @returns {{texto: string, peso: number}[]} Termos com seus pesos.
 */
function tokenizar(consulta) {
  const compostos = normalizar(consulta)
    .split(/[^\p{L}\p{N}\-_]+/u)
    .map((termo) => termo.replace(/^[-_]+|[-_]+$/g, ''))
    .filter((termo) => termo.length > 2)

  const porPeso = new Map()
  for (const composto of compostos) {
    porPeso.set(composto, 3)
    for (const parte of composto.split(/[-_]/)) {
      if (parte.length > 2 && !porPeso.has(parte)) porPeso.set(parte, 1)
    }
  }
  return [...porPeso].map(([texto, peso]) => ({ texto, peso }))
}

/** Escreve JSON de forma atomica o suficiente para uso local. */
async function gravarJson(caminho, valor) {
  await mkdir(dirname(caminho), { recursive: true })
  await writeFile(caminho, `${JSON.stringify(valor, null, 2)}\n`, 'utf8')
}

/** Estado inicial do ambiente. */
function estadoInicial() {
  return {
    versao: 1,
    sessoes: [],
    ideias: [],
    sessaoAtivaId: null,
  }
}

async function lerEstado() {
  if (!existsSync(ARQ_ESTADO)) return estadoInicial()
  try {
    const bruto = JSON.parse(await readFile(ARQ_ESTADO, 'utf8'))
    return { ...estadoInicial(), ...bruto }
  } catch (erro) {
    throw new Error(`estado.json ilegivel: ${erro.message}`)
  }
}

async function salvarEstado(estado) {
  await gravarJson(ARQ_ESTADO, estado)
  return estado
}

/** Sessao em andamento, ou undefined. */
function sessaoAtiva(estado) {
  return estado.sessoes.find((s) => s.id === estado.sessaoAtivaId)
}

// ---------------------------------------------------------------- busca

/** Indice em memoria: um registro por arquivo, nao por linha. */
let indice = null

/** Coleta recursivamente arquivos de texto sob um diretorio. */
async function coletarArquivos(caminho, acumulado) {
  let itens
  try {
    itens = await readdir(caminho, { withFileTypes: true })
  } catch {
    return
  }
  for (const item of itens) {
    if (item.name === 'node_modules' || item.name === '.git' || item.name === 'lib') continue
    const filho = join(caminho, item.name)
    if (item.isDirectory()) {
      await coletarArquivos(filho, acumulado)
    } else if (['.md', '.ts', '.mjs', '.js', '.json'].includes(extname(item.name))) {
      acumulado.push(filho)
    }
  }
}

/** Monta (ou reaproveita) o indice dos arquivos pesquisaveis. */
async function obterIndice() {
  if (indice) return indice

  const arquivos = []
  for (const fonte of FONTES_BUSCA) {
    const alvo = join(RAIZ_REPO, fonte)
    if (!existsSync(alvo)) continue
    const irmaos = await readdir(dirname(alvo), { withFileTypes: true })
    const entrada = irmaos.find((e) => e.name === fonte)
    if (entrada?.isDirectory()) await coletarArquivos(alvo, arquivos)
    else arquivos.push(alvo)
  }

  const documentos = []
  for (const arquivo of arquivos) {
    let conteudo
    try {
      conteudo = await readFile(arquivo, 'utf8')
    } catch {
      continue
    }
    const relativo = relative(RAIZ_REPO, arquivo).split('\\').join('/')
    let peso = 1
    for (const [chave, valor] of Object.entries(PESO_FONTE)) {
      if (relativo === chave || relativo.startsWith(`${chave}/`)) peso = valor
    }
    documentos.push({ arquivo: relativo, peso, texto: conteudo, normalizado: normalizar(conteudo) })
  }

  indice = { documentos }
  return indice
}

/**
 * Busca por termos no repositorio e no registro de ideias.
 * @param {string} consulta Texto da pergunta.
 * @param {object} estado Estado atual, para incluir as ideias.
 * @returns {Promise<{trechos: object[], ideias: object[], totalArquivos: number}>}
 */
async function buscar(consulta, estado) {
  const termos = tokenizar(consulta)

  if (termos.length === 0) return { trechos: [], ideias: [], totalArquivos: 0 }

  const { documentos } = await obterIndice()

  // Uma passada pelos arquivos: descobre quais termos cada um contem e, de
  // quebra, em quantos arquivos cada termo aparece.
  const frequencia = new Map(termos.map((termo) => [termo.texto, 0]))
  const candidatos = []
  for (const documento of documentos) {
    const encontrados = termos.filter((termo) => documento.normalizado.includes(termo.texto))
    if (encontrados.length === 0) continue
    for (const termo of encontrados) frequencia.set(termo.texto, frequencia.get(termo.texto) + 1)
    candidatos.push({ documento, encontrados })
  }

  // Termo raro vale muito mais que termo comum: "agent-loop" decide a busca,
  // "modelo" quase nao pesa.
  const raridade = (termo) => 1 / Math.log(2 + (frequencia.get(termo) ?? 0))

  const pontuados = candidatos.map(({ documento, encontrados }) => {
    let pontos = 0
    for (const termo of encontrados) pontos += raridade(termo.texto) * termo.peso * 10
    // Casar mais termos da pergunta vale mais que casar um so, por mais raro que seja.
    pontos += encontrados.length * 8
    pontos += documento.peso
    const caminho = normalizar(documento.arquivo)
    for (const termo of encontrados) if (caminho.includes(termo.texto)) pontos += 6
    // A copia em chines duplica todo documento; sem pergunta em chines ela so atrapalha.
    if (documento.arquivo.includes('.zh.') && !/[\u4e00-\u9fff]/u.test(consulta)) pontos -= 8
    return { documento, encontrados, pontos }
  })
  pontuados.sort((a, b) => b.pontos - a.pontos)

  // So entao desce ao nivel da linha, nos arquivos que passaram.
  const trechos = []
  for (const { documento, encontrados, pontos } of pontuados) {
    const linhas = documento.texto.split('\n')
    const normalizadas = documento.normalizado.split('\n')
    let achados = 0
    for (let i = 0; i < linhas.length && achados < 2; i += 1) {
      const limpo = linhas[i].trim()
      if (limpo.length < 8) continue
      const alvo = normalizadas[i] ?? ''
      let acertos = 0
      for (const termo of encontrados) if (alvo.includes(termo.texto)) acertos += 1
      if (acertos === 0) continue
      trechos.push({ arquivo: documento.arquivo, linha: i + 1, texto: limpo, pontos })
      achados += 1
    }
    if (trechos.length >= 12) break
  }

  const ideias = estado.ideias
    .map((ideia) => {
      const alvo = normalizar(`${ideia.titulo} ${ideia.corpo} ${(ideia.tags ?? []).join(' ')} ${ideia.area ?? ''}`)
      let pontos = 0
      for (const termo of termos) {
        if (alvo.includes(termo.texto)) pontos += raridade(termo.texto) * termo.peso + 0.5
      }
      return { ideia, pontos }
    })
    .filter((x) => x.pontos > 0)
    .sort((a, b) => b.pontos - a.pontos)
    .map((x) => x.ideia)

  return { trechos, ideias: ideias.slice(0, 8), totalArquivos: documentos.length }
}

// ---------------------------------------------------------------- chat

const SISTEMA_CHAT = `Voce e um orientador de estudo do codigo do DeepSeek Harness.
Responda em portugues do Brasil, curto e direto, sem enrolacao e sem jargao desnecessario.
Baseie a resposta nos trechos do repositorio fornecidos. Cite arquivo e linha quando usar um trecho.
Se os trechos nao bastarem, diga o que falta em vez de inventar.`

/** Chamada ao modelo, quando ha chave configurada. */
async function responderComModelo(pergunta, trechos, ideias, historico) {
  const chave = process.env.DEEPSEEK_API_KEY
  const base = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com'
  const modelo = process.env.DEEPSEEK_MODELO ?? 'deepseek-chat'

  const contextoRepositorio = trechos
    .map((t) => `${t.arquivo}:${t.linha} — ${t.texto}`)
    .join('\n')
  const contextoIdeias = ideias.map((i) => `- ${i.titulo}: ${i.corpo}`).join('\n')

  const mensagens = [
    { role: 'system', content: SISTEMA_CHAT },
    {
      role: 'user',
      content: [
        'Trechos do repositorio:',
        contextoRepositorio || '(nenhum trecho encontrado)',
        '',
        'Ideias ja registradas por mim:',
        contextoIdeias || '(nenhuma)',
      ].join('\n'),
    },
    ...historico.slice(-6),
    { role: 'user', content: pergunta },
  ]

  const resposta = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${chave}` },
    body: JSON.stringify({ model: modelo, messages: mensagens, temperature: 0.2 }),
  })

  if (!resposta.ok) {
    throw new Error(`API respondeu ${resposta.status}: ${(await resposta.text()).slice(0, 300)}`)
  }
  const dados = await resposta.json()
  return dados.choices?.[0]?.message?.content ?? '(resposta vazia)'
}

/**
 * Responde uma pergunta do chat.
 * Sem DEEPSEEK_API_KEY, devolve as orientacoes montadas a partir do que ja
 * esta registrado e dos trechos encontrados, sem inventar resposta.
 */
async function responderChat(pergunta, estado, historico = []) {
  const { trechos, ideias, totalArquivos } = await buscar(pergunta, estado)

  if (process.env.DEEPSEEK_API_KEY) {
    try {
      const texto = await responderComModelo(pergunta, trechos, ideias, historico)
      return { modo: 'modelo', texto, trechos, ideias }
    } catch (erro) {
      return {
        modo: 'erro-modelo',
        texto: `Nao consegui falar com o modelo: ${erro.message}\n\nSegue o que achei no repositorio e no seu registro.`,
        trechos,
        ideias,
      }
    }
  }

  const partes = []
  if (ideias.length > 0) {
    partes.push('Do seu registro:')
    for (const ideia of ideias) partes.push(`• ${ideia.titulo} — ${ideia.corpo}`)
    partes.push('')
  }
  if (trechos.length > 0) {
    partes.push(`No repositorio (${trechos.length} de ${totalArquivos} arquivos varridos):`)
    for (const t of trechos) partes.push(`• ${t.arquivo}:${t.linha} — ${t.texto}`)
  }
  if (partes.length === 0) {
    partes.push('Nao achei nada com esses termos. Tente outras palavras ou registre a ideia na mao.')
  }
  partes.push('')
  partes.push(
    '(modo local: sem DEEPSEEK_API_KEY eu so mostro o que existe, nao respondo por conta propria. ' +
      'Os documentos do repositorio sao em ingles: termos em ingles acertam bem mais.)',
  )

  return { modo: 'local', texto: partes.join('\n'), trechos, ideias }
}

// ---------------------------------------------------------------- resumo

const ROTULO_IMPORTANCIA = { alta: 'Alta', media: 'Media', baixa: 'Baixa' }

/** Monta o markdown de resumo de uma sessao encerrada. */
function montarResumo(sessao, ideias) {
  const linhas = []
  const inicio = new Date(sessao.iniciadaEm)
  const fim = new Date(sessao.encerradaEm)
  const minutos = Math.max(1, Math.round((fim - inicio) / 60000))

  linhas.push(`# Sessao de estudos — ${sessao.titulo}`)
  linhas.push('')
  linhas.push(`- Inicio: ${inicio.toLocaleString('pt-BR')}`)
  linhas.push(`- Fim: ${fim.toLocaleString('pt-BR')}`)
  linhas.push(`- Duracao: ${minutos} min`)
  linhas.push(`- Ideias registradas: ${ideias.length}`)
  linhas.push(`- Perguntas feitas: ${(sessao.perguntas ?? []).length}`)
  linhas.push('')

  const paraProjeto = ideias.filter((i) => i.projeto)
  linhas.push('## Vale para meus projetos')
  linhas.push('')
  if (paraProjeto.length === 0) {
    linhas.push('_Nada marcado nesta sessao._')
  } else {
    for (const ideia of paraProjeto) {
      linhas.push(`### ${ideia.titulo}`)
      linhas.push('')
      linhas.push(ideia.corpo)
      linhas.push('')
      const meta = []
      if (ideia.area) meta.push(`area: ${ideia.area}`)
      if (ideia.importancia) meta.push(`importancia: ${ROTULO_IMPORTANCIA[ideia.importancia] ?? ideia.importancia}`)
      if ((ideia.tags ?? []).length) meta.push(`tags: ${ideia.tags.join(', ')}`)
      if (ideia.origem) meta.push(`origem: ${ideia.origem}`)
      if (meta.length) linhas.push(`_${meta.join(' · ')}_`)
      linhas.push('')
    }
  }

  const resto = ideias.filter((i) => !i.projeto)
  if (resto.length > 0) {
    linhas.push('## Outras ideias da sessao')
    linhas.push('')
    for (const ideia of resto) {
      linhas.push(`- **${ideia.titulo}** — ${ideia.corpo}`)
    }
    linhas.push('')
  }

  if ((sessao.perguntas ?? []).length > 0) {
    linhas.push('## Perguntas da sessao')
    linhas.push('')
    for (const p of sessao.perguntas) {
      linhas.push(`**${p.pergunta}**`)
      linhas.push('')
      linhas.push(p.resposta.split('\n').map((l) => `> ${l}`).join('\n'))
      linhas.push('')
    }
  }

  return `${linhas.join('\n').trimEnd()}\n`
}

// ---------------------------------------------------------------- HTTP

async function lerCorpo(req) {
  const pedacos = []
  for await (const pedaco of req) pedacos.push(pedaco)
  if (pedacos.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(pedacos).toString('utf8'))
  } catch {
    throw new Error('corpo nao e JSON valido')
  }
}

function responderJson(res, status, dados) {
  const corpo = JSON.stringify(dados)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(corpo)
}

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
}

async function servirEstatico(res, caminho) {
  const arquivo = join(PASTA_PUBLICA, caminho === '/' ? 'index.html' : caminho.slice(1))
  if (!resolve(arquivo).startsWith(PASTA_PUBLICA)) {
    res.writeHead(403).end('fora da pasta publica')
    return
  }
  try {
    const conteudo = await readFile(arquivo)
    res.writeHead(200, { 'content-type': TIPOS[extname(arquivo)] ?? 'application/octet-stream' })
    res.end(conteudo)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('nao encontrado')
  }
}

const servidor = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORTA}`)
  const rota = url.pathname

  try {
    // --- estado geral -------------------------------------------------
    if (rota === '/api/estado' && req.method === 'GET') {
      const estado = await lerEstado()
      return responderJson(res, 200, {
        ...estado,
        modoChat: process.env.DEEPSEEK_API_KEY ? 'modelo' : 'local',
        raizRepo: RAIZ_REPO,
      })
    }

    // --- sessoes ------------------------------------------------------
    if (rota === '/api/sessoes/iniciar' && req.method === 'POST') {
      const estado = await lerEstado()
      if (sessaoAtiva(estado)) return responderJson(res, 409, { erro: 'ja existe sessao aberta' })
      const { titulo } = await lerCorpo(req)
      const sessao = {
        id: randomUUID(),
        titulo: (titulo ?? '').trim() || `Estudo de ${new Date().toLocaleDateString('pt-BR')}`,
        iniciadaEm: new Date().toISOString(),
        encerradaEm: null,
        resumo: null,
        perguntas: [],
      }
      estado.sessoes.push(sessao)
      estado.sessaoAtivaId = sessao.id
      await salvarEstado(estado)
      return responderJson(res, 200, { sessao })
    }

    if (rota === '/api/sessoes/encerrar' && req.method === 'POST') {
      const estado = await lerEstado()
      const sessao = sessaoAtiva(estado)
      if (!sessao) return responderJson(res, 409, { erro: 'nenhuma sessao aberta' })

      sessao.encerradaEm = new Date().toISOString()
      const ideias = estado.ideias.filter((i) => i.sessaoId === sessao.id)
      const markdown = montarResumo(sessao, ideias)

      const marca = sessao.encerradaEm.replace(/[:.]/g, '-').slice(0, 16)
      const nome = `${marca}-${sessao.id.slice(0, 8)}.md`
      await mkdir(PASTA_SESSOES, { recursive: true })
      await writeFile(join(PASTA_SESSOES, nome), markdown, 'utf8')

      sessao.resumo = nome
      estado.sessaoAtivaId = null
      await salvarEstado(estado)
      return responderJson(res, 200, { sessao, markdown })
    }

    if (rota === '/api/sessoes' && req.method === 'GET') {
      const estado = await lerEstado()
      return responderJson(res, 200, { sessoes: estado.sessoes.slice().reverse() })
    }

    const casouResumo = rota.match(/^\/api\/sessoes\/([\w.-]+)$/)
    if (casouResumo && req.method === 'GET') {
      const arquivo = join(PASTA_SESSOES, casouResumo[1])
      if (!resolve(arquivo).startsWith(PASTA_SESSOES)) return responderJson(res, 403, { erro: 'caminho invalido' })
      try {
        const markdown = await readFile(arquivo, 'utf8')
        return responderJson(res, 200, { markdown })
      } catch {
        return responderJson(res, 404, { erro: 'resumo nao encontrado' })
      }
    }

    // --- ideias -------------------------------------------------------
    if (rota === '/api/ideias' && req.method === 'POST') {
      const estado = await lerEstado()
      const corpo = await lerCorpo(req)
      if (!corpo.titulo?.trim()) return responderJson(res, 400, { erro: 'titulo obrigatorio' })

      const agora = new Date().toISOString()
      const ideia = {
        id: randomUUID(),
        criadaEm: agora,
        atualizadaEm: agora,
        sessaoId: estado.sessaoAtivaId,
        titulo: corpo.titulo.trim(),
        corpo: (corpo.corpo ?? '').trim(),
        tags: (corpo.tags ?? []).map((t) => String(t).trim()).filter(Boolean),
        area: (corpo.area ?? '').trim(),
        importancia: ['alta', 'media', 'baixa'].includes(corpo.importancia) ? corpo.importancia : 'media',
        projeto: Boolean(corpo.projeto),
        origem: (corpo.origem ?? '').trim(),
        status: 'aberta',
      }
      estado.ideias.push(ideia)
      await salvarEstado(estado)
      return responderJson(res, 200, { ideia })
    }

    const casouIdeia = rota.match(/^\/api\/ideias\/([\w-]+)$/)
    if (casouIdeia) {
      const estado = await lerEstado()
      const indiceIdeia = estado.ideias.findIndex((i) => i.id === casouIdeia[1])
      if (indiceIdeia === -1) return responderJson(res, 404, { erro: 'ideia nao encontrada' })

      if (req.method === 'PATCH') {
        const corpo = await lerCorpo(req)
        const atual = estado.ideias[indiceIdeia]
        estado.ideias[indiceIdeia] = {
          ...atual,
          ...corpo,
          id: atual.id,
          criadaEm: atual.criadaEm,
          sessaoId: atual.sessaoId,
          atualizadaEm: new Date().toISOString(),
        }
        await salvarEstado(estado)
        return responderJson(res, 200, { ideia: estado.ideias[indiceIdeia] })
      }

      if (req.method === 'DELETE') {
        const [removida] = estado.ideias.splice(indiceIdeia, 1)
        await salvarEstado(estado)
        return responderJson(res, 200, { ideia: removida })
      }
    }

    // --- chat ---------------------------------------------------------
    if (rota === '/api/chat' && req.method === 'POST') {
      const { pergunta, historico } = await lerCorpo(req)
      if (!pergunta?.trim()) return responderJson(res, 400, { erro: 'pergunta obrigatoria' })

      const estado = await lerEstado()
      const resultado = await responderChat(pergunta.trim(), estado, historico ?? [])

      const sessao = sessaoAtiva(estado)
      if (sessao) {
        sessao.perguntas.push({
          em: new Date().toISOString(),
          pergunta: pergunta.trim(),
          resposta: resultado.texto,
        })
        await salvarEstado(estado)
      }
      return responderJson(res, 200, resultado)
    }

    if (rota === '/api/buscar' && req.method === 'GET') {
      const estado = await lerEstado()
      const resultado = await buscar(url.searchParams.get('q') ?? '', estado)
      return responderJson(res, 200, resultado)
    }

    // --- estatico -----------------------------------------------------
    return servirEstatico(res, rota)
  } catch (erro) {
    responderJson(res, 500, { erro: erro.message })
  }
})

servidor.listen(PORTA, HOST, async () => {
  const estado = await lerEstado()
  const { documentos } = await obterIndice()
  console.log(`Ambiente de estudo no ar: http://${HOST}:${PORTA}`)
  console.log(`Repositorio: ${RAIZ_REPO}`)
  console.log(`Indice do chat: ${documentos.length} arquivos`)
  console.log(`Ideias registradas: ${estado.ideias.length}`)
  console.log(`Chat: ${process.env.DEEPSEEK_API_KEY ? 'com modelo' : 'modo local (sem DEEPSEEK_API_KEY)'}`)
})
