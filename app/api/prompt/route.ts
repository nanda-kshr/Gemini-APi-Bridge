import { NextRequest, NextResponse } from "next/server";

import { callGeminiApi, GeminiApiError } from "@/lib/gemini";
import { ensureBridgeIndexes, getBridgeDb } from "@/lib/mongodb";

type PromptBody = {
  systemprompt?: string;
  prompt?: string;
  mode?: "free" | "paid";
  loop?: boolean;
};

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const clientKey = request.headers.get("x-api-key");
  if (!clientKey) {
    return NextResponse.json({ error: "Missing X-API-KEY header" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as PromptBody | null;
  if (!body?.prompt || !body?.mode) {
    return NextResponse.json(
      { error: "'prompt' and 'mode' are required" },
      { status: 400 },
    );
  }

  if (typeof body.prompt !== "string" || body.prompt.trim().length === 0) {
    return NextResponse.json({ error: "'prompt' must be a non-empty string" }, { status: 400 });
  }

  if (body.mode !== "free" && body.mode !== "paid") {
    return NextResponse.json({ error: "'mode' must be 'free' or 'paid'" }, { status: 400 });
  }

  if (body.systemprompt !== undefined && typeof body.systemprompt !== "string") {
    return NextResponse.json({ error: "'systemprompt' must be a string" }, { status: 400 });
  }

  if (body.loop !== undefined && typeof body.loop !== "boolean") {
    return NextResponse.json({ error: "'loop' must be a boolean" }, { status: 400 });
  }

  const loop = Boolean(body.loop);

  await ensureBridgeIndexes();
  const { collection } = await getBridgeDb();

  const client = await collection("internal_clients").findOne({
    api_key: clientKey,
    status: "active",
  });

  if (!client) {
    return NextResponse.json({ error: "Invalid Bridge Key" }, { status: 401 });
  }

  const now = new Date();

  const keys = await collection("gemini_pool")
    .find({
      mode: body.mode,
      $or: [
        { is_rate_limited: { $ne: true } },
        { is_rate_limited: true, rate_limit_expiry: { $lte: now } },
      ],
    })
    .sort({ last_used: 1, _id: 1 })
    .toArray();

  if (keys.length === 0) {
    return NextResponse.json(
      { error: "No healthy keys available" },
      { status: 503 },
    );
  }

  const candidateKeys = loop ? keys : keys.slice(0, 1);

  for (const geminiKey of candidateKeys) {
    try {
      if (geminiKey.is_rate_limited && geminiKey.rate_limit_expiry) {
        await collection("gemini_pool").updateOne(
          { _id: geminiKey._id },
          {
            $set: {
              is_rate_limited: false,
              rate_limit_expiry: null,
            },
          },
        );
      }

      console.log(`Selected key id=${geminiKey._id} model=${geminiKey.model_name} for request`);

      const content = await callGeminiApi({
        apiKey: geminiKey.key_value,
        modelName: geminiKey.model_name,
        prompt: body.prompt,
        systemprompt: body.systemprompt,
      });

      await collection("gemini_pool").updateOne(
        { _id: geminiKey._id },
        {
          $set: {
            last_used: new Date(),
            is_rate_limited: false,
            rate_limit_expiry: null,
          },
        },
      );

      return NextResponse.json({ content, model: geminiKey.model_name });
    } catch (error) {
      console.error(error);
      if (error instanceof GeminiApiError && (error.status === 429 || error.status === 503)) {
        const ttlSeconds = error.retryAfterSeconds ?? 60;
        const rateLimitExpiry = new Date(Date.now() + ttlSeconds * 1000);

        await collection("gemini_pool").updateOne(
          { _id: geminiKey._id },
          {
            $set: {
              is_rate_limited: true,
              rate_limit_expiry: rateLimitExpiry,
            },
          },
        );

        console.log(
          `Key id=${geminiKey._id} model=${geminiKey.model_name} marked rate-limited until=${rateLimitExpiry.toISOString()}; switching to next key`,
        );

        if (!loop) {
          return NextResponse.json(
            {
              error:
                error.status === 503
                  ? "Selected key is unavailable (503) and loop=false"
                  : "Selected key is rate-limited and loop=false",
              rate_limit_expiry: rateLimitExpiry.toISOString(),
            },
            { status: error.status === 503 ? 503 : 429 },
          );
        }

        continue;
      }

      const message =
        error instanceof Error ? error.message : "Unhandled bridge error";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  return NextResponse.json(
    { error: "All keys in the pool are currently rate-limited." },
    { status: 429 },
  );
}
