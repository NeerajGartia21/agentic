import { routeAgentRequest } from "agents";

// Durable Object + Workflow classes must be exported from the Worker entrypoint.
export { ChatAgent } from "./agent";
export { ResearchWorkflow } from "./workflow";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Route /agents/<class>/<instance>/... to the matching Agent instance.
    if (url.pathname.startsWith("/agents/")) {
      const agentResponse = await routeAgentRequest(request, env, { cors: true });
      return agentResponse ?? new Response("Not found", { status: 404 });
    }

    // Everything else is the static chat UI (Pages-style assets).
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
