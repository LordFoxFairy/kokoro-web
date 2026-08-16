import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import type {} from "@testing-library/jest-dom/vitest";
import { expect } from "vitest";

expect.extend(jestDomMatchers);

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }),
});

class TestResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver = TestResizeObserver;

const getComputedStyle = window.getComputedStyle.bind(window);
window.getComputedStyle = (element: Element): CSSStyleDeclaration => getComputedStyle(element);
