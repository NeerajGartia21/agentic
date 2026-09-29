# AI-assisted development prompt history

This project was built with **GitHub Copilot**. I used the assistant to research
Cloudflare's current APIs, challenge the architecture, implement the application,
and verify the result. I reviewed the generated code and made the final technical
decisions.

The assignment brief is separated from my prompts below so it is clear which
requirements were provided and how I translated them into concrete engineering
instructions. Prompts are lightly cleaned up for readability while preserving
their intent, constraints, and acceptance criteria.


## 1. My initial implementation prompt

> Build a complete, deployable AI research assistant on Cloudflare that satisfies
> every requirement in the brief. Do not stop at a scaffold or mock the platform
> integrations.
>
> Before implementation, review the current official Cloudflare documentation and
> verify the APIs you intend to use. Then propose a concise architecture that maps
> each requirement to a concrete Cloudflare primitive:
>
> - Use Workers AI with Llama 3.3 for generation and stream responses to the UI.
> - Use an Agents SDK Durable Object for one isolated conversation per browser
>   session.
> - Persist conversation memory in the agent's SQLite database and include a
>   bounded amount of recent history in each model request.
> - Use a real Cloudflare Workflow for a multi-step research task. It must plan,
>   gather, summarize, and save the result back into the originating agent.
> - Serve a responsive chat interface through Cloudflare static assets. Support
>   normal chat, `/research <topic>`, workflow progress, history restoration, and
>   clearing memory.
>
> Keep the browser client dependency-free and the TypeScript backend small and
> strongly typed. Validate empty inputs, escape rendered content, surface useful
> loading and error states, and avoid external services or API keys.
>
> Configure all Wrangler bindings and exports required for Workers AI, the Durable
> Object, the Workflow, and static assets. Document the architecture, requirement
> mapping, local setup, deployment steps, and a short demo path. Before finishing,
> run generated binding types, `tsc --noEmit`, and a Wrangler dry-run deployment;
> fix type and bundle failures at their root cause and report any live test that
> still requires Cloudflare authentication.

**Outcome:** Established a testable architecture and definition of done covering
all four assignment capabilities, user-visible behavior, operational constraints,
documentation, and deployment validation.

---

## 2. Research the platform before choosing an architecture

> Read the current official Cloudflare documentation for the Agents SDK, Workers
> AI, Workflows, Durable Objects, and static asset hosting. Confirm the exact APIs
> available today rather than relying on memory. Propose the smallest architecture
> that visibly demonstrates all four assignment requirements. Prefer native
> Cloudflare bindings, avoid external API keys, and call out any SDK or deployment
> constraints that could affect local development.

**Outcome:** Selected an Agents SDK Durable Object for per-session state and
SQLite memory, Workers AI with
`@cf/meta/llama-3.3-70b-instruct-fp8-fast`, a Cloudflare Workflow for durable
coordination, and a static browser chat client.

---

## 3. Turn the architecture into an implementation plan

> Design the request and data flow before writing code. Map each assignment
> requirement to a concrete file, Cloudflare binding, and observable user
> behavior. The workflow must do real multi-step work rather than exist only as a
> placeholder. Explain how browser sessions map to isolated agent instances, how
> chat history reaches the model as context, and how a completed workflow writes
> its result back into the same user's memory.

**Outcome:** Defined the following end-to-end flow:

1. A browser stores a random session ID in `localStorage`.
2. Requests under `/agents/chat-agent/<session>/...` route to that session's
  Durable Object.
3. The agent stores messages in its private SQLite database and sends recent
  history to Llama 3.3.
4. A `/research <topic>` command starts a checkpointed plan, gather, summarize,
  and save workflow.
5. The workflow uses agent RPC to persist the final briefing into the originating
  conversation.

---

## 4. Implement the Cloudflare backend

> Build the TypeScript backend using the current Agents SDK APIs. Add a
> `ChatAgent` with SQLite-backed message history, synced state, history and clear
> endpoints, a streamed chat endpoint, research start/status endpoints, and an
> RPC method for workflow results. Limit model context to recent messages so the
> prompt cannot grow without bound. Reject empty chat and research inputs.
>
> Add a `ResearchWorkflow` with separately checkpointed `plan`, `gather`,
> `summarize`, and `save-to-agent` steps. Configure retries with exponential
> backoff on the expensive gathering step. Keep types explicit and do not add
> services outside Cloudflare.

**Outcome:** Implemented the agent in `src/agent.ts`, the durable pipeline in
`src/workflow.ts`, and Worker routing in `src/index.ts`.

---

## 5. Implement a usable streaming chat interface

> Build a dependency-free browser UI served by the Worker's static assets
> binding. It should restore persisted history on load, stream SSE deltas into the
> current assistant message, display the memory count, allow history to be
> cleared, recognize `/research <topic>`, poll workflow status, and reload the
> saved briefing when research completes. Escape user/model content before
> rendering it. Include useful empty, busy, error, and completion states, and make
> the layout work on both desktop and mobile.

**Outcome:** Added `public/index.html`, `public/styles.css`, and `public/app.js`
with streaming chat, session isolation, workflow progress, persisted history,
clear-memory behavior, and safe HTML rendering.

---

## 6. Configure and verify the deployment contract

> Configure Wrangler for the Workers AI binding, SQLite-backed Durable Object,
> Workflow, and static assets. Export every class Cloudflare needs from the Worker
> entrypoint and generate binding types. Then run the narrowest useful checks:
> TypeScript with no emit and a Wrangler dry-run deployment. Fix root causes of
> type or bundle errors without weakening types. Report exactly which bindings
> Wrangler recognizes and identify anything that still requires a Cloudflare
> login for live testing.

**Outcome:** Generated `worker-configuration.d.ts`, passed `npx tsc --noEmit`,
and completed `npx wrangler deploy --dry-run`. Wrangler recognized the
`ChatAgent`, `RESEARCH_WORKFLOW`, `AI`, and `ASSETS` bindings. A bundling failure
revealed the Agents SDK's `ai` peer dependency; installing it resolved the dry
run. Live Workers AI testing still requires an authenticated Cloudflare account.

---

## 7. Review the submission as a recruiter would

> Review the repository against every line of the assignment. Make the README
> explain the architecture, requirement mapping, local setup, deployment, and a
> concrete demo path. Keep claims limited to behavior present in the code. Make
> the prompt history show the reasoning and acceptance criteria behind the work,
> not merely say that AI generated the project.

**Outcome:** Added an assignment mapping, architecture diagram, run/deploy
instructions, demo commands, operational notes, and this outcome-linked prompt
history.

---

## Final verification checklist

- `npx tsc --noEmit` — TypeScript validation
- `npx wrangler deploy --dry-run` — Cloudflare bundle and binding validation
- Manual code review — routing, session isolation, bounded context, SSE parsing,
  workflow retries, RPC write-back, input validation, and HTML escaping
