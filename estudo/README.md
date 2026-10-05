# Ambiente de estudo — DeepSeek Harness

Espaço de estudo do código do harness, feito para quem **não lê código**. A ideia
é aprender as estratégias em linguagem natural, registrar as que interessam, e
depois cobrar dos modelos de IA se eles realmente usaram aquilo.

**Aqui não tem chat.** As dúvidas e o ensino acontecem na conversa com o tutor de
programação. Esta ferramenta faz o outro lado: mostra a estrutura do harness,
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
| **Ideias** | O registro: título e ideia, nada mais. Você organiza aqui o que quer levar para seus projetos. |
| **Sessões** | Cada sessão encerrada vira um resumo em markdown com as ideias registradas nela. |

## Como uma ideia entra

De duas formas, as duas leves:

1. **Você pede ao tutor.** Durante o estudo, diga "anota essa ideia". O tutor
   enxuga, compacta e põe no registro.
2. **Pelo leitor.** Selecione um trecho e use **Registrar ideia deste trecho**. A
   origem (arquivo e linha) é anotada sozinha — você não precisa digitar nada além
   do título.

O formulário tem só título e texto. Área, etiqueta, importância e "vale para
projetos" saíram: eram opções que atrapalhavam na hora de capturar. Se alguma
ideia antiga tiver esses campos, eles continuam aparecendo nela.

O **Índice**, na visão geral, lista os títulos: clicar leva direto ao cartão.

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
