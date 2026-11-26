import { useNavigate } from 'react-router';
import { Building2, LayoutDashboard, LogOut, Shield, UserRound } from 'lucide-react';
import { Avatar, Dropdown, useToast, type DropdownItem } from '@/components/ui';
import { useAuth, useSignOut } from '@/features/auth/use-auth';
import { tr, trf } from '@/lib/tr';

export function UserMenu() {
  const { user, can } = useAuth();
  const navigate = useNavigate();
  const signOut = useSignOut();
  const { toast } = useToast();
  if (!user) return null;
  const name = `${user.firstName} ${user.lastName}`;

  const items: DropdownItem[] = [
    {
      id: 'account',
      label: tr('My account'),
      icon: <LayoutDashboard />,
      onSelect: () => navigate('/account'),
    },
    {
      id: 'profile',
      label: tr('Profile & security'),
      icon: <UserRound />,
      onSelect: () => navigate('/account/profile'),
    },
  ];
  if (can('partner:access'))
    items.push({
      id: 'partner',
      label: tr('Partner workspace'),
      icon: <Building2 />,
      onSelect: () => navigate('/partner'),
    });
  if (can('admin:access'))
    items.push({
      id: 'admin',
      label: tr('Administration'),
      icon: <Shield />,
      onSelect: () => navigate('/admin'),
    });
  items.push({
    id: 'logout',
    label: tr('Sign out'),
    icon: <LogOut />,
    danger: true,
    onSelect: () => {
      void signOut().then(() => {
        toast({
          title: tr('Signed out'),
          description: tr('See you on your next journey.'),
          variant: 'success',
        });
        navigate('/');
      });
    },
  });

  return (
    <Dropdown
      header={
        <div>
          <p className="text-sm font-semibold text-fg">{name}</p>
          <p className="truncate text-xs text-fg-subtle">{user.email}</p>
        </div>
      }
      trigger={(props) => (
        <button
          {...props}
          type="button"
          className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {/* Name first, then the visible initials, so the label contains what is shown (WCAG 2.5.3). */}
          <span className="sr-only">{trf('Account menu for {0}', [name])}</span>
          <Avatar name={name} src={user.avatarUrl} size="md" decorative />
        </button>
      )}
      items={items}
    />
  );
}
