import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('community trade hyperlinks and community context', () => {
  it('formats trade contact draft with community name and markdown hyperlink to post', () => {
    const boardSource = readFileSync(
      new URL('../components/CommunityTradingBoardV6.tsx', import.meta.url),
      'utf8',
    );

    // Draft contains hyperlink to postUrl and specifies communityName
    expect(boardSource).toContain('const postUrl = `/communities/${communityId}?post=${post.id}#trade-post-${post.id}`');
    expect(boardSource).toContain('postRef');
    expect(boardSource).toContain('communityName');
    expect(boardSource).toContain('regarding your ${direction} post for ${cardTitle} in ${communityName}');
    expect(boardSource).toContain('&postUrl=${encodeURIComponent(postUrl)}');
  });

  it('renders chat message markdown links and community URLs as clickable hyperlinks', () => {
    const appSource = readFileSync(
      new URL('../App.tsx', import.meta.url),
      'utf8',
    );

    expect(appSource).toContain('renderChatMessageContent');
    expect(appSource).toContain('chat-message-link');
    expect(appSource).toContain('initialPostUrl');
    expect(appSource).toContain('tradePostUrl');
    expect(appSource).toContain('trade-context-view-btn');
    expect(appSource).toContain('targetPostId');
  });

  it('adds highlighted post styling and animation to targeted trade posts', () => {
    const cssSource = readFileSync(
      new URL('../styles-community-trading-v6.css', import.meta.url),
      'utf8',
    );

    expect(cssSource).toContain('.chat-message-link');
    expect(cssSource).toContain('.trade-context-view-btn');
    expect(cssSource).toContain('.community-trade-card-highlighted');
    expect(cssSource).toContain('@keyframes pulse-trade-post');
  });

  it('parses markdown links and relative community paths correctly', () => {
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)|(https?:\/\/[^\s<]+)|(\/communities\/[a-zA-Z0-9_-]+(?:\?[^\s<)]*)?(?:#[^\s<)]*)?)/g;

    const sample = 'Hi @mario, [regarding your offer post for Portgas.D.Ace (OP02-013) in Test for now](/communities/comm-1?post=post-1#trade-post-post-1): Can offer €35.';
    const matches: { label?: string; url: string }[] = [];
    let match: RegExpExecArray | null;

    while ((match = linkRegex.exec(sample)) !== null) {
      if (match[1] !== undefined && match[2] !== undefined) {
        matches.push({ label: match[1], url: match[2] });
      } else {
        matches.push({ url: match[3] ?? match[4] });
      }
    }

    expect(matches).toHaveLength(1);
    expect(matches[0].label).toBe('regarding your offer post for Portgas.D.Ace (OP02-013) in Test for now');
    expect(matches[0].url).toBe('/communities/comm-1?post=post-1#trade-post-post-1');
  });
});
