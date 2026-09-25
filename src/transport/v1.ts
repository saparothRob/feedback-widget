/**
 * The v1 contract: `/api/v1/feedback/*`.
 *
 * snake_case on the wire. Supports custom fields, file attachments, and the
 * chunked replay protocol for replays too large to fit one request even gzipped.
 */
import type { Draft, SubmitContext, SubmitResult, Transport, TransportDeps } from "./index.js";
import type { V1IngestResponse, V1ReplayChunk, V1Submission, WireEvent } from "../wire.js";
import { FeedbackApiError, postFile, postJson } from "./http.js";

/**
 * Cloud Run hard-caps a request at 32 MiB and its own 413 carries no CORS
 * headers, so an oversized POST surfaces in the browser as a phantom CORS error
 * rather than a readable response. Stay well under it and let the chunk protocol
 * take over.
 */
const INLINE_LIMIT_BYTES = 24 * 1024 * 1024;
const EVENTS_PER_CHUNK = 2_000;

/** Rough byte cost of the events array without serialising it twice. */
function estimateBytes(events: WireEvent[]): number {
  if (events.length === 0) return 0;
  const sample = events.slice(0, Math.min(50, events.length));
  const perEvent = JSON.stringify(sample).length / sample.length;
  return Math.round(perEvent * events.length);
}

export function createV1Transport(deps: TransportDeps): Transport {
  const url = (path: string): string => `${deps.endpoint}${path}`;

  async function uploadChunks(id: string, events: WireEvent[]): Promise<void> {
    for (let offset = 0; offset < events.length; offset += EVENTS_PER_CHUNK) {
      const chunk: V1ReplayChunk = {
        seq_offset: offset,
        events: events.slice(offset, offset + EVENTS_PER_CHUNK),
      };
      // One retry per slice. Because event 0 is always a full snapshot, any
      // stored prefix is playable - an abandoned upload degrades to a truncated
      // replay rather than a broken one, so giving up here is survivable.
      try {
        await postJson(url(`/api/v1/feedback/${id}/replay-chunks`), deps.publicKey, chunk);
      } catch {
        try {
          await postJson(url(`/api/v1/feedback/${id}/replay-chunks`), deps.publicKey, chunk);
        } catch {
          break;
        }
      }
    }

    try {
      await postJson(url(`/api/v1/feedback/${id}/replay-complete`), deps.publicKey, {});
    } catch (err) {
      // A duplicate complete answers 409 replay_not_pending, which means some
      // earlier call already finalised it. That is success.
      if (!(err instanceof FeedbackApiError && err.code === "replay_not_pending")) throw err;
    }
  }

  return {
    kind: "v1",

    async submit(draft: Draft, ctx: SubmitContext): Promise<SubmitResult> {
      const events = ctx.config.replay.enabled ? ctx.events : [];
      const chunked = ctx.config.supportsChunks && estimateBytes(events) > INLINE_LIMIT_BYTES;

      const body: V1Submission = {
        kind: draft.kind,
        title: draft.title,
        message: draft.message,
        submitter_name: ctx.user.name ?? null,
        submitter_email: draft.email ?? ctx.user.email ?? null,
        submitter_id: ctx.user.id ?? null,
        page_url: ctx.pageUrl,
        user_agent: ctx.userAgent,
        viewport_width: ctx.viewportWidth,
        viewport_height: ctx.viewportHeight,
        screenshot: draft.screenshot,
        metadata: ctx.metadata,
        session_id: ctx.sessionId,
        replay_started_at:
          ctx.replayStartedAt === null ? null : new Date(ctx.replayStartedAt).toISOString(),
        custom_fields: draft.answers,
        replay_events: chunked ? [] : events,
        ...(chunked ? { replay_pending: true } : {}),
      };

      const created = await postJson<V1IngestResponse>(
        url("/api/v1/feedback/ingest"),
        deps.publicKey,
        body,
      );
      const id = created.id;

      if (chunked) await uploadChunks(id, events);

      // Attachments are independent of each other and of the report body: one
      // failure must not cost the others, and none of them may cost the report.
      if (ctx.config.attachments && draft.files.length > 0) {
        await Promise.allSettled(
          draft.files.map((file) =>
            postFile(url(`/api/v1/feedback/${id}/attachments`), deps.publicKey, file),
          ),
        );
      }

      return { id };
    },
  };
}
