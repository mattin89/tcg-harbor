import { describe, expect, it } from 'vitest';
import {
  STATIC_SPA_ENTRYPOINT_ROUTES_V1,
  staticSpaEntrypointPathV1,
} from '../../scripts/create-static-spa-entrypoints-v1.mjs';

describe('static SPA entrypoints v1', () => {
  it('ships a direct entrypoint for the guest card-catalog route', () => {
    expect(STATIC_SPA_ENTRYPOINT_ROUTES_V1).toEqual(['/cards']);
    expect(STATIC_SPA_ENTRYPOINT_ROUTES_V1.map(staticSpaEntrypointPathV1))
      .toEqual(['cards/index.html']);
  });

  it('rejects paths that could escape or ambiguously target the build directory', () => {
    for (const route of ['', '/', 'cards', '/../cards', '/cards?guest=true', '/Cards']) {
      expect(() => staticSpaEntrypointPathV1(route)).toThrow(/unsafe/i);
    }
  });
});
