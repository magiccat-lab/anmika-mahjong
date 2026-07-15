function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== undefined) out[key] = canonicalValue(child);
    }
    return out;
  }
  return value;
}

/**
 * Deterministic JSON for persisted room state and portable paifu snapshots.
 * Undefined object properties are omitted in the same way as JSON.stringify;
 * array order remains significant and object keys are sorted recursively.
 */
export function serializeCanonical(value: unknown, space?: number): string {
  return JSON.stringify(canonicalValue(value), null, space);
}

/** Strip prototypes and references while preserving JSON data exactly. */
export function cloneCanonical<T>(value: T): T {
  return JSON.parse(serializeCanonical(value)) as T;
}
