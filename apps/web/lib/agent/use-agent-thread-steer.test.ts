import { afterEach, describe, expect, it, vi } from "vitest";

import { waitForCommittedUserMessage } from "./use-agent-thread";

describe("managed workflow steer confirmation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("accepts an SSE confirmation without issuing a duplicate read", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      waitForCommittedUserMessage("thread-1", "client-1", () => true, vi.fn()),
    ).resolves.toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("recovers an accepted steer after the response connection is ambiguous", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("connection lost"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            messages: [
              {
                id: "message-1",
                sequence: 1,
                turnId: "turn-1",
                role: "user",
                content: "标题改得更克制",
                clientId: "client-1",
                delivery: "committed",
                status: "completed",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", { setTimeout: (callback: () => void) => (callback(), 0) });

    await expect(
      waitForCommittedUserMessage("thread-1", "client-1", () => false, vi.fn()),
    ).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not treat an unrelated Turn completion as steer confirmation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ messages: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", { setTimeout: (callback: () => void) => (callback(), 0) });

    await expect(
      waitForCommittedUserMessage("thread-1", "client-1", () => false, vi.fn(), 1, 0),
    ).resolves.toBe(false);
  });
});
