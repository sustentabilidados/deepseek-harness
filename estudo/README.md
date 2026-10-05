# Ambiente de estudo — DeepSeek Harness

Espaço de estudo do código do harness, feito para quem **não lê código**. A ideia
é aprender as estratégias em linguagem natural, registrar as que interessam, e
depois cobrar dos modelos de IA se eles realmente usaram aquilo.

**Aqui não tem chat.** As dúvidas e as orientações acontecem na conversa com o
agente de IA. Esta ferramenta faz o outro lado: mostra a estrutura do harness,
guarda o que você decidiu aproveitar, e fecha a sessão com um resumo.

## Rodar

```sh
node estudo/servidor.mjs
```

Abre em <http://127.0.0.1:4321>. Não precisa de `pnpm install`: o servidor usa só
o Node padrão.

Para conferir que está tudo no lugar:

```sh
node estudo/verificar.mjs
```

## As três visões

| Visão | Para quê |
| --- | --- |
| **Estudar** | Navega a estrutura real do harness e lê os arquivos. Markdown sai formatado; o resto sai com número de linha. Comece por **Regras do projeto** (`AGENTS.md`) e por **Documentação**. |
| **Ideias** | O que você quer levar para seus projetos. Cada ideia pode apontar para um arquivo e linha, e a visão geral mostra onde elas se concentram. |
| **Sessões** | Cada sessão encerrada vira um resumo em markdown, com as ideias de projeto em destaque. |

## O gesto principal

Selecione qualquer trecho no leitor. Aparecem dois botões:

- **Registrar ideia deste trecho** — leva o texto para o formulário, já com o
  arquivo e a linha preenchidos.
- **Copiar** — para levar o trecho para a conversa com o agente e perguntar sobre ele.

É assim que o texto do código vira uma técnica no seu registro. Depois, na lista
de ideias, a origem é clicável: volta e abre o arquivo na linha exata.

## O que cada arquivo é

O explorador etiqueta cada arquivo para você saber o que está olhando sem ler nada:

| Etiqueta | Significa |
| --- | --- |
| `REGRAS` | As convenções que este projeto exige de quem mexe nele |
| `DOCUMENTACAO` | Explicação em prosa |
| `CODIGO` | A implementação |
| `TESTE` | Verificação automática |
| `CONFIGURACAO` | Ajustes de ferramenta |

## Onde ficam os dados

- `dados/estado.json` — ideias e sessões.
- `dados/sessoes/*.md` — um resumo por sessão encerrada.

Os dois são versionados: o histórico do estudo viaja com o fork.

## Estrutura

```
estudo/
  servidor.mjs        servidor HTTP, sem dependências
  verificar.mjs       autoteste (markdown, HTML/JS, API)
  publico/
    index.html        as três visões
    estilo.css
    markdown.js       formatador de markdown
    app.js            comportamento
  dados/
    estado.json
    sessoes/
```

## Por que aqui dentro

Esta pasta fica fora dos workspaces do pnpm (`vendor/*`, `packages/*/*`,
`native/system`, `apps/*`, `benchmarks`, `website`, `python/sdk-runtime`), então
não entra em build, lint ou teste do repositório.
