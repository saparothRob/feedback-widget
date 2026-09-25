/**
 * The legacy contract: `/api/feedback-collect/*`, mirroring
 * `src/server/vals/feedback.val`. camelCase on the wire, because that is what
 * parsegen emits.
 *
 * Two shapes where v1 has one: a session (the replay) and an item (the report),
 * posted in that order so the replay exists by the time anyone opens the report.
 *
 * Known server-side gaps this transport works around - see
 * `docs/server-requirements.md`:
 *
 *  - `doIngestItem` passes `sessionId = None` unconditionally, so the
 *    `sessionKey` sent here never lands in `feedback_items.session_id` and the
 *    admin UI cannot walk from a report to its replay. Until that is fixed the
 *    key is also written into `metadata.sessionKey`, where it is at least
 *    readable by a human.
 *  - The three event columns are `jsonb` but the `.val` fields are `string`, so
 *    each array is JSON-encoded once here and cast server-side.
 */
import type { Draft, SubmitContext, SubmitResult, Transport, TransportDeps } from "./index.js";
import type { LegacyItemCreate, LegacySessionIngest } from "../wire.js";
import { LEGACY_KINDS } from "../wire.js";
import { extractConsoleAndNetwork, playableEvents } from "../extract.js";
import { postJson, postOnUnload } from "./http.js";

/** `feedback_items.type` has a CHECK constraint; a miss is a 500, not a 400. */
function safeKind(kind: string): string {
  return (LEGACY_KINDS as readonly string[]).includes(kind) ? kind : "feedback";
}

function buildSession(ctx: SubmitContext): LegacySessionIngest {
  const events = ctx.config.replay.enabled ? ctx.events : [];
  const { console: consoleEntries, network } = extractConsoleAndNetwork(events);
  const started = ctx.replayStartedAt;

  return {
    sessionKey: ctx.sessionId,
    userIdExt: ctx.user.id ?? "",
    userEmail: ctx.user.email ?? "",
    userName: ctx.user.name ?? "",
    pageUrl: ctx.pageUrl,
    referrer: ctx.referrer,
    viewportWidth: ctx.viewportWidth,
    viewportHeight: ctx.viewportHeight,
    userAgent: ctx.userAgent,
    // Plugin events carry the console and network payloads, which are about to
    // be sent in their own columns. Sending them twice would roughly double the
    // body for no gain.
    events: JSON.stringify(playableEvents(events)),
    consoleLogs: JSON.stringify(consoleEntries),
    networkLogs: JSON.stringify(network),
    durationSeconds: started === null ? null : Math.max(0, Math.round((Date.now() - started) / 1000)),
  };
}

export function createLegacyTransport(deps: TransportDeps): Transport {
  const sessionUrl = `${deps.endpoint}/api/feedback-collect/session`;
  const itemUrl = `${deps.endpoint}/api/feedback-collect/item`;

  return {
    kind: "legacy",

    async submit(draft: Draft, ctx: SubmitContext): Promise<SubmitResult> {
      if (ctx.config.replay.enabled) {
        // The replay is worth having even if it is the report that fails, and a
        // failed replay must not cost the report. Neither one blocks the other.
        try {
          await postJson(sessionUrl, deps.publicKey, buildSession(ctx));
        } catch {
          /* recorded in the report's metadata below as a missing replay */
        }
      }

      const metadata: Record<string, unknown> = {
        ...ctx.metadata,
        sessionKey: ctx.sessionId,
        viewport: { w: ctx.viewportWidth, h: ctx.viewportHeight },
        userAgent: ctx.userAgent,
        replayEvents: ctx.events.length,
        // Custom fields have nowhere structured to go on this contract; parking
        // them here keeps the answers rather than silently dropping them.
        ...(Object.keys(draft.answers).length > 0 ? { customFields: draft.answers } : {}),
        ...(draft.files.length > 0
          ? { attachmentsDropped: draft.files.map((f) => f.name) }
          : {}),
      };

      const item: LegacyItemCreate = {
        sessionKey: ctx.sessionId,
        itemType: safeKind(draft.kind),
        title: draft.title,
        description: draft.message,
        pageUrl: ctx.pageUrl,
        userEmail: draft.email ?? ctx.user.email ?? "",
        userName: ctx.user.name ?? "",
        screenshotData: draft.screenshot ?? "",
        metadata: JSON.stringify(metadata),
      };

      // The item route returns the created row, not `{ id }`. Read the id when
      // it is there and shrug when it is not - the caller only reports success.
      const created = await postJson<{ id?: string }>(itemUrl, deps.publicKey, item);
      return { id: typeof created?.id === "string" ? created.id : null };
    },

    flushSession(ctx: SubmitContext, onUnload: boolean): void {
      if (!ctx.config.replay.enabled) return;
      const body = buildSession(ctx);
      if (onUnload) {
        postOnUnload(sessionUrl, deps.publicKey, body);
        return;
      }
      void postJson(sessionUrl, deps.publicKey, body).catch(() => {
        /* a dropped periodic flush is replaced by the next one */
      });
    },
  };
}
