'use strict'

/**
 * Escapa texto para insercao em HTML.
 * @param {unknown} texto Valor a escapar.
 * @returns {string} Texto seguro para interpolar em HTML.
 */
function esc(texto) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Converte markdown simples em HTML: titulos, listas, citacao, tabela, bloco de
 * codigo e enfase. Cobre o que aparece na documentacao deste repositorio, e nada
 * alem disso — nao e um formatador completo.
 *
 * @param {string} texto Markdown de entrada, sem escapar.
 * @returns {string} HTML.
 */
function formatarMarkdown(texto) {
  const linhas = esc(texto).split('\n')
  const saida = []
  let dentroDeCodigo = false
  let listaAberta = false
  let tabela = []

  const inline = (t) =>
    t
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|\s)\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')

  const fecharLista = () => {
    if (!listaAberta) return
    saida.push('</ul>')
    listaAberta = false
  }

  const soltarTabela = () => {
    if (tabela.length === 0) return
    // Descarta a linha de separacao (|---|---|).
    const uteis = tabela.filter((l) => !/^\s*\|?[\s:|-]+\|?\s*$/.test(l))
    const celulas = (l) =>
      l
        .replace(/^\s*\|/, '')
        .replace(/\|\s*$/, '')
        .split('|')
        .map((c) => c.trim())

    if (uteis.length === 0) {
      tabela = []
      return
    }
    const [cabecalho, ...corpo] = uteis
    saida.push('<table><thead><tr>')
    for (const c of celulas(cabecalho)) saida.push(`<th>${inline(c)}</th>`)
    saida.push('</tr></thead><tbody>')
    for (const linha of corpo) {
      saida.push('<tr>')
      for (const c of celulas(linha)) saida.push(`<td>${inline(c)}</td>`)
      saida.push('</tr>')
    }
    saida.push('</tbody></table>')
    tabela = []
  }

  for (const linha of linhas) {
    if (linha.trim().startsWith('```')) {
      fecharLista()
      soltarTabela()
      saida.push(dentroDeCodigo ? '</code></pre>' : '<pre><code>')
      dentroDeCodigo = !dentroDeCodigo
      continue
    }
    if (dentroDeCodigo) {
      saida.push(linha)
      continue
    }

    if (linha.trim().startsWith('|') && linha.includes('|')) {
      fecharLista()
      tabela.push(linha)
      continue
    }
    soltarTabela()

    const titulo = linha.match(/^(#{1,4})\s+(.*)$/)
    if (titulo) {
      fecharLista()
      const nivel = titulo[1].length
      saida.push(`<h${nivel}>${inline(titulo[2])}</h${nivel}>`)
      continue
    }

    const item = linha.match(/^\s*[-*]\s+(.*)$/)
    if (item) {
      if (!listaAberta) {
        saida.push('<ul>')
        listaAberta = true
      }
      saida.push(`<li>${inline(item[1])}</li>`)
      continue
    }

    const citacao = linha.match(/^>\s?(.*)$/)
    if (citacao) {
      fecharLista()
      saida.push(`<blockquote>${inline(citacao[1])}</blockquote>`)
      continue
    }

    fecharLista()
    if (linha.trim() === '') continue
    saida.push(`<p>${inline(linha)}</p>`)
  }

  fecharLista()
  soltarTabela()
  const html = saida.join('\n')
  return dentroDeCodigo ? `${html}</code></pre>` : html
}
