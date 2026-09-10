# localscope — полная инструкция: сборка, запуск, тестирование, публикация

## 0. Предпосылки

| Что | Версия | Проверка |
|---|---|---|
| Node.js | 18+ (рекомендую 20/22) | `node --version` |
| npm | 9+ | `npm --version` |
| Git | любой | `git --version` |

ripgrep и ONNX **не требуются** — сервер работает без них (lexical fallback).

## 1. Установка проекта

```bash
cd /Users/parhom/Desktop/mcpserv/localscope
npm install
```

npm поставит: `@modelcontextprotocol/sdk`, `zod` (dependencies), vitest/eslint/typescript/tsx (dev). Опциональные `@huggingface/transformers` и `@vscode/ripgrep` НЕ ставятся при обычном `npm install` — это намеренно (zero-config).

## 2. Проверка качества (3 команды)

```bash
npm run typecheck   # tsc --noEmit — типы
npm run lint        # eslint src test
npm test            # 31 тест, 4 файла
```

Ожидаемый вывод тестов:
```
Test Files  4 passed (4)
     Tests  31 passed (31)
```

Покрытие: `npm run coverage`.

## 3. Сборка и запуск

### Dev-режим (hot-reload)
```bash
npm run dev         # tsx watch src/index.ts
```

### Production-сборка
```bash
npm run build       # tsc → dist/
npm start           # node dist/index.js — stdio-сервер
```

После `npm run build` в `dist/index.js` лежит готовый сервер. При stdio-запуске он молчит в stdout (это протокол), логи идут в stderr:
```
[stderr] localscope-mcp 0.1.0 ready (stdio, local-only)
```

### HTTP-режим (опционально)
```bash
LOCALSCOPE_TRANSPORT=http LOCALSCOPE_PORT=3000 npm start
# MCP endpoint: http://127.0.0.1:3000/mcp
```
Только localhost, Origin-фильтр включён. Не выставляйте наружу.

## 4. Тестирование

### 4.1. Юнит/интеграционные тесты
```bash
npm test                      # однократно
npm run test:watch            # watch-режим
npx vitest run test/mcp-integration.test.ts   # только MCP-интеграционные
```

Что проверяют тесты:
- `indexer.test.ts` — walker, gitignore, извлечение символов, граф импортов, поиск, impact-анализ, чанкинг
- `embedder.test.ts` — токенайзер, lexical-скоринг, cosine, детект языка, gitignore-компилятор
- `repo-manager.test.ts` — полный flow: index → status → search → impact, ошибки с подсказками
- `mcp-integration.test.ts` — реальный MCP-клиент через InMemoryTransport: listTools, все 4 инструмента, isError на плохом пути

### 4.2. MCP Inspector (официальный отладчик)
```bash
npx @modelcontextprotocol/inspector node dist/index.js
```
Откроется веб-UI (обычно http://localhost:6274): слева — подключение, справа — вкладки Tools / Resources / Prompts. Порядок действий:
1. Connect
2. Вкладка Tools → `localscope_index` → параметры: `path` = абсолютный путь к любому репозиторию (например `/Users/parhom/Desktop/mcpserv/localscope/test/fixtures/sample`)
3. Run Tool → увидите отчёт индексации
4. `localscope_search` → `query` = "parse config", `path` = тот же корень
5. `localscope_impact` → `target` = `parseConfig` (или `src/utils/config.ts`)
6. `localscope_status` → статистика индекса

### 4.3. Smoke-тест по реальному stdio (без Inspector)

Сохраните как `smoke.mjs` в корне проекта и запустите `node smoke.mjs`:

```js
import { spawn } from "node:child_process";

const proc = spawn("node", ["dist/index.js"], { stdio: ["pipe", "pipe", "pipe"] });
const ROOT = process.cwd() + "/test/fixtures/sample";
let buffer = "";
const pending = new Map();
let nextId = 1;

proc.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  let idx;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    } catch {}
  }
});
proc.stderr.on("data", (d) => process.stderr.write("[server] " + d));

const send = (method, params) =>
  new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(300);

const init = await send("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "smoke", version: "0.0.0" },
});
console.log("server:", init.result.serverInfo.name, init.result.serverInfo.version);
proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
await sleep(100);

console.log("tools:", (await send("tools/list", {})).result.tools.map((t) => t.name).join(", "));
console.log((await send("tools/call", {
  name: "localscope_index", arguments: { path: ROOT },
})).result.content[0].text.split("\n")[0]);
console.log((await send("tools/call", {
  name: "localscope_impact", arguments: { target: "parseConfig", path: ROOT },
})).result.content[0].text.split("\n").slice(0, 7).join("\n"));
proc.kill();
```

Ожидаемый вывод:
```
[server] localscope-mcp 0.1.0 ready (stdio, local-only)
server: localscope-mcp 0.1.0
tools: localscope_index, localscope_search, localscope_impact, localscope_status
# Indexed sample
# Impact of changing parseConfig
Files affected: 2 (direct: 2, transitive: 0)
## Direct dependents (break first)
- src/main.ts
- src/services/server.ts
```

### 4.4. Тест на своём репозитории
Индексируйте любой реальный проект (без публикации в npm):
```bash
claude mcp add localscope -- node /Users/parhom/Desktop/mcpserv/localscope/dist/index.js
```
Или в Inspector передайте путь к своему репо.

## 5. Подключение к клиентам

### Claude Code (до публикации npm)
```bash
claude mcp add localscope -- node /Users/parhom/Desktop/mcpserv/localscope/dist/index.js
```
После публикации в npm:
```bash
claude mcp add localscope -- npx localscope-mcp
```
Проверка: `claude mcp list` → localscope ✓ connected. Затем в чате:
```
проиндексируй проект и скажи, что сломается, если я переименую parseConfig
```

### Cursor — `.cursor/mcp.json` в корне проекта:
```json
{
  "mcpServers": {
    "localscope": {
      "command": "node",
      "args": ["/Users/parhom/Desktop/mcpserv/localscope/dist/index.js"]
    }
  }
}
```

### Claude Desktop — `~/Library/Application Support/Claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "localscope": {
      "command": "node",
      "args": ["/Users/parhom/Desktop/mcpserv/localscope/dist/index.js"]
    }
  }
}
```

### Windsurf / любой MCP-клиент
stdio-сервер: команда `node`, аргумент `<путь>/localscope/dist/index.js`.

## 6. Опционально: семантический поиск (ONNX, всё ещё офлайн)

```bash
npm install -g @huggingface/transformers
# перезапустить клиент/сервер
```
При первом `localscope_index` модель (~30MB, all-MiniLM-L6-v2) скачается один раз в локальный кеш Hugging Face и дальше работает полностью офлайн на CPU. Проверка режима: `localscope_status` → `embedder: onnx:... (semantic search active)`. Удалите пакет — вернётся lexical-режим без ошибок.

## 7. Публикация

### npm
```bash
# в package.json замените your-org на свой GitHub username
npm login
npm publish            # prepublishOnly сам соберёт dist
# проверить:
npx localscope-mcp     # должно запустить сервер
```

### GitHub
```bash
cd /Users/parhom/Desktop/mcpserv/localscope
git init && git add -A && git commit -m "localscope: local-first MCP code analyst"
gh repo create localscope --public --source=. --push
```
CI (`.github/workflows/ci.yml`) уже настроен: typecheck + lint + tests + build на Node 18/20/22 × Linux/macOS/Windows. После первого пуша добавьте бейдж в README:
```markdown
[![CI](https://github.com/<username>/localscope/actions/workflows/ci.yml/badge.svg)](https://github.com/<username>/localscope/actions/workflows/ci.yml)
```
Для звёзд главное: демо-GIF в README (запишите asciinema/терминальную сессию с вопросом «что сломается если…»), ссылка на skills.sh/awesome-mcp списки, и пост в r/ClaudeAI / HN с заголовком про приватность.

## 8. Структура проекта (для навигации)

```
localscope/
├── src/
│   ├── index.ts              # вход: stdio/http, McpServer
│   ├── http.ts               # streamable HTTP транспорт (127.0.0.1)
│   ├── types.ts               # доменные типы (strict, readonly)
│   ├── constants.ts           # лимиты, игнор-списки
│   ├── schemas/tools.ts       # Zod-схемы инструментов
│   ├── services/
│   │   ├── walker.ts          # обход + gitignore-компилятор
│   │   ├── extractor.ts       # символы + чанкинг (6+ языков)
│   │   ├── indexer.ts         # граф импортов, поиск
│   │   ├── embedder.ts        # ONNX opt-in / lexical fallback
│   │   ├── impact.ts          # реверс-граф, breakage-отчёт
│   │   ├── repo-manager.ts    # состояние индексов, оркестрация
│   │   └── language.ts        # детект языка по расширению
│   └── tools/register.ts      # registerTool × 4
├── test/                      # 4 файла, 31 тест
├── .github/workflows/ci.yml   # CI matrix
├── package.json / tsconfig.json / eslint.config.js / vitest.config.ts
└── README.md / LICENSE / INSTRUCTIONS.md
```

## 9. Частые проблемы

| Симптом | Причина | Решение |
|---|---|---|
| `Directory not found` от localscope_index | путь относительный к cwd клиента | передайте абсолютный путь |
| `No index for … Call localscope_index first` | поиск до индексации | сначала localscope_index с тем же `path` |
| Сервер «молчит» в stdout | это нормально: stdout = протокол MCP | логи смотрите в stderr |
| Хочу semantic, а `embedder: lexical` | transformers не установлен | см. раздел 6 |
| Тесты падают на gitignore | кеш gitignore между тестами | уже обрабатывается `clearGitignoreCache()` |
