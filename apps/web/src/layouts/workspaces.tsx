import {
  Bell,
  BedDouble,
  Building2,
  CalendarCheck,
  ClipboardList,
  CreditCard,
  Heart,
  House,
  LayoutDashboard,
  LineChart,
  ScrollText,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  UserRound,
  Users,
  Wallet,
} from 'lucide-react';
import { DashboardShell, type NavSection } from './DashboardShell';

const customerSections: NavSection[] = [
  {
    items: [
      { to: '/account', label: 'Overview', icon: LayoutDashboard, end: true },
      { to: '/account/notifications', label: 'Notifications', icon: Bell },
    ],
  },
  {
    title: 'Account',
    items: [
      { to: '/account/profile', label: 'Profile', icon: UserRound },
      { to: '/account/preferences', label: 'Preferences', icon: SlidersHorizontal },
      { to: '/account/security', label: 'Security & sessions', icon: ShieldCheck },
    ],
  },
  {
    title: 'Travel',
    items: [
      { to: '/account/trips', label: 'Trips', icon: CalendarCheck, upcoming: 'Soon' },
      { to: '/account/saved', label: 'Saved stays', icon: Heart, upcoming: 'Soon' },
      { to: '/account/reviews', label: 'Reviews', icon: Star, upcoming: 'Soon' },
    ],
  },
];

export function CustomerLayout() {
  return (
    <DashboardShell workspace="Traveller account" sections={customerSections} homeLink="/account" />
  );
}

const partnerSections: NavSection[] = [
  {
    items: [
      {
        to: '/partner',
        label: 'Overview',
        icon: LayoutDashboard,
        end: true,
        permissions: ['partner:access'],
      },
      { to: '/partner/onboarding', label: 'Onboarding', icon: ClipboardList },
    ],
  },
  {
    title: 'Property management',
    items: [
      { to: '/partner/properties', label: 'Properties', icon: Building2, upcoming: 'Phase 2' },
      { to: '/partner/rooms', label: 'Rooms & rates', icon: BedDouble, upcoming: 'Phase 2' },
      {
        to: '/partner/reservations',
        label: 'Reservations',
        icon: CalendarCheck,
        upcoming: 'Phase 3',
      },
      { to: '/partner/payouts', label: 'Payouts', icon: Wallet, upcoming: 'Phase 3' },
    ],
  },
  {
    title: 'Account',
    items: [{ to: '/account/profile', label: 'Profile & security', icon: Settings }],
  },
];

export function PartnerLayout() {
  return (
    <DashboardShell
      workspace="Partner workspace"
      sections={partnerSections}
      homeLink="/partner/onboarding"
    />
  );
}

const adminSections: NavSection[] = [
  {
    items: [
      { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true },
      { to: '/admin/users', label: 'Users & roles', icon: Users, permissions: ['users:read'] },
      { to: '/admin/audit', label: 'Audit log', icon: ScrollText, permissions: ['audit:read'] },
    ],
  },
  {
    title: 'Marketplace',
    items: [
      {
        to: '/admin/partners',
        label: 'Partner approvals',
        icon: ShieldCheck,
        permissions: ['partners:approve'],
        upcoming: 'Phase 2',
      },
      {
        to: '/admin/properties',
        label: 'Property moderation',
        icon: House,
        permissions: ['hotels:moderate'],
        upcoming: 'Phase 2',
      },
      {
        to: '/admin/payments',
        label: 'Payments & refunds',
        icon: CreditCard,
        permissions: ['payments:read'],
        upcoming: 'Phase 3',
      },
      {
        to: '/admin/reports',
        label: 'Reports',
        icon: LineChart,
        permissions: ['reports:view'],
        upcoming: 'Phase 3',
      },
    ],
  },
  {
    title: 'You',
    items: [{ to: '/admin/settings', label: 'Account & security', icon: Settings }],
  },
];

export function AdminLayout() {
  return <DashboardShell workspace="Administration" sections={adminSections} homeLink="/admin" />;
}
