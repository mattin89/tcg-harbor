import { Avatar } from './ui';

interface AccountMenuButtonProps {
  initials: string;
  active: boolean;
  onOpen: () => void;
}

/** Opens the account settings shared by authenticated player and store profiles. */
export function AccountMenuButton({ initials, active, onOpen }: AccountMenuButtonProps) {
  return (
    <button
      type="button"
      className={`topbar-account-button${active ? ' is-active' : ''}`}
      onClick={onOpen}
      aria-label="Open account menu"
      aria-current={active ? 'page' : undefined}
      title="Account menu"
    >
      <Avatar initials={initials} size="sm" />
    </button>
  );
}
