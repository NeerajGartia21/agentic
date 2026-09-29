import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { getAgentByName } from "agents";
import type { ChatAgent } from "./agent";

const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

type Params = { topic: string; agentName: string };

/** One AI call, unwrapped to plain text. */
type AiText = { response: string };

/**
 * Component 2: Workflow / coordination.
 *
 * A durable, multi-step research pipeline. Each `step.do` is checkpointed:
 * if the Worker restarts or a step fails, Workflows resumes from the last
 * successful step instead of re-running everything. When finished it writes
 * the result back into the ChatAgent's memory via RPC.
 */
export class ResearchWorkflow extends WorkflowEntrypoint<Env, Params> {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    const { topic, agentName } = event.payload;

    // Step 1 — plan the research.
    const questions = await step.do("plan", async () => {
      const r = (await this.env.AI.run(MODEL, {
        messages: [
          {
            role: "system",
            content:
              "You are a research planner. Given a topic, produce exactly 3 concise, " +
              "specific research questions. Reply with a numbered list and nothing else.",
          },
          { role: "user", content: `Topic: ${topic}` },
        ],
      })) as AiText;
      return r.response.trim();
    });

    // Step 2 — gather findings for each question.
    const notes = await step.do(
      "gather",
      { retries: { limit: 3, delay: "3 seconds", backoff: "exponential" } },
      async () => {
        const r = (await this.env.AI.run(MODEL, {
          messages: [
            {
              role: "system",
              content:
                "You are a research assistant. Answer each question about the topic " +
                "factually and concisely using short paragraphs.",
            },
            { role: "user", content: `Topic: ${topic}\n\nQuestions:\n${questions}` },
          ],
          max_tokens: 800,
        })) as AiText;
        return r.response.trim();
      },
    );

    // Step 3 — summarize into a briefing.
    const summary = await step.do("summarize", async () => {
      const r = (await this.env.AI.run(MODEL, {
        messages: [
          {
            role: "system",
            content:
              "You are an expert editor. Write a clear 5-8 sentence briefing that " +
              "summarizes the research notes. End with a line starting 'Key takeaway:'.",
          },
          { role: "user", content: `Topic: ${topic}\n\nResearch notes:\n${notes}` },
        ],
        max_tokens: 600,
      })) as AiText;
      return r.response.trim();
    });

    // Step 4 — write the result back into the agent's memory (coordination).
    await step.do("save-to-agent", async () => {
      const agent = await getAgentByName<Env, ChatAgent>(this.env.ChatAgent, agentName);
      await agent.addResearchResult(topic, summary);
      return { saved: true };
    });

    return { topic, questions, summary };
  }
}
