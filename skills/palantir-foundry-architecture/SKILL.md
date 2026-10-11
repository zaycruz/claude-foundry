---
name: palantir-foundry-architecture
description: Architect a Palantir Foundry solution from an approved discovery handoff into an outcome-traceable design and mandatory Solution Designer artifact. Use only when the outcome brief and prioritized use-case backlog are approved and architecture must resolve the SOO, Ontology, NOO, project, product, security, and deployment seams.
---

# Foundry outcome-backward architecture

Invoke `palantir-foundry-tools`. Use the Palantir MCP to validate selected capabilities against current official documentation.

## Vocabulary

- **SOO**: South of the Ontology: ingestion, processing, quality, lineage, and curated datasets.
- **Ontology seam**: Object Types, Link Types, Action Types, interfaces, API names, permissions, and contracts.
- **NOO**: North of the Ontology: workflows, applications, decisions, actions, Action Type invocation, and feedback.
- **Bias**: The layer where most complexity and value realization reside. SOO, NOO, seam, and bias are architecture terms, not Foundry product types.

## Process

1. **Validate the handoff.** Require an approved outcome brief and prioritized use-case backlog from `palantir-foundry-discovery`. Require evidence for users, baseline, target, and workflow. Return to discovery when either artifact lacks approval or evidence. Record remaining assumptions separately from evidence.

2. **Frame the outcome.** State the measurable client outcome, actor, changed decision or behavior, baseline, target, measurement method, and decision rule. Record stakeholders, constraints, risks, and non-goals. Complete the frame only when every field is explicit.

3. **Trace backward through every applicable layer.** Map the operational workflow. Map the NOO capabilities. Define the supporting Ontology seam. Identify the SOO sources, connections, transforms, Expectations, Checks, curated datasets, lineage, and failure-recovery needs. Add security boundaries, permissions, ownership, observability, and a feedback path from operational use to improvement. Trace every component to an outcome. Trace every outcome through each applicable layer. Mark omissions `not applicable` with a reason.

4. **Choose and challenge the bias.** Classify the design as SOO-biased, NOO-biased, or balanced. Compare time to user value, reuse, data quality, lineage, workflow fit, actionability, governance, deployment independence, and maintenance. Record benefits, costs, the rejected alternative, and a measurable reversal condition. For a balanced design, explain why neither bias dominates.

5. **Resolve implementation topology.** Prefer Foundry-native capabilities. Evaluate AIP Logic, Automate, Notepad, Workshop, and applicable alternatives. Put supported pro-code Ontology, Functions, and frontend work in SuperRepo. Use native-asset exceptions only where SuperRepo cannot define the component. Document each exception. Decide project boundaries, repositories, stores, Marketplace products, Developer Console applications, packaging, deployment units, owners, and release dependencies. Record Project Setup as a downstream stage when the design includes a repository, SuperRepo, Marketplace product, Developer Console application, multiple deployment units, or NOO component.

6. **Create the mandatory Solution Designer artifact.** Represent sources, integrations, processing, Ontology, Functions, applications, and users. Represent system and security boundaries, dependencies, deployment units, risks, and feedback. Link existing Foundry resources. Add the outcome, baseline, target, owners, open decisions, and outcome-to-component trace. Record its URL or identifier. Solution Designer is the authoritative review and implementation-planning artifact.

7. **Review and request approval.** Review backward from the outcome. Remove untraced components. Close missing workflow-to-Ontology-to-data connections. Recheck capability claims with the Palantir MCP. In the architecture handoff, include the outcome frame and evidence status; workflow; assumptions and constraints; SOO, Ontology seam, and NOO designs; bias decision and reversal condition; capability decisions and exceptions; security, governance, ownership, observability, and feedback; project, product, packaging, and deployment topology; risks and open decisions; Solution Designer identifier; and official sources used. Identify applicable downstream SOO, Ontology, and NOO implementation stages. The approval gate passes only when reviewers approve this handoff. The Solution Designer artifact must also be available. If Solution Designer is unavailable, mark the gate as blocked. Label any entry plan as a draft. After approval, invoke `palantir-foundry-project-setup` when its recorded conditions apply.
