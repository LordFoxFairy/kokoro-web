export interface CursorWindow<Item> {
  readonly rows: readonly Item[];
  readonly nextPageToken: string | null;
  readonly pageCount: number;
  readonly membershipWatermark: string | null;
  readonly observedAt: string | null;
  readonly seenCursors: ReadonlySet<string>;
  readonly seenIdentities: ReadonlySet<string>;
}

export interface CursorWindowPage<Item> {
  readonly items: readonly Item[];
  readonly nextPageToken: string | null;
  readonly membershipWatermark?: string;
  readonly observedAt?: string;
}

export interface CursorWindowLimits<Item> {
  readonly identity: (item: Item) => string;
  readonly maxItems: number;
  readonly maxPages: number;
}

export class CursorWindowError extends Error {
  constructor(code: string) {
    super(code);
    this.name = "CursorWindowError";
  }
}

const fail = (code: string): never => { throw new CursorWindowError(code); };

function validateLimit(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) fail("admin_cursor_window_configuration");
}

export function resetCursorWindow<Item>(): CursorWindow<Item> {
  return { rows: [], nextPageToken: null, pageCount: 0, membershipWatermark: null, observedAt: null,
    seenCursors: new Set(), seenIdentities: new Set() };
}

export function clearNextPageToken<Item>(window: CursorWindow<Item>): CursorWindow<Item> {
  return { ...window, nextPageToken: null };
}

/** Validate an entire page before returning a new cumulative window. */
export function appendCursorPage<Item>(
  window: CursorWindow<Item>,
  page: CursorWindowPage<Item>,
  limits: CursorWindowLimits<Item>,
): CursorWindow<Item> {
  validateLimit(limits.maxItems);
  validateLimit(limits.maxPages);
  const hasWatermark = page.membershipWatermark !== undefined;
  if (hasWatermark !== (page.observedAt !== undefined)) fail("admin_cursor_window_observation_incomplete");
  if (window.membershipWatermark !== null && !hasWatermark) fail("admin_cursor_window_watermark_drift");
  if (hasWatermark) {
    const watermark = Date.parse(page.membershipWatermark!);
    const observed = Date.parse(page.observedAt!);
    if (!Number.isFinite(watermark) || !Number.isFinite(observed)) fail("admin_cursor_window_observation_invalid");
    if (observed < watermark) fail("admin_cursor_window_observation_before_watermark");
    if (window.membershipWatermark !== null && page.membershipWatermark !== window.membershipWatermark) {
      fail("admin_cursor_window_watermark_drift");
    }
  }
  const pageCount = window.pageCount + 1;
  if (pageCount > limits.maxPages) fail("admin_cursor_window_page_limit");
  if (window.rows.length + page.items.length > limits.maxItems) fail("admin_cursor_window_item_limit");

  const pageIdentities = new Set<string>();
  for (const item of page.items) {
    const identity = limits.identity(item);
    if (window.seenIdentities.has(identity) || pageIdentities.has(identity)) {
      fail("admin_cursor_window_duplicate_item");
    }
    pageIdentities.add(identity);
  }
  if (page.nextPageToken !== null && window.seenCursors.has(page.nextPageToken)) {
    fail("admin_cursor_window_loop");
  }

  const seenCursors = new Set(window.seenCursors);
  if (page.nextPageToken !== null) seenCursors.add(page.nextPageToken);
  return {
    rows: [...window.rows, ...page.items],
    nextPageToken: page.nextPageToken,
    pageCount,
    membershipWatermark: page.membershipWatermark ?? window.membershipWatermark,
    observedAt: page.observedAt ?? window.observedAt,
    seenCursors,
    seenIdentities: new Set([...window.seenIdentities, ...pageIdentities]),
  };
}

/** Monotonic token gate used to discard late async responses. */
export class LatestRequest {
  private generation = 0;

  begin(): number {
    if (this.generation === Number.MAX_SAFE_INTEGER) fail("admin_request_generation_exhausted");
    this.generation += 1;
    return this.generation;
  }

  invalidate(): void {
    this.begin();
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation;
  }
}
