#!/usr/bin/env node
/**
 * Ambiente de estudo do DeepSeek Harness.
 *
 * Servidor HTTP local, sem dependencias externas, que sustenta tres coisas:
 *   1. o navegador de codigo do repositorio (arvore, busca por nome, leitor);
 *   2. o registro de ideias (bons habitos, tecnicas e decisoes que valem para projetos);
 *   3. o resumo de fim de sessao de estudos.
 *
 * Rode com: node estudo/servidor.mjs
 */

import { createServer } from 'node:http'
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname, extname, resolve, relative, sep } from 'node:path'
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

// ---------------------------------------------------------------- utilidades

/** Remove acentos e caixa para comparacao. */
function normalizar(texto) {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
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

// ----------------------------------------------------------- arquivos do repo

/** Indice em memoria: so os caminhos, porque o conteudo e lido sob demanda. */
let indice = null

/** Nomes que ficam de fora do explorador e do indice. */
const IGNORADOS = new Set(['.git', 'node_modules', 'lib', 'coverage', '.cache'])

/** Teto de seguranca: nunca varre alem disto, aconteca o que acontecer. */
const LIMITE_INDICE = 20000

/**
 * Coleta recursivamente os caminhos de arquivo sob um diretorio.
 *
 * A unica trava e o teto de arquivos: sem reparse points na arvore nao ha como
 * recursar sem fim, e o teto segura qualquer caso que apareca no futuro.
 *
 * @param {string} caminho Diretorio absoluto de partida.
 * @param {string[]} acumulado Lista de caminhos relativos ao repositorio.
 */
async function coletarArquivos(caminho, acumulado) {
  if (acumulado.length >= LIMITE_INDICE) return

  let itens
  try {
    itens = await readdir(caminho, { withFileTypes: true })
  } catch {
    return
  }
  for (const item of itens) {
    if (acumulado.length >= LIMITE_INDICE) return
    if (IGNORADOS.has(item.name)) continue
    const filho = join(caminho, item.name)
    if (item.isDirectory()) {
      await coletarArquivos(filho, acumulado)
    } else {
      acumulado.push(relative(RAIZ_REPO, filho).split('\\').join('/'))
    }
  }
}

/** Lista os arquivos do repositorio, do caminho mais curto para o mais longo. */
async function obterIndice() {
  if (!indice) {
    const arquivos = []
    await coletarArquivos(RAIZ_REPO, arquivos)
    // Caminho curto primeiro: costuma ser o arquivo principal, nao um teste fundo.
    arquivos.sort((a, b) => a.length - b.length || a.localeCompare(b, 'pt-BR'))
    indice = { arquivos }
  }
  return indice
}

// ---------------------------------------------------------------- resumo

/**
 * Monta o markdown de resumo de uma sessao encerrada.
 * @param {object} sessao Sessao encerrada.
 * @param {object[]} ideias Ideias registradas dentro dela.
 * @returns {string} Markdown.
 */
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
  linhas.push('')

  linhas.push('## Ideias da sessao')
  linhas.push('')

  if (ideias.length === 0) {
    linhas.push('_Nenhuma ideia registrada nesta sessao._')
    linhas.push('')
  }

  for (const ideia of ideias) {
    linhas.push(`### ${ideia.titulo}`)
    linhas.push('')
    if (ideia.corpo) {
      linhas.push(ideia.corpo)
      linhas.push('')
    }
    if (ideia.origem) {
      linhas.push(`_origem: ${ideia.origem}_`)
      linhas.push('')
    }
  }

  return `${linhas.join('\n').trimEnd()}\n`
}

// ---------------------------------------------------------------- arquivos

/** Teto de tamanho para o leitor abrir um arquivo. */
const LIMITE_LEITURA = 400_000

/** Resolve um caminho relativo ao repositorio, recusando o que sai dele. */
function resolverNoRepo(relativo) {
  const alvo = resolve(RAIZ_REPO, relativo || '.')
  if (alvo !== RAIZ_REPO && !alvo.startsWith(RAIZ_REPO + sep)) {
    throw new Error('caminho fora do repositorio')
  }
  return alvo
}

/**
 * Diz, em uma palavra, que tipo de arquivo e este.
 * Serve para quem nao le codigo saber o que esta olhando.
 */
function classificarArquivo(caminho) {
  const nome = caminho.split('/').pop() ?? ''
  if (nome === 'AGENTS.md' || nome === 'CLAUDE.md' || nome === 'CONTRIBUTING.md') return 'regras'
  if (/\.(spec|test|e2e)\./.test(nome) || caminho.includes('/tests/') || caminho.includes('/test/')) return 'teste'
  if (nome.endsWith('.md')) return 'documentacao'
  if (/\.(json|ya?ml|toml)$/.test(nome) || nome.startsWith('tsconfig') || nome.startsWith('.oxlint')) return 'configuracao'
  if (/\.(ts|mjs|js|tsx)$/.test(nome)) return 'codigo'
  return 'outro'
}

/** Lista um diretorio do repositorio, pastas primeiro. */
async function listarDiretorio(relativo) {
  const alvo = resolverNoRepo(relativo)
  const itens = await readdir(alvo, { withFileTypes: true })

  const pastas = []
  const arquivos = []
  for (const item of itens) {
    if (IGNORADOS.has(item.name)) continue
    const caminho = relativo ? `${relativo}/${item.name}` : item.name
    if (item.isDirectory()) {
      pastas.push({ nome: item.name, caminho, tipo: 'pasta' })
    } else {
      arquivos.push({
        nome: item.name,
        caminho,
        tipo: 'arquivo',
        classe: classificarArquivo(caminho),
        extensao: extname(item.name).replace('.', ''),
      })
    }
  }

  const porNome = (a, b) => a.nome.localeCompare(b.nome, 'pt-BR')
  pastas.sort(porNome)
  arquivos.sort(porNome)

  const pai = relativo.includes('/') ? relativo.slice(0, relativo.lastIndexOf('/')) : ''
  return { caminho: relativo, pai, pastas, arquivos }
}

/** Le um arquivo de texto do repositorio. */
async function lerArquivoDoRepo(relativo) {
  const alvo = resolverNoRepo(relativo)
  const info = await stat(alvo)
  if (!info.isFile()) throw new Error('nao e um arquivo')
  if (info.size > LIMITE_LEITURA) {
    throw new Error(`arquivo grande demais para o leitor (${Math.round(info.size / 1024)} KB)`)
  }
  const conteudo = await readFile(alvo, 'utf8')
  // Byte nulo e sinal de arquivo binario: nao ha o que ler como texto.
  if (conteudo.slice(0, 8000).includes('\u0000')) {
    throw new Error('isto e um arquivo binario, nao da para mostrar como texto')
  }
  return {
    caminho: relativo,
    classe: classificarArquivo(relativo),
    tamanho: info.size,
    linhas: conteudo.split('\n').length,
    conteudo,
  }
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
      return responderJson(res, 200, { ...estado, raizRepo: RAIZ_REPO })
    }

    // --- explorador de codigo -----------------------------------------
    if (rota === '/api/arvore' && req.method === 'GET') {
      return responderJson(res, 200, await listarDiretorio(url.searchParams.get('caminho') ?? ''))
    }

    if (rota === '/api/arquivo' && req.method === 'GET') {
      const caminho = url.searchParams.get('caminho') ?? ''
      if (!caminho) return responderJson(res, 400, { erro: 'caminho obrigatorio' })
      return responderJson(res, 200, await lerArquivoDoRepo(caminho))
    }

    if (rota === '/api/procurar' && req.method === 'GET') {
      const termo = normalizar(url.searchParams.get('q') ?? '')
      if (termo.length < 2) return responderJson(res, 200, { resultados: [] })

      const { arquivos } = await obterIndice()
      const resultados = arquivos
        .filter((caminho) => normalizar(caminho).includes(termo))
        .map((caminho) => ({ caminho, classe: classificarArquivo(caminho) }))
        .slice(0, 60)

      return responderJson(res, 200, { resultados })
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

    // --- estatico -----------------------------------------------------
    return servirEstatico(res, rota)
  } catch (erro) {
    responderJson(res, 500, { erro: erro.message })
  }
})

servidor.listen(PORTA, HOST, async () => {
  const estado = await lerEstado()
  console.log(`Ambiente de estudo no ar: http://${HOST}:${PORTA}`)
  console.log(`PID deste servidor: ${process.pid}`)
  console.log(`Repositorio: ${RAIZ_REPO}`)
  console.log(`Ideias registradas: ${estado.ideias.length}`)
})
