import { expect, it, vi } from "vitest";
const query = vi.hoisted(() => vi.fn());
vi.mock("./database.js", () => ({ withScope: (_scope: unknown, operation: (client: unknown) => unknown) => operation({ query }) }));
import { currentPromotedEvidenceKeys } from "./current-evidence.js";

it("authorizes index hits only against the latest completed SQL enrichment revision", async () => {
  const current = "00000000-0000-4000-8000-000000000001", previous = "00000000-0000-4000-8000-000000000002";
  query.mockResolvedValue({ rows: [{ result_key: `evidence:${current}` }] });
  const keys = await currentPromotedEvidenceKeys({ tenantId: "tenant", workspaceId: "workspace" }, [{ id: current }, { id: previous }]);
  expect(keys.has(`evidence:${current}`)).toBe(true);
  expect(keys.has(`evidence:${previous}`)).toBe(false);
  expect(query).toHaveBeenCalledWith(expect.stringContaining("decision.job_id="), [[current, previous]]);
});
