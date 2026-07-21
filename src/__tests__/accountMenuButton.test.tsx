import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { AccountMenuButton } from '../components/AccountMenuButton';

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

describe('topbar account menu button', () => {
  it.each(['player', 'store'])('opens the shared account menu for an authenticated %s', () => {
    const onOpen = vi.fn();
    const button = AccountMenuButton({ initials: 'MH', active: false, onOpen });

    expect(button.type).toBe('button');
    expect(button.props['aria-label']).toBe('Open account menu');

    button.props.onClick();

    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('marks the account button as the current page in settings', () => {
    const button = AccountMenuButton({ initials: 'MH', active: true, onOpen: vi.fn() });

    expect(button.props['aria-current']).toBe('page');
    expect(button.props.className).toContain('is-active');
  });

  it('wires the top-right account control to the existing settings route', () => {
    expect(appSource).toContain("<AccountMenuButton initials={profileInitials} active={path === '/settings'} onOpen={() => navigate('/settings')} />");
  });
});
