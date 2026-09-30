import '@testing-library/jest-dom/vitest'
import { beforeEach, afterEach, vi } from 'vitest'
import { mockIPC, clearMocks } from '@tauri-apps/api/mocks'

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}

// Node 25+ ships its own `localStorage` global, which is undefined unless node
// runs with --localstorage-file, and it shadows jsdom's. Put a working
// in-memory Storage back so the suite behaves the same on every Node version.
if (typeof globalThis.localStorage?.removeItem !== 'function') {
  class MemoryStorage implements Storage {
    #items = new Map<string, string>()
    get length() {
      return this.#items.size
    }
    clear() {
      this.#items.clear()
    }
    getItem(key: string) {
      return this.#items.get(key) ?? null
    }
    key(index: number) {
      return [...this.#items.keys()][index] ?? null
    }
    removeItem(key: string) {
      this.#items.delete(key)
    }
    setItem(key: string, value: string) {
      this.#items.set(key, String(value))
    }
  }
  Object.defineProperty(globalThis, 'localStorage', {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  })
}

if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: () => false,
    }) as MediaQueryList
}

beforeEach(() => mockIPC(() => undefined))
afterEach(() => clearMocks())
