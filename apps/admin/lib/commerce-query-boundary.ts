export interface CommerceQueryState {
  readonly canRead: boolean;
  readonly siteId: string;
  readonly error: unknown;
  readonly isFetching: boolean;
  readonly isFetchingNextPage?: boolean;
  readonly isPlaceholderData: boolean;
}

/** Never present cached data while its current Site/authority is unresolved or denied. */
export function commerceQueryCanRender(state: CommerceQueryState): boolean {
  return state.canRead && state.siteId.length > 0 && state.error == null && !state.isPlaceholderData &&
    (!state.isFetching || state.isFetchingNextPage === true);
}
