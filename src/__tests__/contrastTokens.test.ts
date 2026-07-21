import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const contrastStyles = readFileSync(
  new URL('../styles-contrast-v2.css', import.meta.url),
  'utf8',
);

function token(name: string): string {
  const match = contrastStyles.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i'));
  if (!match) throw new Error(`Missing --${name} contrast token`);
  return match[1];
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const [red, green, blue] = channels.map((channel) => (
    channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(left: string, right: string): number {
  const [lighter, darker] = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('accessible color overrides', () => {
  it('keeps normal text tokens above WCAG AA on the paper background', () => {
    for (const background of ['#fffdf9', '#f4f2ed']) {
      for (const name of ['muted', 'subtle', 'coral', 'gold', 'blue']) {
        expect(contrast(token(name), background), `${name} on ${background}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keeps both primary-button gradient stops above WCAG AA against white', () => {
    expect(contrast('#b65332', '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#914027', '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps semantic and neutral status text above WCAG AA on light surfaces', () => {
    expect(contrast(token('green'), '#e6f3ed')).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('red'), '#f9e9e7')).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#5f6970', '#f0f0ec')).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the market hero eyebrow readable on both gradient stops', () => {
    expect(contrast('#f1a273', '#0a1928')).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#f1a273', '#102d42')).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps navigation and account chrome above WCAG AA on their dark shells', () => {
    for (const foreground of ['#a8b8c2', '#9dafba', '#8fa2ae']) {
      expect(contrast(foreground, '#071421'), foreground).toBeGreaterThanOrEqual(4.5);
    }
    for (const background of ['#0a181c', '#0d191c', '#132429', '#132529', '#192a2e', '#1a2b2f', '#1b2c30']) {
      expect(contrast('#9eb0b4', background), `production supporting copy on ${background}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast('#806750', '#fffaf1')).toBeGreaterThanOrEqual(4.5);
  });

  it('applies the readability floor to every player app shell', () => {
    expect(contrastStyles).toContain('.app-shell small');
    expect(contrastStyles).toContain('.app-shell :is(.asset-table, .comparison-table) td');
    expect(contrastStyles).not.toContain('.production-player-outlet small');
  });

  it('covers every low-contrast production metadata and placeholder selector', () => {
    for (const selector of [
      '.production-field > span small',
      '.production-field input::placeholder',
      '.production-field textarea::placeholder',
      '.production-approval-list dt',
      '.production-qr-manager header p',
      '.production-moderation-manager header p',
      '.production-qr-summary small',
      '.production-moderation-toolbar small',
      '.production-moderation-list article small',
      '.production-moderation-empty',
    ]) {
      expect(contrastStyles, selector).toContain(selector);
    }
    expect(contrastStyles).toMatch(/\.production-field input::placeholder,[\s\S]*?opacity:\s*1;/);
    expect(contrastStyles).toContain('.production-qr-canvas > span');
    expect(contrastStyles).toContain('color: #806750;');
  });
});
