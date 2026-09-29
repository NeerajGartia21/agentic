import { Agent } from "agents";

// Component 1: LLM — Llama 3.3 on Workers AI.
const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

// How many recent messages to feed back to the model as context (memory).
const CONTEXT_LIMIT = 20;

const SYSTEM_PROMPT =
  "You are a helpful AI assistant running entirely on Cloudflare Workers AI (Llama 3.3). " +
  "You remember the ongoing conversation. Keep answers clear, friendly and concise. " +
  "If the user wants deep research, tell them they can run `/research <topic>`.";

type ChatState = {
  messageCount: number;
  lastActive: string | null;
  activeResearch: number;
};

type MessageRow = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: number;
};

/**
 * ChatAgent is a SQLite-backed Durable Object (via the Agents SDK).
 * It provides the "memory/state" and "coordination" components:
 *  - `this.sql`       -> durable conversation history (memory)
 *  - `this.setState`  -> live, synced UI state
 *  - it triggers and coordinates the ResearchWorkflow
 */
export class ChatAgent extends Agent<Env, ChatState> {
  initialState: ChatState = {
    messageCount: 0,
    lastActive: null,
    activeResearch: 0,
  };

  async onStart() {
    // Each Agent instance owns a private SQLite database. Create the log once.
    this.sql`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `;
  }

  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    // Strip the /agents/<class>/<instance> prefix to get the sub-path.
    const path = url.pathname.replace(/^\/agents\/[^/]+\/[^/]+/, "") || "/";
    const agentName = decodeURIComponent(url.pathname.split("/")[3] ?? "default");

    if (request.method === "GET" && path === "/history") {
      return Response.json({ messages: this.getHistory(), state: this.state });
    }

    if (request.method === "DELETE" && path === "/history") {
      this.sql`DELETE FROM messages`;
      this.setState({ ...this.state, messageCount: 0 });
      return Response.json({ ok: true });
    }

    if (request.method === "POST" && path === "/chat") {
      const { message } = await request.json<{ message?: string }>();
      return this.handleChat(message ?? "");
    }

    if (request.method === "POST" && path === "/research") {
      const { topic } = await request.json<{ topic?: string }>();
      return this.startResearch(topic ?? "", agentName);
    }

    if (request.method === "GET" && path.startsWith("/research/")) {
      return this.researchStatus(path.slice("/research/".length));
    }

    return new Response("Not found", { status: 404 });
  }

  private getHistory(): MessageRow[] {
    return this.sql<MessageRow>`
      SELECT id, role, content, created_at FROM messages
      ORDER BY created_at ASC
    `;
  }

  private save(role: "user" | "assistant", content: string) {
    this.sql`
      INSERT INTO messages (id, role, content, created_at)
      VALUES (${crypto.randomUUID()}, ${role}, ${content}, ${Date.now()})
    `;
    this.setState({
      ...this.state,
      messageCount: this.state.messageCount + 1,
      lastActive: new Date().toISOString(),
    });
  }

  /** Stream a Llama 3.3 completion back to the browser as SSE, then persist it. */
  private async handleChat(message: string): Promise<Response> {
    const text = message.trim();
    if (!text) return new Response("Empty message", { status: 400 });

    this.save("user", text);

    const history = this.getHistory().slice(-CONTEXT_LIMIT);
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history.map((m) => ({ role: m.role, content: m.content })),
    ];

    const aiStream = (await this.env.AI.run(MODEL, {
      messages,
      stream: true,
    })) as ReadableStream<Uint8Array>;

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const persist = (full: string) => this.save("assistant", full);

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = aiStream.getReader();
        let buffer = "";
        let full = "";
        const send = (obj: unknown) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith("data:")) continue;
              const data = trimmed.slice(5).trim();
              if (data === "[DONE]" || data === "") continue;
              try {
                const token = (JSON.parse(data).response as string) ?? "";
                if (token) {
                  full += token;
                  send({ delta: token });
                }
              } catch {
                // Ignore keep-alive lines / partial JSON.
              }
            }
          }
          if (full) persist(full);
          send({ done: true });
        } catch (err) {
          send({ error: String(err) });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      },
    });
  }

  /** Kick off the durable, multi-step research Workflow. */
  private async startResearch(topic: string, agentName: string): Promise<Response> {
    const t = topic.trim();
    if (!t) return new Response("Empty topic", { status: 400 });

    const instance = await this.env.RESEARCH_WORKFLOW.create({
      params: { topic: t, agentName },
    });

    this.setState({ ...this.state, activeResearch: this.state.activeResearch + 1 });
    return Response.json({ instanceId: instance.id, topic: t });
  }

  private async researchStatus(id: string): Promise<Response> {
    try {
      const instance = await this.env.RESEARCH_WORKFLOW.get(id);
      return Response.json(await instance.status());
    } catch (e) {
      return Response.json({ status: "unknown", error: String(e) }, { status: 404 });
    }
  }

  /**
   * Callable via RPC from the ResearchWorkflow once it finishes.
   * Persists the result into the agent's memory so it shows up in the chat log.
   */
  async addResearchResult(topic: string, summary: string) {
    this.save("assistant", `**Research complete — ${topic}**\n\n${summary}`);
    this.setState({
      ...this.state,
      activeResearch: Math.max(0, this.state.activeResearch - 1),
    });
    return { ok: true };
  }
}
