import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pickerSource = readFileSync(
  new URL('../components/CommunityCardSearchPickerV9.tsx', import.meta.url),
  'utf8',
);
const modalSource = readFileSync(
  new URL('../components/CommunityTradeCreateModalV9.tsx', import.meta.url),
  'utf8',
);
const boardSource = readFileSync(
  new URL('../components/CommunityTradingBoardV6.tsx', import.meta.url),
  'utf8',
);
const repositorySource = readFileSync(
  new URL('../services/supabase/communityTradingRepositoryV6.ts', import.meta.url),
  'utf8',
);

describe('community trade picker v9 integration boundary', () => {
  it('renders an accessible searchable exact-printing picker with market references', () => {
    expect(pickerSource).toContain('role="combobox"');
    expect(pickerSource).toContain('role="listbox"');
    expect(pickerSource).toContain('resolveCardmarketArtworkReferenceV10');
    expect(pickerSource).toContain('Cardmarket');
    expect(pickerSource).toContain('US market');
  });

  it('uses owned cards for offers and the complete catalog for wanted cards', () => {
    expect(modalSource).toContain('Search your available collection cards');
    expect(modalSource).toContain('Search any card in the complete catalog');
    expect(modalSource).toContain("owned={postKind === 'offering_card'}");
    expect(modalSource).toContain('selectAvailableOwnedCommunityCardsV9');
    expect(modalSource).toContain('runtime.create({');
  });

  it('keeps the server-bound collection identity and activates the v9 modal', () => {
    expect(repositorySource).toContain('p_primary_collection_item_id: primaryCollectionItemId');
    expect(repositorySource).toContain('requireAuthenticatedOwnerV3');
    expect(boardSource).toContain('<CommunityTradeCreateModalV9');
  });
});
