async function readJsonPayload<T>(response: Response): Promise<T & { error?: string }> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T & { error?: string };
  } catch {
    throw new Error(
      response.ok
        ? "Server returned a non-JSON response"
        : "Server error (not JSON). Check `docker compose logs deck` or LumiVoice server logs.",
    );
  }
}

export async function apiJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const payload = await readJsonPayload<T>(response);
  if (!response.ok) {
    throw new Error(payload.error ?? "Request failed");
  }
  return payload;
}
