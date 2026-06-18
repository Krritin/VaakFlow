# LangGraph vs an Agent SDK (and why we use both patterns)

A short comparison for the Agent-SDK module of the syllabus, and the rationale
for VaakFlow's choices.

## The two approaches
| | **LangGraph (framework)** | **Agent SDK (e.g. OpenAI Agents, Claude Agent SDK)** |
| :-- | :-- | :-- |
| Control model | Explicit graph: nodes + conditional edges | Implicit loop: model decides tool calls / handoffs |
| State | Typed shared state + reducers | Conversation/messages + lightweight context |
| Persistence | First-class **checkpointer** (thread per session) | Usually app-managed |
| Resumability | Built in — resume a half-finished flow | Re-run / replay messages |
| Handoffs | Modeled as edges / sub-graphs | First-class `handoff` primitive |
| Best for | Deterministic, branchy, resumable workflows | Open-ended tool-using assistants |

## What VaakFlow uses
- **Core = LangGraph.** The field flow is branchy and safety-relevant (extract →
  validate → clarify-or-persist; rewrite → retrieve → corrective-RAG → answer).
  We want *deterministic* routing, an auditable node **trace**, and
  **checkpointing** so an interrupted/offline turn resumes and so "close that
  one" resolves the previous turn's work order from session state. A graph
  expresses this far more clearly than an implicit agent loop.
- **Escalation = the Agent-SDK handoff pattern.** When severity is critical we
  hand off to an **Escalation sub-agent** (`node_escalate`) that owns its own
  behaviour (force critical priority, create a WO, fire a dashboard alert). This
  is the orchestrator→sub-agent / agent-as-a-tool pattern, implemented as a graph
  branch but conceptually an SDK handoff.
- **Tools = MCP.** Work-order operations are exposed as a real MCP tool server
  (`backend/app/mcp_server/`), so the tools are protocol-addressable rather than
  hard-wired — the agent is an MCP client.

## Takeaway
LangGraph gives us the explicit, resumable, traceable core a field-safety
workflow needs; we adopt the Agent-SDK **handoff** idea for escalation and **MCP**
for tools. Different tools, used where each is strongest.
