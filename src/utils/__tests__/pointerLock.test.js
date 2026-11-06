import { describe, it, expect, vi, afterEach } from 'vitest';
import { lockPointer } from '../pointerLock';

describe('lockPointer', () => {
  const unhandled = vi.fn();
  afterEach(() => {
    process.off('unhandledRejection', unhandled);
    unhandled.mockClear();
  });

  it('catches a refused lock: no unhandled rejection, resolves false', async () => {
    process.on('unhandledRejection', unhandled);
    const el = {
      requestPointerLock: vi.fn(() => Promise.reject(new DOMException('not valid for pointer lock', 'WrongDocumentError'))),
    };
    await expect(lockPointer(el)).resolves.toBe(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(el.requestPointerLock).toHaveBeenCalledTimes(1);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('resolves true when the browser locks', async () => {
    await expect(lockPointer({ requestPointerLock: () => Promise.resolve() })).resolves.toBe(true);
  });

  it('works with older browsers that return nothing or throw', async () => {
    await expect(lockPointer({ requestPointerLock: () => undefined })).resolves.toBe(true);
    await expect(lockPointer({ requestPointerLock: () => { throw new Error('no'); } })).resolves.toBe(false);
  });

  it('does nothing without an element or the API', async () => {
    await expect(lockPointer(null)).resolves.toBe(false);
    await expect(lockPointer({})).resolves.toBe(false);
  });
});
