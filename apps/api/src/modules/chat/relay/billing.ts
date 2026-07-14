import { redis } from "../../../utils/redis";
import {
  ApiKeySpendLedgerUnavailableError,
  ApiKeySpendLimitExceededError,
} from "../../keys/services";

export type ChatSpendLimits = {
  apiKeyId: string;
  ownerId?: string;
  apiKeyLimitUsd?: number | null;
  ownerLimitUsd?: number | null;
};

export type ChatSpendReservation = {
  requestId: string;
  limits: ChatSpendLimits;
  reservedUsd: number;
};

const RESERVATION_TTL_SECONDS = 24 * 60 * 60;

const RESERVE_SCRIPT = `
local existing = redis.call('HGET', KEYS[3], 'amount')
if existing then return {1, existing} end
local amount = tonumber(ARGV[1])
local apiLimit = tonumber(ARGV[2])
local ownerLimit = tonumber(ARGV[3])
local hasOwner = ARGV[4] == '1'
local apiSpent = tonumber(redis.call('GET', KEYS[1]) or '0')
local ownerSpent = hasOwner and tonumber(redis.call('GET', KEYS[2]) or '0') or 0
if apiLimit >= 0 and apiSpent + amount > apiLimit then return {0, 'api_key'} end
if hasOwner and ownerLimit >= 0 and ownerSpent + amount > ownerLimit then return {0, 'owner'} end
redis.call('INCRBYFLOAT', KEYS[1], amount)
if hasOwner then redis.call('INCRBYFLOAT', KEYS[2], amount) end
redis.call('HSET', KEYS[3], 'state', 'pending', 'amount', amount)
redis.call('EXPIRE', KEYS[3], ARGV[5])
return {1, tostring(amount)}
`;

const EXPAND_SCRIPT = `
local state = redis.call('HGET', KEYS[3], 'state')
if state ~= 'pending' then return {0, 'not_pending'} end
local current = tonumber(redis.call('HGET', KEYS[3], 'amount') or '0')
local target = tonumber(ARGV[1])
if target <= current then return {1, tostring(current)} end
local delta = target - current
local apiLimit = tonumber(ARGV[2])
local ownerLimit = tonumber(ARGV[3])
local hasOwner = ARGV[4] == '1'
local apiSpent = tonumber(redis.call('GET', KEYS[1]) or '0')
local ownerSpent = hasOwner and tonumber(redis.call('GET', KEYS[2]) or '0') or 0
if apiLimit >= 0 and apiSpent + delta > apiLimit then return {0, 'api_key'} end
if hasOwner and ownerLimit >= 0 and ownerSpent + delta > ownerLimit then return {0, 'owner'} end
redis.call('INCRBYFLOAT', KEYS[1], delta)
if hasOwner then redis.call('INCRBYFLOAT', KEYS[2], delta) end
redis.call('HSET', KEYS[3], 'amount', target)
return {1, tostring(target)}
`;

const SETTLE_SCRIPT = `
local state = redis.call('HGET', KEYS[3], 'state')
if state == 'settled' or state == 'refunded' then
  return {1, redis.call('HGET', KEYS[3], 'actual') or redis.call('HGET', KEYS[3], 'amount') or '0'}
end
if state ~= 'pending' then return {0, 'not_pending'} end
local current = tonumber(redis.call('HGET', KEYS[3], 'amount') or '0')
local actual = tonumber(ARGV[1])
local delta = actual - current
local hasOwner = ARGV[2] == '1'
if delta ~= 0 then
  redis.call('INCRBYFLOAT', KEYS[1], delta)
  if hasOwner then redis.call('INCRBYFLOAT', KEYS[2], delta) end
end
redis.call('HSET', KEYS[3], 'state', 'settled', 'actual', actual)
redis.call('EXPIRE', KEYS[3], ARGV[3])
return {1, tostring(actual)}
`;

const REFUND_SCRIPT = `
local state = redis.call('HGET', KEYS[3], 'state')
if state == 'refunded' or state == 'settled' then return {1, state} end
if state ~= 'pending' then return {0, 'not_pending'} end
local amount = tonumber(redis.call('HGET', KEYS[3], 'amount') or '0')
local hasOwner = ARGV[1] == '1'
local apiSpent = math.max(tonumber(redis.call('GET', KEYS[1]) or '0') - amount, 0)
redis.call('SET', KEYS[1], apiSpent)
if hasOwner then
  local ownerSpent = math.max(tonumber(redis.call('GET', KEYS[2]) or '0') - amount, 0)
  redis.call('SET', KEYS[2], ownerSpent)
end
redis.call('HSET', KEYS[3], 'state', 'refunded', 'actual', 0)
redis.call('EXPIRE', KEYS[3], ARGV[2])
return {1, 'refunded'}
`;

function reservationKeys(input: ChatSpendLimits, requestId: string): [string, string, string] {
  return [
    `apikey_spend:${input.apiKeyId}`,
    input.ownerId ? `user_spend:${input.ownerId}` : `chat_spend:no_owner:${requestId}`,
    `chat_spend_reservation:${requestId}`,
  ];
}

function limitArg(limit: number | null | undefined): string {
  return limit === null || limit === undefined ? "-1" : String(limit);
}

function resultArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function accepted(value: unknown): boolean {
  const first = resultArray(value)[0];
  return first === 1 || first === "1";
}

function hasSpendLimit(input: ChatSpendLimits): boolean {
  return input.apiKeyLimitUsd != null || input.ownerLimitUsd != null;
}

export async function reserveChatSpend(
  limits: ChatSpendLimits,
  requestId: string,
  amountUsd: number,
): Promise<ChatSpendReservation | null> {
  if (!hasSpendLimit(limits)) return null;
  if (limits.ownerLimitUsd != null && !limits.ownerId) {
    throw new ApiKeySpendLedgerUnavailableError(
      new Error("owner ID is required to enforce the owner spend limit"),
    );
  }
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    throw new ApiKeySpendLimitExceededError();
  }

  try {
    const keys = reservationKeys(limits, requestId);
    const result = await redis.eval(
      RESERVE_SCRIPT,
      3,
      ...keys,
      String(amountUsd),
      limitArg(limits.apiKeyLimitUsd),
      limitArg(limits.ownerLimitUsd),
      limits.ownerId ? "1" : "0",
      String(RESERVATION_TTL_SECONDS),
    );
    if (!accepted(result)) throw new ApiKeySpendLimitExceededError();
    return { requestId, limits, reservedUsd: amountUsd };
  } catch (error) {
    if (error instanceof ApiKeySpendLimitExceededError) throw error;
    throw new ApiKeySpendLedgerUnavailableError(error);
  }
}

export async function expandChatSpendReservation(
  reservation: ChatSpendReservation | null,
  targetUsd: number,
): Promise<void> {
  if (!reservation || targetUsd <= reservation.reservedUsd) return;
  try {
    const keys = reservationKeys(reservation.limits, reservation.requestId);
    const result = await redis.eval(
      EXPAND_SCRIPT,
      3,
      ...keys,
      String(targetUsd),
      limitArg(reservation.limits.apiKeyLimitUsd),
      limitArg(reservation.limits.ownerLimitUsd),
      reservation.limits.ownerId ? "1" : "0",
    );
    if (!accepted(result)) throw new ApiKeySpendLimitExceededError();
    reservation.reservedUsd = targetUsd;
  } catch (error) {
    if (error instanceof ApiKeySpendLimitExceededError) throw error;
    throw new ApiKeySpendLedgerUnavailableError(error);
  }
}

export async function settleChatSpendReservation(
  reservation: ChatSpendReservation | null,
  actualUsd?: number,
): Promise<void> {
  if (!reservation) return;
  const settledUsd =
    actualUsd !== undefined && Number.isFinite(actualUsd) && actualUsd >= 0
      ? actualUsd
      : reservation.reservedUsd;
  let lastError: unknown;
  for (const delayMs of [0, 25, 100, 250]) {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    try {
      const keys = reservationKeys(reservation.limits, reservation.requestId);
      const result = await redis.eval(
        SETTLE_SCRIPT,
        3,
        ...keys,
        String(settledUsd),
        reservation.limits.ownerId ? "1" : "0",
        String(RESERVATION_TTL_SECONDS),
      );
      if (!accepted(result)) throw new Error("spend reservation is not pending");
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw new ApiKeySpendLedgerUnavailableError(lastError);
}

export async function refundChatSpendReservation(
  reservation: ChatSpendReservation | null,
): Promise<void> {
  if (!reservation) return;
  try {
    const keys = reservationKeys(reservation.limits, reservation.requestId);
    const result = await redis.eval(
      REFUND_SCRIPT,
      3,
      ...keys,
      reservation.limits.ownerId ? "1" : "0",
      String(RESERVATION_TTL_SECONDS),
    );
    if (!accepted(result)) throw new Error("spend reservation is not pending");
  } catch (error) {
    throw new ApiKeySpendLedgerUnavailableError(error);
  }
}
