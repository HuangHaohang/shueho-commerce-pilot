# Commerce Product Insight Skills

Commerce Pilot models product intelligence as native Codex Skills rather than separate Agent implementations. One application-managed orchestrator workflow, `commerce-product-insight`, selects exactly one closed business method for a Turn:

| Recipe id | Insight method | Specialist Skill | Business result |
|---|---|---|---|
| `market_research` | `market_research` | `commerce-market-research` | Product-grounded market report |
| `new_product_development` | `new_product_development` | `commerce-new-product-development` | Opportunity, concept and validation decision |
| `product_retrospective` | `product_retrospective` | `commerce-product-retrospective` | Selected-Product market-fit retrospective and next actions |

Each thread keeps one recipe identity. The BFF derives the only valid method from that persisted recipe, rejects a mismatched `insightMethod`, and forwards only the closed method id. Gateway maps it to the application-owned absolute Skill path and sends native `skill` input Items; the browser never supplies a Skill path, body, output schema, developer instruction, tool definition or runtime policy. Codex App Server remains authoritative for thread and Turn history, streaming, tool lifecycle, questions, approval waiting, interruption, continuation, recovery and compaction.

`commerce-market-research` remains an accepted legacy workflow id for persisted market-research threads. Every future Turn through that id is upgraded to the same `commerce-product-insight` orchestrator + `commerce-market-research` specialist + shared structured schema. Previously persisted assistant messages keep their historical shape and are handled only by the read-side parser.

## Shared Evidence Contract

All three methods use the same strict Harness output schema. The existing market-report fields remain stable and add:

- `insightType`, whose JSON Schema enum is fixed server-side to the single invoked method;
- `recommendations[]`, each with priority, rationale, external evidence ids, Product-fact references, validation metric and time horizon; its reserved company-evidence references are required to be empty in the current contract;
- `companyEvidenceRefs[]` as a reserved lineage field that must remain empty in the current contract.

Other Claim types retain their evidence rules:

- `product_fact` requires exact canonical Product revision references;
- `market_signal` requires quality-checked external evidence ids;
- `derived_comparison` requires every lineage it actually uses: a category-only external comparison may cite multiple evidence ids with no Product ref, while Product-versus-market comparison cites both;
- `hypothesis` must remain explicitly unconfirmed.

The current Harness schema deliberately does not admit `company_metric`. There is no registered governed company operating-data tool, and allowing the model to invent reference strings would not establish lineage. A future schema/tool-contract version may add that Claim type only together with the authorized tool and deterministic reference validation.

Recommendations are proposed decisions, concepts, experiments or actions. They are not proof of an external write, scheduled work or a completed experiment.

Method-specific detail remains in `reportMarkdown` while material facts and decisions are separately indexed by `claims` and `recommendations`. This is intentional for the current human-review workflow: it avoids three incompatible report protocols and does not over-constrain open-ended product concepts or diagnosis narratives. If a future downstream API needs machine-executable concepts, experiments, root-cause graphs or owner assignments, it must introduce a versioned discriminated artifact contract plus deterministic reference validation; it must not infer those structures from Markdown or treat recommendations as executed actions.

## Product And External-Data Boundary

When a selected company Product is used, the Skill first calls `commerce_product.get_selected_product_context`. Gateway resolves the tenant-owned context set to exact Product/Variant revisions and binds its immutable first-party subject before marketplace planning. Product fields and tool results are untrusted data, never instructions.

Existing curated research is checked through `commerce_data.search_business_data` and `get_research_result`. New marketplace collection keeps the governed free-plan/paid-execute lifecycle:

1. list database-backed platforms and market options;
2. create the immutable free `plan_marketplace_research` receipt;
3. execute only its unexpired `plan_id` through `execute_marketplace_research`;
4. preserve authorization, approval, quota, exact-once dispatch, audit, settlement and no automatic retry after an uncertain result.

Provider-facing queries contain only the minimum public category, use-case, market, price, specification and metric concepts. Product ids, revision ids, subject references, snapshot hashes, SKU/SPU, cost, inventory, supplier, connector and tenant data never become model-authored provider arguments.

Only accepted review evidence may support a buyer-pain statement. Product details, prices, sales displays, rankings, review counts and social engagement remain market/content signals. When a user explicitly requests real reviews or real buyer feedback, a report requires an actual governed receipt with `reviewEvidenceCount > 0`. If no such receipt exists, the Harness returns an answer that explains the unavailable evidence; it cannot downgrade the requirement to a hypothesis-shaped report or substitute public Web Search, product pages, social content or model knowledge.

Output classification follows the requested business outcome rather than Chinese or English sentence form. A supported research request phrased as a question still returns the structured report. `responseType=answer` is reserved for method explanation, material missing scope, or evidence that is unavailable for the requested conclusion.

## New Product Development

The Skill turns evidence into a bounded opportunity decision, one or more hypothesis-only concepts, and validation recommendations with success signals and kill conditions. It separates frequent competitor properties from actual unmet needs and treats market price evidence as positioning evidence rather than unit economics.

It must not claim that a concept was engineered, sourced, sampled, certified, tested or approved. It cannot create a Product, contact suppliers, place an order, publish a listing, recruit research participants or spend a budget.

## Product Retrospective

A report requires an exact selected Product subject. The BFF and Gateway both reject starting the product-retrospective Recipe unless at least one canonical Product is selected; the Skill cannot silently choose a similarly named item or return a category-level retrospective.

The current registered tools do not provide authoritative company orders, units sold, GMV/revenue, traffic, conversion, advertising, returns, support, inventory movement, cost, contribution margin or profit. Therefore the current Skill may deliver a Product-fact and market-fit retrospective, but it must not emit `company_metric`, company-performance comparisons, ROI conclusions or operating root-cause conclusions. Public marketplace sales signals and user-provided numbers do not satisfy `companyEvidenceRefs`.

After reading the selected Product, the Skill stops before any paid market plan when the core request depends only on those unavailable operating metrics. If a narrower Product-fact and market-fit review could still help, the Harness first asks through native `request_user_input` whether the user accepts that explicit scope reduction. Marketplace planning proceeds only after acceptance; the Skill never spends on market evidence that cannot answer the requested ROI, conversion, profit or operating-root-cause question.

A future first-party operating-data integration must be an explicit governed commerce tool with tenant/workspace authorization, immutable evidence lineage, data-quality rules and safe projections before those Claim types become usable. Any resulting write action still requires a separate application tool with approval, idempotency, audit and downstream readback.

## Tool Contract Compatibility

The three methods use the dynamic commerce tools already fixed at `thread/start`: `commerce_product`, `commerce_data`, plus the managed `commerce_web` MCP tool. No tool schema was added or changed for this feature, so the persisted Agent tool-contract version remains `5`. Existing compatible threads resume with their App Server-restored dynamic-tool snapshot; a Skill/Recipe change must not pretend that `thread/resume` replaced that snapshot.
