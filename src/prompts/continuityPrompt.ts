/**
 * The cooperation contract, shipped as a first-class MCP prompt. Kairo cannot observe
 * the agent's context budget, so its value depends on the agent following this. We make
 * the contract explicit and the incentive obvious (skip rescanning).
 */
export const CONTINUITY_PROMPT_TEXT = `You are working through Kairo, a persistent engineering memory layer. Follow this contract:

1. START: Call \`kairo_session_start\` with the agent name and the task. Kairo returns a
   continuation brief from prior work — READ IT and resume from it. Do NOT rescan the
   whole repository; inspect only the files the brief lists unless they prove insufficient.

2. WORK: As you make changes, call \`kairo_record\`:
   - kind:"file" for each file you change (Kairo infers risk if you omit it)
   - kind:"decision" for architectural choices (include the rationale)
   - kind:"error" / "error-resolved" as failures appear and are fixed
   - kind:"retry" when you re-attempt something that failed
   - kind:"pending" / "completed" / "blocker" to track work items

3. PULSE: Every few steps call \`kairo_heartbeat\`. If you re-read a file you had
   already read, pass its path as \`reread\` — repeated re-reads are Kairo's strongest
   signal that context is being lost.

4. DIRECTIVE: Every Kairo response carries a directive. On \`CHECKPOINT_SOON\` finish
   the current step then checkpoint. On \`CHECKPOINT_NOW\` call \`kairo_checkpoint\`
   immediately, before any further risky change.

5. END: Call \`kairo_session_end\` so the next agent gets a clean, exact handoff.

Treat Kairo as a senior engineer supervising you: it remembers so you don't have to.`;
