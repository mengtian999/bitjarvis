import { Hono } from "hono";
import { safeJson } from "../hono-helpers.ts";
import { denyWithoutScope } from "../http/capability-guard.ts";
import { recordSecurityAuditEvent } from "../http/security-audit.ts";

export function createSpeechGenerationRoute(engine) {
  const route = new Hono();

  route.get("/speech-generation/providers", async (c) => {
    try {
      return c.json(requireTtsService(engine).listProviders());
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  route.post("/speech-generation/synthesize", async (c) => {
    try {
      const body = await safeJson(c);
      const result = await requireTtsService(engine).synthesize(body || {});
      return c.json(result);
    } catch (err) {
      return c.json({ error: err.message }, 400);
    }
  });

  /** SSE streaming TTS synthesis endpoint. */
  route.post("/speech-generation/synthesize-stream", async (c) => {
    try {
      const body = await safeJson(c);
      if (!body || !body.text) return c.json({ error: "text required" }, 400);
      const tts = requireTtsService(engine);
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      const sendEvent = (event, data) => {
        writer.write(encoder.encode("event: " + event + "\n"));
        writer.write(encoder.encode("data: " + JSON.stringify(data) + "\n\n"));
      };

      // Fire-and-forget streaming: write events as chunks arrive
      tts.synthesizeStream(body,
        (chunk) => {
          try {
            const b64 = Buffer.from(chunk).toString("base64");
            sendEvent("chunk", { data: b64 });
          } catch {}
        },
        () => {
          try { sendEvent("end", {}); writer.close(); } catch {}
        },
      ).catch((err) => {
        try { sendEvent("error", { message: err.message }); writer.close(); } catch {}
      });

      return new Response(readable, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      });
    } catch (err) {
      return c.json({ error: err.message }, 400);
    }
  });

  route.put("/speech-generation/config", async (c) => {
    try {
      const denied = denyWithoutScope(c, "settings.write");
      if (denied) return denied;
      const body = await safeJson(c);
      const values = body?.values && typeof body.values === "object" && !Array.isArray(body.values)
        ? body.values
        : body;
      const config = requireTtsService(engine).setConfig(values || {});
      recordSecurityAuditEvent(c, engine, {
        action: "settings.tts.update",
        target: "tts",
        metadata: { enabled: config.enabled === true },
      });
      return c.json({ ok: true, config });
    } catch (err) {
      return c.json({ error: err.message }, 400);
    }
  });

  return route;
}

function requireTtsService(engine) {
  if (!engine?.tts) throw new Error("text-to-speech service unavailable");
  return engine.tts;
}
