export const parseKeyValueLines = (raw: string): Record<string, string> => {
  const out: Record<string, string> = {};

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      continue;
    }

    if (trimmed.startsWith("=") || trimmed.startsWith(":")) {
      throw new Error(`Invalid key-value line '${trimmed}'. Key cannot be empty.`);
    }

    const eqIndex = trimmed.indexOf("=");
    const colonIndex = trimmed.indexOf(":");
    let splitIndex = -1;

    if (eqIndex > 0 && (colonIndex < 0 || eqIndex < colonIndex)) {
      splitIndex = eqIndex;
    } else if (colonIndex > 0) {
      splitIndex = colonIndex;
    }

    if (splitIndex <= 0) {
      throw new Error(`Invalid key-value line '${trimmed}'. Use KEY=VALUE or Key: Value.`);
    }

    const key = trimmed.slice(0, splitIndex).trim();
    const value = trimmed.slice(splitIndex + 1).trim();

    if (key.length === 0) {
      throw new Error(`Empty key in line '${trimmed}'.`);
    }

    out[key] = value;
  }

  return out;
};

export const parseJsonObject = (raw: string, label: string): Record<string, unknown> => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${label} must be valid JSON.`);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }

  return parsed as Record<string, unknown>;
};

export const formatTimestamp = (iso: string | null): string => {
  if (!iso) {
    return "Never";
  }

  const date = new Date(iso);

  if (!Number.isFinite(date.getTime())) {
    return "Invalid date";
  }

  return date.toLocaleString();
};

export const parseCommaTags = (raw: string): string[] => {
  const tags: string[] = [];

  for (const part of raw.split(",")) {
    const trimmed = part.trim();

    if (trimmed.length > 0) {
      tags.push(trimmed);
    }
  }

  return tags;
};
