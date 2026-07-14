import { afterEach, describe, expect, it, vi } from "vitest";

const { mockEval } = vi.hoisted(() => ({ mockEval: vi.fn() }));

vi.mock("../../../../src/utils/redis", () => ({
  redis: { eval: mockEval },
}));

import {
  ApiKeySpendLedgerUnavailableError,
  ApiKeySpendLimitExceededError,
} from "../../../../src/modules/keys/services";
import {
  expandChatSpendReservation,
  refundChatSpendReservation,
  reserveChatSpend,
  settleChatSpendReservation,
} from "../../../../src/modules/chat/relay/billing";

describe("chat spend reservations", () => {
  afterEach(() => vi.clearAllMocks());

  it("atomically reserves against independent API key and owner limits", async () => {
    mockEval.mockResolvedValueOnce([1, "0.25"]);
    const reservation = await reserveChatSpend(
      {
        apiKeyId: "key-1",
        ownerId: "user-1",
        apiKeyLimitUsd: 5,
        ownerLimitUsd: 10,
      },
      "request-1",
      0.25,
    );

    expect(reservation).toMatchObject({ requestId: "request-1", reservedUsd: 0.25 });
    expect(mockEval).toHaveBeenCalledWith(
      expect.stringContaining("apiSpent + amount"),
      3,
      "apikey_spend:key-1",
      "user_spend:user-1",
      "chat_spend_reservation:request-1",
      "0.25",
      "5",
      "10",
      "1",
      "86400",
    );
  });

  it("rejects a reservation when either atomic limit check fails", async () => {
    mockEval.mockResolvedValueOnce([0, "owner"]);
    await expect(
      reserveChatSpend(
        { apiKeyId: "key-1", ownerId: "user-1", ownerLimitUsd: 1 },
        "request-1",
        0.5,
      ),
    ).rejects.toBeInstanceOf(ApiKeySpendLimitExceededError);
  });

  it("expands, settles, and refunds the same idempotent reservation", async () => {
    mockEval
      .mockResolvedValueOnce([1, "0.2"])
      .mockResolvedValueOnce([1, "0.4"])
      .mockResolvedValueOnce([1, "0.3"])
      .mockResolvedValueOnce([1, "settled"]);
    const reservation = await reserveChatSpend(
      { apiKeyId: "key-1", apiKeyLimitUsd: 1 },
      "request-1",
      0.2,
    );

    await expandChatSpendReservation(reservation, 0.4);
    expect(reservation?.reservedUsd).toBe(0.4);
    await settleChatSpendReservation(reservation, 0.3);
    await refundChatSpendReservation(reservation);
    expect(mockEval).toHaveBeenCalledTimes(4);
  });

  it("fails closed when Redis cannot make the reservation", async () => {
    mockEval.mockRejectedValueOnce(new Error("redis offline"));
    await expect(
      reserveChatSpend({ apiKeyId: "key-1", apiKeyLimitUsd: 1 }, "request-1", 0.2),
    ).rejects.toBeInstanceOf(ApiKeySpendLedgerUnavailableError);
  });

  it("fails closed when an owner limit has no owner ledger identity", async () => {
    await expect(
      reserveChatSpend({ apiKeyId: "key-1", ownerLimitUsd: 1 }, "request-1", 0.2),
    ).rejects.toBeInstanceOf(ApiKeySpendLedgerUnavailableError);
    expect(mockEval).not.toHaveBeenCalled();
  });
});
