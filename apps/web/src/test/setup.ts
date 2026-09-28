import '@testing-library/jest-dom/vitest';

// React Flow measures nodes with APIs jsdom does not implement.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

if (!globalThis.DOMMatrixReadOnly) {
  globalThis.DOMMatrixReadOnly = class {
    m22 = 1;
    constructor() {}
  } as unknown as typeof DOMMatrixReadOnly;
}

Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 40 });
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 180 });

globalThis.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof matchMedia;
