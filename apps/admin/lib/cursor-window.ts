export interface CursorWindow<Item> {
  readonly rows: readonly Item[];
  readonly nextPageToken: string | null;
  readonly pageCount: number;
  readonly seenCursors: ReadonlySet<string>;
  readonly seenIdentities: ReadonlySet<string>;
}

export interface CursorWindowPage<Item> {
  readonly items: readonly Item[];
  readonly nextPageToken: string | null;
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
  return { rows: [], nextPageToken: null, pageCount: 0, seenCursors: new Set(), seenIdentities: new Set() };
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
