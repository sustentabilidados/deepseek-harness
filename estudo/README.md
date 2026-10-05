# Ambiente de estudo — DeepSeek Harness

Espaço de estudo do código do harness, feito para quem **não lê código**. A ideia
é aprender as estratégias em linguagem natural, registrar as que interessam, e
depois cobrar dos modelos de IA se eles realmente usaram aquilo.

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
| **Ideias** | O que você quer levar para seus projetos. Cada ideia pode apontar para um arquivo e linha, e a visão geral mostra onde estão concentradas. |
| **Sessões** | Cada sessão encerrada vira um resumo em markdown, com as ideias de projeto em destaque. |

Ao lado, sempre visível, o **chat**. Ele responde primeiro sobre o arquivo aberto
— o nome do arquivo aparece numa faixa acima da conversa, e você pode tirá-lo para
perguntar sobre o repositório todo.

## O gesto principal

Selecione qualquer trecho no leitor. Aparecem dois botões:

- **Perguntar sobre isto** — joga o trecho no chat e pede explicação em linguagem natural.
- **Registrar ideia** — leva o trecho para o formulário, com o arquivo e a linha já preenchidos.

É assim que o texto do código vira uma técnica no seu registro.

## Chat com modelo

Sem chave, o chat só mostra o que existe no repositório e no registro — não
responde por conta própria. Para ele explicar de verdade:

```powershell
$env:DEEPSEEK_API_KEY = "..."
node estudo/servidor.mjs
```

Variáveis opcionais: `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODELO`, `PORTA_ESTUDO`.

Ressalva honesta: a documentação do harness é toda em inglês. Perguntas com
termos em inglês (`agent-loop`, `capability seam`, `session log`) acertam muito
mais do que a tradução em português.

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
    index.html        as três visões e o chat
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
