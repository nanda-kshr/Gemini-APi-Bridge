type GeminiCallInput = {
  apiKey: string;
  modelName: string;
  prompt: string;
  systemprompt?: string;
};

class GeminiApiError extends Error {
  status: number;
  retryAfterSeconds?: number;

  constructor(message: string, status: number, retryAfterSeconds?: number) {
    super(message);
    this.name = "GeminiApiError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function parseRetryAfter(headerValue: string | null): number | undefined {
  if (!headerValue) {
    return undefined;
  }

  const asInt = Number.parseInt(headerValue, 10);
  if (!Number.isNaN(asInt) && asInt > 0) {
    return asInt;
  }

  const asDate = Date.parse(headerValue);
  if (Number.isNaN(asDate)) {
    return undefined;
  }

  const seconds = Math.ceil((asDate - Date.now()) / 1000);
  return seconds > 0 ? seconds : undefined;
}

function extractContentText(payload: unknown): string {
  const response = payload as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };

  const text = response.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("")
    .trim();

  return text || "";
}

export async function callGeminiApi(input: GeminiCallInput): Promise<string> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    input.modelName,
  )}:generateContent?key=${encodeURIComponent(input.apiKey)}`;

  const body = {
    ...(input.systemprompt
      ? {
          systemInstruction: {
            parts: [{ text: input.systemprompt }],
          },
        }
      : {}),
    contents: [
      {
        role: "user",
        parts: [{ text: input.prompt }],
      },
    ],
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const responseJson = (await response.json().catch(() => null)) as
    | { error?: { message?: string } }
    | null;

  if (!response.ok) {
    const message = responseJson?.error?.message ?? "Gemini API request failed";
    throw new GeminiApiError(
      message,
      response.status,
      parseRetryAfter(response.headers.get("retry-after")),
    );
  }

  const content = extractContentText(responseJson);
  if (!content) {
    throw new GeminiApiError("Gemini API returned empty content", 502);
  }

  return content;
}

export { GeminiApiError };
