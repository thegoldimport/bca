export function projectCollectionFromResponse(
  response: unknown,
  collectionKeys: readonly string[],
): unknown[] {
  if (Array.isArray(response)) return response;
  if (response && typeof response === "object") {
    const record = response as Record<string, unknown>;
    for (const key of collectionKeys) {
      if (Array.isArray(record[key])) return record[key] as unknown[];
    }
  }
  throw new Error("The project service returned an unexpected list response.");
}
