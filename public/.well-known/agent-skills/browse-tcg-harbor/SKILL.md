---
name: browse-tcg-harbor
description: Browse TCG Harbor's public One Piece Card Game catalog and approved physical-store directory. Use when an agent needs to find exact card printings or alternative arts, inspect public Cardmarket and TCGplayer market references, or locate an approved store without accessing a player's private collection, account, or community data.
---

# Browse TCG Harbor

Use only TCG Harbor's public, read-only discovery surfaces. Never claim that a market reference is a live offer, guaranteed sale price, or statement of trade fairness.

## Find cards

1. Open `https://tcg-harbor.onrender.com/cards`.
2. Prefer the page's `search_one_piece_cards` WebMCP tool when available.
3. Pass the printed name, card number, set code, or art label as `query`.
4. Use `setCode` or `language` when the user asks for an exact printing.
5. Treat `cardmarketTrendEur`, `cardmarketLowestOfferEur`, and `tcgplayerMarketUsd` as distinct fields. Report unavailable values as unavailable.
6. Follow `nextOffset` while `hasMore` is true when the user needs every matching printing.
7. Use the returned image URL only for the exact result it accompanies.

If WebMCP is unavailable, use the public search and set filters on `https://tcg-harbor.onrender.com/cards`.

## Find stores

1. Open `https://tcg-harbor.onrender.com/stores`.
2. Prefer the page's `list_approved_stores` WebMCP tool when available.
3. Search by store name, city, postcode, or address.
4. Return only records supplied by the approved public directory.
5. Follow `nextOffset` while `hasMore` is true when the user needs every matching store.
6. Use the returned public store route for details. Store-community messages and membership data are private.

If WebMCP is unavailable, use the public list and map on `https://tcg-harbor.onrender.com/stores`.

## Respect account boundaries

- Do not attempt to read or modify collections, acquisition values, messages, memberships, notification settings, or store-admin data.
- Saving a card requires the user's signed-in account.
- Joining a store requires the user to sign in and complete the physical-store QR flow.
- Never ask for, copy, or expose login credentials or QR join tokens.
