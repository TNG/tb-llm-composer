# tb-llm-composer

## Working efficiently (keep token use low)

- Read only the files you need; prefer targeted `grep`/search over reading whole files. Don't re-read a file already in context.
- Make focused edits with minimal context; never echo large unchanged regions or full-file dumps back to the user.
- Don't paste full build/test logs. Run checks, then summarize results in 1-2 lines; show only failing snippets.
- Keep replies short: a brief plan, the edits, and a concise outcome. Skip restating code you just wrote.
- Batch independent reads/searches in one step instead of many sequential calls.

## What this project is

**LLM Composer** is a **Thunderbird MV3 WebExtension** in **TypeScript** that adds LLM help while writing emails.

Features:
- **Compose** from a short prompt (`Ctrl+Alt+L`)
- **Summarize** the reply thread (`Ctrl+Alt+K`)
- **Cancel** an in-flight LLM request (`Ctrl+Alt+C`)
- **Sort a folder** by classifying each message into configured folders (toolbar action popup)
- **Generate a report** over the mailbox via agentic LLM tool-calling (toolbar action popup)

It uses any **OpenAI-compatible chat-completions HTTP endpoint**. Endpoint URL, optional bearer token, and model are configured on the options page. The endpoint origin is an opt-in **host permission** (not granted at install); the options page requests it via `hostPermissions.ts` on a user gesture, otherwise `fetch` is blocked by CORS.

## Tech stack

| Concern | Choice |
| --- | --- |
| Language | TypeScript 5 (strict), ES2022, ESM |
| Package manager | **pnpm** (v10+), Node **>=22** (CI uses Node 24) |
| Bundler | Webpack 5 (`ts-loader`, Terser) |
| Linter/format | **Biome** (`biome.json`): 2 spaces, double quotes, width 120 |
| Tests | **Vitest** (node env, `vitest-fetch-mock`) |
| Types | `@types/thunderbird-webext-browser` (`browser.*`) |

## Post-edit checklist (run in order)

Run after every code change. CI (`.github/workflows/ci.yaml`) runs build, lint, test, and `pnpm audit`.

```pwsh
pnpm run lint
pnpm run test
pnpm run build
```

- Lint auto-fix: `pnpm run lint-fix` (safe) or `pnpm run lint-fix-unsafe` (unsafe)
- Optional coverage: `pnpm run test-coverage`
- Release package only: `pnpm run ship` -> `llm-thunderbird.xpi`

## Project layout

```text
src/
  background.ts              Entry point; registers all browser.* listeners for commands/menus/tabs/alarms and folder-sort action.
  options.ts                 Options page logic (DOM in public/options.html).
  optionsParams.ts           Option/parameter types, DEFAULT_OPTIONS, getPluginOptions() (reads browser.storage.sync).

  llmButtonClickHandling.ts  compose()/summarize()/cancel() flows; per-tab request state (AllRequestsStatus); think-tag stripping;
                             writes results via browser.compose.setComposeDetails.
  llmConnection.ts           sendContentToLlm()/callLlmApi(); runAgenticLlm() tool-calling loop; fetch to LLM endpoint;
                             request/response + tool (LlmToolDefinition/LlmToolHandler) types; abort + timeout.
  promptAndContext.ts        Builds system/user messages (context + prompt) for body, subject, and summary generation.
  emailOrganising.ts         organiseCurrentFolder(); organise folder messages via LLM and move with browser.messages.move() to FolderRule targets.
                             Also exports resolveFolderPath()/extractTextFromPart() reused by report tools.
  hostPermissions.ts         Derive/check/request the opt-in host permission for the configured endpoint origin.

  reportGeneration.ts        generateReport(ReportRequest); builds the report system/scope prompt and drives runAgenticLlm.
  reportTools.ts             search_messages/get_message tool definitions + handlers (ReportScope); assertSearchCapabilities() probe.
  reports.ts                 Report window UI logic (public/reports.html): create/cancel, iterate on prior report, copy/save txt|md.

  menu.ts                    Native menu entries for the compose_action (compose/summarize) and toolbar action (organise/report) menus + shortcut labels.
  retrieveSentContext.ts     Gets recent sent mail to a recipient (writing style context).
  originalTabConversation.ts Caches reply quote per tab in browser.storage.local.
  emailHelpers.ts            MIME text extraction; first-recipient address helper.
  keepAlive.ts               Alarm-based keep-alive to prevent MV3 suspension during long LLM calls (~90s idle threshold).
  notifications.ts           timedNotification() + notifyOnError() wrapper.
  utils.ts                   stripHtml(), getInputElement() helper.
  thunderbird-alarms.d.ts    Ambient types for alarms API.
  __tests__/                 Vitest specs + setupVitest.ts + testUtils.ts.

manifest.json                MV3 source manifest. Webpack rewrites paths and strips " (dev)" / dev id for production.
webpack.config.js            Builds background.ts + options.ts + reports.ts into build/; copies icons/, public/, and transformed manifest.json.
public/options.html          Options page markup.
public/reports.html          Report window markup.
icons/                       Extension icons + busy indicator (loader-32px.gif).
docs/CONTRIBUTING.md         Dev/test/release instructions + sample test emails.
docs/create_new_release.md   Release process.
build/                       Generated webpack output (do not edit manually).
```

## Key flows

- **Listener ordering is critical:** in `background.ts`, `browser.commands.onCommand` must remain the first statement or shortcuts can fail after event-page restart.
- **Compose flow:** `executeLlmAction` -> `compose()` gathers compose details, recent sent mails, and reply quote; builds prompt/context in `promptAndContext.ts`; optionally generates subject; calls `sendContentToLlm`; writes result back and re-appends signature/quote.
- **Per-tab request state:** singleton `allRequestsStatus` (`AllRequestsStatus`) holds an `AbortController` by `tabId`; cancel aborts active request; compose-action icon switches to `loader-32px.gif` while running.
- **LLM HTTP call:** `callLlmApi` POSTs `{ messages, ...params }` to `options.model` (endpoint URL), adds `Authorization: Bearer` if token exists, merges user-abort and timeout signals, and wraps fetch with keep-alive.
- **Toolbar action menu:** `browser.action` is a native menu (`"type": "menu"`) whose entries (`organise-folder`, `create-report`) are registered via `browser.menus` in `menu.ts`, matching the compose_action menu. `background.ts` `menus.onClicked` routes those ids to `toggleOrganiseFolder`/`openReportWindow`; other ids fall through to the LLM action handler.
- **Folder sort flow:** `sortCurrentFolder` classifies + moves messages; a repeat toggle cancels through a separate `AbortController` map.
- **Report flow:** report window (`reports.ts`) sends `generate-report` with a `ReportRequest`; `generateReport` probes search capability (`assertSearchCapabilities`), then `runAgenticLlm` loops the model with `search_messages`/`get_message` tools (token-frugal: metadata first, bodies on demand) up to `reportMaxSteps`. `cancel-report` aborts. Iterating re-sends the prior report as context.
- **Think-tag handling:** `<think>...</think>` is stripped unless `options.strip_think_tag` is `false`.

## Conventions and gotchas

- Use Promise-based `browser.*`, never `chrome.*`.
- Persisted settings: `browser.storage.sync` under `options`; per-tab cache: `browser.storage.local`. Always read options via `getPluginOptions()` (merges with `DEFAULT_OPTIONS`).
- TypeScript is strict: no unused locals/params, no implicit `any`, no fallthrough; prefer narrow typing and `LlmRoles` for message roles.
- Add really concise docstrings to functions whose behavior is not obvious from the prototype.
- Log prefixes are namespaced (`SORT:`, `MENU:`, `LLM-CONNECTION:`, `KEEP-ALIVE:`, `LLM-CONVO-CACHE:`). Production build drops `console.log`/`console.info` via Terser `drop_console`; keep user-visible failures on `console.error` + notifications.
- Preserve dev/prod split: new top-level buttons/titles should include `" (dev)"` in `manifest.json` so dev installs do not clash with production (`webpack.config.js` transform strips it for prod).
- Tests run in node with `globals: true`; fetch/network is mocked by `vitest-fetch-mock` (`src/__tests__/setupVitest.ts`).
- Plain-text compose is the only fully supported mode; HTML reply content is normalized with `stripHtml`, and storing HTML reply throws.

## References

- Thunderbird WebExtension API: https://webextension-api.thunderbird.net/en/stable/
- Thunderbird add-on docs: https://developer.thunderbird.net/add-ons/about-add-ons
- Local dev and temporary add-on loading: `docs/CONTRIBUTING.md`
