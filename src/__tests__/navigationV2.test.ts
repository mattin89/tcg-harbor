import { describe, expect, it } from 'vitest';
import { resolveActiveNavPathV2 } from '../domain/navigationV2';

const routes = ['/dashboard', '/collection', '/collection/add', '/market-comparison'];

describe('active application navigation', () => {
  it('prefers the more specific Add items route over its Collection parent', () => {
    expect(resolveActiveNavPathV2('/collection/add', routes, '/dashboard')).toBe('/collection/add');
  });

  it('keeps nested collection details on Collection and unknown paths on the fallback', () => {
    expect(resolveActiveNavPathV2('/collection/card/123', routes, '/dashboard')).toBe('/collection');
    expect(resolveActiveNavPathV2('/unknown', routes, '/dashboard')).toBe('/dashboard');
  });
});
