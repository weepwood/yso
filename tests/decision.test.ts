import { describe, expect, it } from 'vitest';
import { decideSyncAction } from '../src/core/decision.js';

describe('decideSyncAction', () => {
  it('does nothing when both sides equal base', () => {
    expect(decideSyncAction('a', 'a', 'a')).toBe('noop');
  });

  it('pushes local-only changes', () => {
    expect(decideSyncAction('a', 'b', 'a')).toBe('push');
  });

  it('pulls remote-only changes', () => {
    expect(decideSyncAction('a', 'a', 'b')).toBe('pull');
  });

  it('accepts identical concurrent changes', () => {
    expect(decideSyncAction('a', 'b', 'b')).toBe('synced');
  });

  it('preserves divergent concurrent changes as a conflict', () => {
    expect(decideSyncAction('a', 'b', 'c')).toBe('conflict');
  });
});
