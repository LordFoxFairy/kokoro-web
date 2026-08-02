export {
  AGUI_CURSOR_PROFILE_REVISION,
  AGUI_PRESENTATION_AUTHORITY_LIMITS,
  AGUI_PRESENTATION_LIMITS,
  AGUI_PRESENTATION_PROFILE_REVISION,
  AGUI_PRESENTATION_REPLAY_MEMORY_BOUNDS,
  SESSION_AGUI_CONTRACT_REVISION,
  AguiPresentationProtocolError,
  aguiBindingAuthorityContractMetadata,
  aguiCursorBindingSchema,
  aguiGrantBindingSchema,
  aguiPresentationBindingAuthorityDeltaSchema,
  aguiPresentationEventSchema,
  aguiPresentationMessageBindingSchema,
  aguiPresentationMessageBindingRefSchema,
  aguiPresentationMessageIdSchema,
  aguiPresentationRunBindingSchema,
  aguiPresentationRunBindingRefSchema,
  aguiPresentationRunIdSchema,
  aguiPresentationThreadIdSchema,
  aguiPublicSourceEventIdSchema,
  createAguiPresentationDecoder,
} from "./agui-presentation-state-machine.internal.js";

export type {
  AguiActivityEvent,
  AguiCursorBinding,
  AguiCustomEvent,
  AguiDecodedFrame,
  AguiDispatchAcknowledgement,
  AguiDrainingFrame,
  AguiDurableFrame,
  AguiGrantBinding,
  AguiPreparedFrame,
  AguiPresentationBindingAuthorityDelta,
  AguiPresentationDecoder,
  AguiPresentationEvent,
  AguiPresentationMessageBinding,
  AguiPresentationMessageBindingRef,
  AguiPresentationMessageId,
  AguiPresentationRunBinding,
  AguiPresentationRunBindingRef,
  AguiPresentationRunId,
  AguiPresentationSnapshotAuthority,
  AguiPresentationThreadId,
  AguiPublicSourceEventId,
  AguiSseFrame,
} from "./agui-presentation-state-machine.internal.js";

import type {
  AguiGrantBinding,
  AguiPresentationDecoder,
  AguiPresentationSnapshotAuthority,
  AguiSseFrame,
} from "./agui-presentation-state-machine.internal.js";
import type { SessionClient, SessionConnectionState } from "./client.js";
import type { SessionSnapshot } from "./contracts.js";

/**
 * Transport-independent production port for the Session-owned browser AG-UI
 * snapshot/replay/SSE lane. The concrete HTTP paths remain Root-generated.
 */
export type AguiPresentationHydration = Readonly<{
  snapshot: SessionSnapshot;
  grant: AguiGrantBinding;
  snapshotAuthority: AguiPresentationSnapshotAuthority;
}>;

export type AguiFrameDisposition =
  | Readonly<{ kind: "durable" | "replay" }>
  | Readonly<{ kind: "draining"; retryAfterMs?: number }>;

export type OpenAguiPresentationInput = Readonly<{
  sessionId: string;
  /** Read immediately before every initial attach or reconnect. */
  resume: () => ReturnType<AguiPresentationDecoder["getResumeRequest"]>;
  onFrame(frame: AguiSseFrame): AguiFrameDisposition;
  onConnection(state: SessionConnectionState): void;
}>;

export type AguiPresentationSource = Pick<SessionClient, "hydrate" | "openPresentation">;
