#!/usr/bin/env node
/**
 * Autoteste do ambiente de estudo.
 *
 * Confere o que eu nao consigo ver clicando: se todo id usado no JavaScript
 * existe no HTML, se o formatador de markdown faz o que promete, e se a API
 * responde. Rode com o servidor no ar:
 *
 *   node estudo/servidor.mjs
 *   node estudo/verificar.mjs
 */

import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = dirname(fileURLToPath(import.meta.url))
const PUBLICO = join(BASE, 'publico')
const ENDERECO = `http://127.0.0.1:${process.env.PORTA_ESTUDO ?? 4321}`

let falhas = 0
let passes = 0

/** Registra o resultado de uma verificacao. */
function conferir(nome, condicao, detalhe = '') {
  if (condicao) {
    passes += 1
    console.log(`  ok   ${nome}`)
  } else {
    falhas += 1
    console.log(`  FALHA ${nome}${detalhe ? ` — ${detalhe}` : ''}`)
  }
}

// ------------------------------------------------ 1. markdown

console.log('\n1. Formatador de markdown')

const fonteMarkdown = await readFile(join(PUBLICO, 'markdown.js'), 'utf8')
const { esc, formatarMarkdown } = new Function(`${fonteMarkdown}; return { esc, formatarMarkdown }`)()

conferir('escapa tag', esc('<b>x</b>') === '&lt;b&gt;x&lt;/b&gt;')
conferir('titulo vira h2', formatarMarkdown('## Ola').includes('<h2>Ola</h2>'))
conferir('negrito', formatarMarkdown('texto **forte**').includes('<strong>forte</strong>'))
conferir('codigo inline', formatarMarkdown('use `ctx.effect()`').includes('<code>ctx.effect()</code>'))
conferir('lista', formatarMarkdown('- um\n- dois').includes('<li>dois</li>'))

const tabela = formatarMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |')
conferir('tabela com cabecalho', tabela.includes('<th>a</th>') && tabela.includes('<td>2</td>'))
conferir('tabela descarta separador', !tabela.includes('<td>---</td>'))

const cerca = formatarMarkdown('```\nconst x = 1\n```')
conferir('bloco de codigo', cerca.includes('<pre><code>') && cerca.includes('const x = 1'))

const malicioso = formatarMarkdown('<img src=x onerror=alert(1)>')
conferir('nao injeta HTML da pagina', !malicioso.includes('<img'))

// ------------------------------------------------ 2. ids

console.log('\n2. Ligacao entre HTML e JavaScript')

const html = await readFile(join(PUBLICO, 'index.html'), 'utf8')
const app = await readFile(join(PUBLICO, 'app.js'), 'utf8')

const idsHtml = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]))
const idsUsados = new Set([...app.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]))
const faltando = [...idsUsados].filter((id) => !idsHtml.has(id))

conferir('todo id do JS existe no HTML', faltando.length === 0, faltando.join(', '))
conferir('markdown.js e carregado antes de app.js', html.indexOf('/markdown.js') < html.indexOf('/app.js'))

const visoes = [...html.matchAll(/data-visao="([^"]+)"/g)].map((m) => m[1])
const secoes = new Set([...html.matchAll(/id="visao-([^"]+)"/g)].map((m) => m[1]))
const visoesOrfas = visoes.filter((v) => !secoes.has(v))
conferir('todo botao de menu tem sua secao', visoesOrfas.length === 0, visoesOrfas.join(', '))

// ------------------------------------------------ 3. API

console.log('\n3. API')

async function pegar(caminho) {
  const resposta = await fetch(`${ENDERECO}${caminho}`)
  if (!resposta.ok) throw new Error(`${caminho} -> ${resposta.status}`)
  return resposta.json()
}

try {
  const estado = await pegar('/api/estado')
  conferir('estado responde', Array.isArray(estado.ideias))
  conferir('estado nao expoe mais o chat', estado.modoChat === undefined)

  const raiz = await pegar('/api/arvore')
  conferir('arvore lista pastas', raiz.pastas.length > 0)

  const arquivo = await pegar('/api/arquivo?caminho=AGENTS.md')
  conferir('leitor abre AGENTS.md', arquivo.conteudo.length > 0)
  conferir('AGENTS.md e classificado como regras', arquivo.classe === 'regras')

  const achados = await pegar('/api/procurar?q=sandbox')
  conferir('busca por nome de arquivo acha sandbox', achados.resultados.length > 0)

  const respostaChat = await fetch(`${ENDERECO}/api/chat`, { method: 'POST' })
  conferir('a rota de chat nao existe mais', !respostaChat.ok)

  let travou = false
  try {
    await pegar('/api/arquivo?caminho=../../Windows/win.ini')
  } catch {
    travou = true
  }
  conferir('recusa caminho fora do repositorio', travou)
} catch (erro) {
  falhas += 1
  console.log(`  FALHA o servidor nao respondeu em ${ENDERECO} — ${erro.message}`)
  console.log('        suba o servidor antes: node estudo/servidor.mjs')
}

// ------------------------------------------------ resultado

console.log(`\n${passes} passaram, ${falhas} falharam`)

// Nao usar process.exit(): ele aborta o processo no Windows enquanto o socket
// do fetch ainda esta fechando, e o codigo de saida sai errado.
process.exitCode = falhas === 0 ? 0 : 1
