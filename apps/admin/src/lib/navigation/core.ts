export type NavigateOptions = {
  replace?: boolean
  scroll?: boolean
}

export type NavigationPort = {
  back(): void
  push(href: string, options?: { scroll: boolean }): void
  refresh(): void
  replace(href: string, options?: { scroll: boolean }): void
}

export type Navigate = {
  back(): void
  refresh(): void
  to(href: string, options?: NavigateOptions): void
}

export function createNavigate(router: NavigationPort): Navigate {
  return {
    back: () => router.back(),
    refresh: () => router.refresh(),
    to: (href, options = {}) => {
      const { replace = false, scroll } = options
      const navigationOptions = scroll === undefined ? undefined : { scroll }

      if (replace) {
        router.replace(href, navigationOptions)
        return
      }

      router.push(href, navigationOptions)
    },
  }
}
