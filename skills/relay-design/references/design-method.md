# Collaborative architecture

Start with the outcome and the relevant existing system. Reuse requirements, source evidence, and decisions already supplied. Inspect the entry points, adjacent interfaces, conventions, and tests that constrain the change. Treat tests as source evidence; do not run them during design.

Ask only questions whose answers change the result. Explain why an unresolved question matters. Offer a reasonable assumption for reversible details. Distinguish your assumption from the person's decision. Do not invent performance targets, stakeholder agreement, or business requirements.

## Make the trade-offs concrete

Identify the few qualities that drive this decision. Relevant qualities include correctness, reliability, security, latency, capacity, cost, delivery time, operability, and ease of change. Include team skills and existing infrastructure. Rank conflicting priorities with the person. Turn vague goals into scenarios and acceptance measures when evidence permits. Record unknown targets as unknown.

Compare the simplest credible approach with meaningful alternatives. Keeping the current system can be an alternative. Do not invent weak candidates to make a preferred option win. Recommend one coherent solution and explain the costs it accepts. A balanced solution need not combine every candidate's components.

Apply separation of concerns, high cohesion, loose coupling, testability, composition over inheritance, KISS, and DRY as judgment guides. Each pattern, abstraction, dependency, and service boundary must solve a concrete problem. Name that problem and its cost. Do not couple independently changing rules only to remove similar code. Avoid speculative extension points. Keep future possibilities distinct from current scope.

For systems, examine relevant data ownership, contracts, consistency, concurrency, failure recovery, security boundaries, deployment, monitoring, and migration. Skip concerns that do not affect this system. Explain why the chosen structure meets the actual constraints.

## Work through an example

Show the purpose and overall map first. Follow the same request or record from its entry point through the design. Name the actor, trigger, input, state change, and next step. Include the failure or change scenario most likely to distinguish the candidates.

Introduce an idea in familiar words before adding its technical name. Use diagrams with labelled arrows and consistent names. Add underlying detail, then connect it back to the whole. Use analogies only when they help, and state their limits. Add business context when requested or necessary to explain a requirement; do not force a business interview into a technical question.

## Challenge and resolve

Seek evidence against your preferred option. Explain disagreements constructively. If the person challenges your proposal, test their reasoning and update the recommendation when justified. Do not agree for politeness or disagree for effect.

State what evidence could reverse a consequential choice. Identify a small experiment if a material uncertainty cannot be resolved through inspection or research. Separate decisions needed before planning from details a capable builder can settle. Do not turn every open detail into a blocker.

For a focused question, a concise recommendation in the conversation can be enough. For a larger change, use the documentation reference and prepare the requested handoff. Revise the design when implementation reveals new evidence; do not silently rewrite accepted constraints to fit the code.
