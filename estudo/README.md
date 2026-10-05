# Ambiente de estudo — DeepSeek Harness

Espaço de estudo do código do harness. Guarda os bons hábitos e as técnicas que
identificamos, e fecha cada sessão com um resumo do que vale para projetos.

## Rodar

```sh
node estudo/servidor.mjs
```

Abre em <http://127.0.0.1:4321>. Não precisa de `pnpm install`: o servidor usa só
o Node padrão.

## As três partes

| Parte | O que faz |
| --- | --- |
| **Dúvidas e orientações rápidas** | Chat sobre o código. Varre `docs/`, `AGENTS.md`, `README.md` e `packages/`, devolve trechos com arquivo e linha, e cruza com o que já está registrado. |
| **Registro de ideias** | Os bons hábitos, técnicas e decisões. Marque `vale para meus projetos` no que deve sair no resumo. |
| **Sessões e resumos** | Cada sessão encerrada vira um markdown em `dados/sessoes/`. |

## Chat com modelo

Sem chave, o chat só mostra o que existe no repositório e no registro — não
responde por conta própria. Para ele responder de verdade:

```powershell
$env:DEEPSEEK_API_KEY = "..."
node estudo/servidor.mjs
```

Variáveis opcionais: `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODELO`, `PORTA_ESTUDO`.

## Onde ficam os dados

- `dados/estado.json` — ideias e sessões.
- `dados/sessoes/*.md` — um resumo por sessão encerrada.

Os dois são versionados: o histórico do estudo viaja com o fork.

## Por que aqui dentro

Esta pasta fica fora dos workspaces do pnpm (`vendor/*`, `packages/*/*`,
`native/system`, `apps/*`, `benchmarks`, `website`, `python/sdk-runtime`), então
não entra em build, lint ou teste do repositório.
