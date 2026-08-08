/** The read-only fence for /<ens-or-address> views.
 *
 * On a view page the visitor is inspecting a wallet they don't own, so `address`
 * in the intent payload is the SUBJECT, not the signer. Calldata is meaningless
 * there — they can't sign for it — and a signable card would be a lie. The
 * prompt tells the agent not to build any; this module is what guarantees none
 * reaches the client, whichever engine answered. */

export const READ_ONLY_REFUSAL =
  "This is a read-only view — I can tell you anything about this wallet, but I can't build transactions for an address you don't control. Open your own wallet to do that.";

/** Tools that mint calldata. Withheld from a read-only turn — the cheapest way
 * to make "never builds a transaction" true rather than merely instructed. */
export const WRITE_TOOLS = new Set([
  "buildRoute",
  "buildTransfer",
  "buildENSRegistration",
  "buildUniV4Swap",
  "buildRevoke",
  "wrapEth",
  "unwrapWeth",
  "simulateAssetChanges",
  "traceCall",
]);

export function isTransactionPayload(payload: { type?: unknown }): boolean {
  return payload?.type === "transaction" || payload?.type === "multistep_transaction";
}

/** Same guarantee as the JSON path, applied to the bridge's SSE stream. Frames
 * are `data: {json}\n\n`; only a `done` frame carrying calldata is rewritten —
 * progress frames and anything unparseable pass through untouched. */
export function sanitizeReadOnlyStream(
  body: ReadableStream<Uint8Array>,
  refusal: string = READ_ONLY_REFUSAL,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  const rewriteFrame = (frame: string): string => {
    const line = frame.split("\n").find(l => l.startsWith("data: "));
    if (!line) return frame;
    try {
      const evt = JSON.parse(line.slice(6));
      if (evt?.type !== "done" || !evt.result || !isTransactionPayload(evt.result)) return frame;
      console.warn("[viewOnly] dropped built calldata from the agent's stream");
      return `data: ${JSON.stringify({ type: "done", result: { type: "chat", message: refusal } })}`;
    } catch {
      return frame;
    }
  };

  return new ReadableStream({
    async start(controller) {
      const reader = body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? ""; // keep the trailing partial frame
          for (const frame of frames) controller.enqueue(encoder.encode(`${rewriteFrame(frame)}\n\n`));
        }
        if (buffer.trim()) controller.enqueue(encoder.encode(rewriteFrame(buffer)));
        controller.close();
      } catch (err) {
        controller.error(err);
      } finally {
        reader.releaseLock();
      }
    },
    cancel(reason) {
      body.cancel(reason).catch(() => undefined);
    },
  });
}
