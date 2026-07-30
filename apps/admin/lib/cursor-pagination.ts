export interface CursorPage<Item> {
  readonly items: readonly Item[];
  readonly nextPageToken: string | null;
}

export interface CursorPaginationLimits<Item> {
  readonly identity: (item: Item) => string;
  readonly maxItems: number;
  readonly maxPages: number;
  readonly timeoutMs: number;
}

type CursorLoader<Item> = (
  cursor: string | undefined,
  signal: AbortSignal,
) => Promise<CursorPage<Item>>;

const paginationError = (code: string): Error => new Error(code);

function requirePositiveInteger(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw paginationError("admin_cursor_pagination_configuration");
  }
}

/**
 * Materialize a small cursor collection for selector-style controls.
 *
 * This intentionally fails instead of returning a partial authority catalog when
 * the upstream cursor chain is cyclic, unexpectedly large, or too slow.
 */
export async function collectCursorPages<Item>(
  loader: CursorLoader<Item>,
  limits: CursorPaginationLimits<Item>,
): Promise<Item[]> {
  requirePositiveInteger(limits.maxItems);
  requirePositiveInteger(limits.maxPages);
  requirePositiveInteger(limits.timeoutMs);

  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(paginationError("admin_cursor_pagination_timeout"));
    }, limits.timeoutMs);
  });
  const items: Item[] = [];
  const identities = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  let pageCount = 0;

  try {
    while (true) {
      const page = await Promise.race([loader(cursor, controller.signal), deadline]);
      pageCount += 1;

      for (const item of page.items) {
        const identity = limits.identity(item);
        if (identities.has(identity)) {
          throw paginationError("admin_cursor_pagination_duplicate_item");
        }
        identities.add(identity);
        items.push(item);
        if (items.length > limits.maxItems) {
          throw paginationError("admin_cursor_pagination_item_limit");
        }
      }

      if (page.nextPageToken === null) return items;
      if (pageCount >= limits.maxPages) {
        throw paginationError("admin_cursor_pagination_page_limit");
      }
      if (cursors.has(page.nextPageToken)) {
        throw paginationError("admin_cursor_pagination_loop");
      }
      cursors.add(page.nextPageToken);
      cursor = page.nextPageToken;
    }
  } catch (error) {
    if (controller.signal.aborted) {
      throw paginationError("admin_cursor_pagination_timeout");
    }
    throw error;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
