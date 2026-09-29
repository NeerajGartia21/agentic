# Cloudflare AI Agent

An AI‑powered application built entirely on Cloudflare. A user chats (or launches
research) from the browser; a **Durable Object Agent** holds the conversation
**memory**, **Workers AI (Llama 3.3)** generates streamed responses, and a
**Cloudflare Workflow** runs a durable, multi‑step research pipeline that writes
its result back into the agent's memory.

## How it maps to the assignment

| Required component            | Implementation                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------ |
| **LLM**                       | Workers AI — `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, streamed via SSE       |
| **Workflow / coordination**   | A Cloudflare **Workflow** (`ResearchWorkflow`) + a **Durable Object** Agent     |
| **User input via chat/voice** | A static chat UI (served as assets) that streams tokens as they arrive          |
| **Memory or state**           | Each Agent instance owns a private **SQLite** DB (`this.sql`) + synced `state`  |

## Architecture

```
Browser (public/)                     Cloudflare Worker (src/index.ts)
  chat UI  ──POST /agents/chat-agent/<session>/chat──►  routeAgentRequest()
     ▲                                                        │
     │ SSE token stream                                       ▼
     │                                        ┌────────────────────────────┐
     └────────────────────────────────────────┤  ChatAgent (Durable Object)│
                                              │  • SQLite message log (mem) │
                                              │  • setState (live UI state) │
                                              │  • env.AI.run(Llama 3.3)    │
                                              └───────────┬─────────────────┘
                          /research <topic>               │ create()
                                                          ▼
                                          ┌───────────────────────────────┐
                                          │ ResearchWorkflow (durable)     │
                                          │ plan → gather → summarize →    │
                                          │ save-to-agent (RPC write-back) │
                                          └───────────────────────────────┘
```

Each browser gets a random `session` id (stored in `localStorage`) which maps to
its own Agent instance, so every conversation has isolated, persistent memory.

## Project layout

```
src/
  index.ts      Worker entry: routes /agents/* to the Agent, else serves the UI
  agent.ts      ChatAgent Durable Object: memory (SQLite), state, streamed LLM
  workflow.ts   ResearchWorkflow: durable multi-step research pipeline
public/
  index.html    Chat UI
  styles.css
  app.js        Streaming SSE client (no build step, no framework)
wrangler.jsonc  Bindings: AI, Durable Object, Workflow, static assets
```

## Run it locally

Workers AI runs on Cloudflare's network, so local dev needs a Cloudflare login.

```sh
npm install
npx wrangler login        # one-time; authorizes Workers AI + Workflows
npm run dev               # http://localhost:8787
```

Open http://localhost:8787 and chat. Try:

- `What can you do?` — a normal streamed Llama 3.3 reply.
- `/research the history of Cloudflare` — launches the durable Workflow; the
  briefing is saved back into the conversation when it finishes.
- **Clear** — wipes this session's memory.

## Deploy

```sh
npm run deploy
```

Wrangler provisions the Durable Object, the Workflow, the Workers AI binding and
uploads the static UI. The command prints your `*.workers.dev` URL.

## Useful commands

| Command             | What it does                                              |
| ------------------- | -------------------------------------------------------- |
| `npm run dev`       | Local dev server                                         |
| `npm run deploy`    | Deploy to Cloudflare                                      |
| `npm run types`     | Regenerate `worker-configuration.d.ts` from bindings     |
| `npm run check`     | `wrangler deploy --dry-run` (bundles without deploying)  |

## Notes

- No API keys are needed for the LLM — the `AI` binding is authenticated by the
  platform.
- The Workflow uses `step.do(...)` so each stage is checkpointed and retried
  independently; if a step fails it resumes without repeating earlier work.
- `PROMPTS.md` contains the AI‑assisted prompt history for this submission.
# agentic
