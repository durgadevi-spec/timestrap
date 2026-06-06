import OpenAI from "openai";
import { runRAGChat } from "./ragChat";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export type AgentType = "hr" | "project" | "analytics" | "knowledge" | "conversational";

// ── STEP 1: INTENT ROUTER ────────────────────────────────────────────────────
// Analyses message and decides which agents are needed

async function routeToAgents(
  message: string,
  userRole: string,
  history: any[] = []
): Promise<AgentType[]> {
  const systemMessage = {
    role: "system",
    content: `You are a routing assistant. Analyse the user message and return ONLY a JSON array of agents needed.

Available agents:
- "hr": leaves, attendance, employee info, HR policies, approvals
- "project": tasks, projects, timesheets, daily plans, deadlines
- "analytics": performance scores, predictions, reports, team insights
- "knowledge": company policies, office timings, holidays, general company info
- "conversational": greetings, acknowledgments, dismissals, casual chat, anything that doesn't need data or tools

Rules:
- Return minimum agents needed
- Simple queries need only 1 agent
- Complex queries can need 2-3 agents
- When the message is a dismissal, acknowledgment, or casual response with no data intent → ALWAYS return ["conversational"]
- Never return an empty array []
- Default to ["conversational"] when unsure
- Return ONLY valid JSON array, nothing else

Examples:
"show my tasks" → ["project"]
"apply for leave" → ["hr"]
"what are office timings" → ["knowledge"]
"how am i performing" → ["analytics"]
"give me my full status" → ["project", "hr", "analytics"]
"full overview of my day" → ["project", "hr", "analytics"]
"ok" → ["conversational"]
"thanks" → ["conversational"]
"good morning" → ["project", "hr"]
"bye" → ["conversational"]
"got it" → ["conversational"]
"never mind" → ["conversational"]
"generate report" → ["analytics"]`,
  };

  const messages = [
    systemMessage,
    ...history.slice(-5).map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: message },
  ];

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    max_tokens: 100,
    messages: messages as any,
  });

  try {
    const raw = response.choices[0].message.content?.trim() || '["conversational"]';
    const agents = JSON.parse(raw) as AgentType[];
    const valid = agents.filter((a) =>
      ["hr", "project", "analytics", "knowledge", "conversational"].includes(a)
    );
    // Never allow empty — fallback to conversational
    return valid.length > 0 ? valid : ["conversational"];
  } catch {
    return ["conversational"];
  }
}

// ── STEP 2: AGENT SYSTEM PROMPTS ─────────────────────────────────────────────

function getAgentSystemPrompt(agent: AgentType, userRole: string): string {
  const base = `You are ARIA, an intelligent work assistant for Knockturn Private Limited.
Answer naturally and concisely. Never mention agents or routing.`;

  switch (agent) {
    case "hr":
      return `${base}
Focus: Leave management, attendance, employee information, HR approvals.
Only answer HR-related aspects of the query.
If the query has non-HR parts, ignore them — another system handles those.`;

    case "project":
      return `${base}
Focus: Tasks, projects, timesheets, daily plans, deadlines, assignments.
Only answer project/task-related aspects of the query.
If the query has non-project parts, ignore them — another system handles those.`;

    case "analytics":
      return `${base}
Focus: Performance scores, productivity trends, predictions, reports, team insights.
Only answer analytics-related aspects of the query.
Present risk levels clearly: HIGH / MEDIUM / LOW.
Always include actionable suggestions.`;

    case "knowledge":
      return `${base}
Focus: Company policies, office timings, holidays, general company information.
Use retrieved context to answer. Never guess policy details.
If information is not in the context, say to contact HR.`;

    case "conversational":
      return `${base}
You are responding to a casual message, dismissal, or acknowledgment.
Respond briefly and naturally in 1 sentence.
Do not call any tools.
Do not ask follow-up questions.
Examples: "Got it!", "No problem!", "Sure, let me know if you need anything."`;

    default:
      return base;
  }
}

// ── STEP 3: RUN AGENTS IN PARALLEL ───────────────────────────────────────────

async function runAgent(
  agent: AgentType,
  message: string,
  userContext: any,
  history: any[],
  onChunk: (chunk: any) => void
): Promise<string> {
  const chunks: string[] = [];

  // Correct positional arguments used here matching runRAGChat signature
  await runRAGChat(
    message,
    history,
    {
      ...userContext,
      agentMode: agent,
      agentSystemPrompt: getAgentSystemPrompt(agent, userContext.role),
    },
    (chunk: any) => {
      if (chunk.type === "text") {
        chunks.push(chunk.content);
      } else {
        // Forward ALL non-text chunks directly to client
        // This includes interactive_task_plan, action_executed, etc.
        onChunk(chunk);
      }
    }
  );

  return chunks.join("");
}

// ── STEP 4: COMBINE RESPONSES ─────────────────────────────────────────────────

async function combineResponses(
  message: string,
  responses: { agent: AgentType; content: string }[]
): Promise<string> {
  // Filter out empty responses
  const activeResponses = responses.filter((r) => r.content.trim().length > 0);

  if (activeResponses.length === 0) {
    return "I couldn't gather any information on that request.";
  }

  if (activeResponses.length === 1) {
    return activeResponses[0].content;
  }

  // Multiple agents — combine naturally
  const combined = activeResponses
    .map((r) => `[${r.agent.toUpperCase()} DATA]:\n${r.content}`)
    .join("\n\n");

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    max_tokens: 1000,
    messages: [
      {
        role: "system",
        content: `You are ARIA, an intelligent work assistant for Knockturn Private Limited.
You have received data from multiple specialized systems.
Combine them into ONE natural, cohesive response.

Rules:
- Never mention agents, systems, or routing
- Write as if you know everything naturally
- Remove duplicate information
- Keep it concise and well structured
- Use bullet points only when showing lists
- NEVER omit performance scores, attendance risk, or prediction data from the final response. Always include ALL data from ALL agents.
- Always end with a helpful suggestion if relevant`,
      },
      {
        role: "user",
        content: `Original question: "${message}"

Data from systems:
${combined}

Combine into one natural response:`,
      },
    ],
  });

  return response.choices[0].message.content || activeResponses[0].content;
}

// ── MAIN COORDINATOR FUNCTION ─────────────────────────────────────────────────

export async function runCoordinator({
  message,
  userContext,
  history,
  onChunk,
}: {
  message: string;
  userContext: any;
  history: any[];
  onChunk: (chunk: any) => void;
}): Promise<void> {
  try {
    // Step 1 — Route to agents
    const agents = await routeToAgents(message, userContext.role, history);
    console.log(`[COORDINATOR] Routing to agents:`, agents);

    // Step 2 — Run all needed agents in parallel
    const agentPromises = agents.map((agent) =>
      runAgent(agent, message, userContext, history, onChunk)
        .then((content) => ({ agent, content }))
        .catch(() => ({ agent, content: "" }))
    );

    const agentResults = await Promise.all(agentPromises);

    // Step 3 — Combine responses
    const finalResponse = await combineResponses(message, agentResults);

    // Step 4 — Stream combined response word by word
    const words = finalResponse.split(" ");
    for (const word of words) {
      onChunk({ type: "text", content: word + " " });
      // Minor delay to simulate natural typing
      await new Promise((resolve) => setTimeout(resolve, 8));
    }

    onChunk({ type: "done" });
  } catch (error) {
    console.error("[COORDINATOR] Error:", error);
    // Correct positional arguments used in fallback call
    await runRAGChat(message, history, userContext, onChunk);
  }
}
