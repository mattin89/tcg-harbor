import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(fileURLToPath(new URL(
  '../../supabase/migrations/20260724141817_community_trade_feed_realtime_v7.sql',
  import.meta.url,
)), 'utf8');
const runtimeHook = readFileSync(fileURLToPath(new URL(
  '../services/supabase/useProductionCommunityTradingV6.ts',
  import.meta.url,
)), 'utf8');
const board = readFileSync(fileURLToPath(new URL(
  '../components/CommunityTradingBoardV6.tsx',
  import.meta.url,
)), 'utf8');

describe('community trade live feed v7', () => {
  it('publishes trade_posts to Supabase Realtime idempotently', () => {
    expect(migration).toContain("publication.pubname = 'supabase_realtime'");
    expect(migration).toContain("publication_table.tablename = 'trade_posts'");
    expect(migration).toContain('alter publication supabase_realtime add table public.trade_posts');
  });

  it('refreshes other open accounts through Realtime with focus and polling fallbacks', () => {
    expect(runtimeHook).toContain('repository.subscribe(');
    expect(runtimeHook).toContain('globalThis.setInterval(refreshWhenVisible, 15_000)');
    expect(runtimeHook).toContain("window.addEventListener('focus', refreshSharedFeed)");
    expect(runtimeHook).toContain("document.addEventListener('visibilitychange', refreshWhenVisible)");
    expect(runtimeHook).toContain('unsubscribe?.()');
  });

  it('shows all persisted statuses by default instead of hiding completed posts', () => {
    expect(board).toContain("useState<CommunityTradeStatusV6 | 'all'>('all')");
    expect(board).toContain('<option value="all">All posts</option>');
    expect(board).toContain('Live trade feed');
  });
});
