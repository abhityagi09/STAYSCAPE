import {
  Accessibility,
  Ban,
  Bell,
  BedDouble,
  Bot,
  Briefcase,
  Building2,
  CalendarCheck,
  ClipboardList,
  CreditCard,
  FileText,
  Gift,
  Heart,
  House,
  Landmark,
  LayoutDashboard,
  LifeBuoy,
  LineChart,
  Map,
  Network,
  Percent,
  ReceiptIndianRupee,
  ScrollText,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  Tags,
  TicketPercent,
  TrendingDown,
  UserRound,
  Users,
  Wallet,
} from 'lucide-react';
import { DashboardShell, type NavSection } from './DashboardShell';

const customerSections: NavSection[] = [
  {
    items: [
      {
        to: '/account',
        label: 'Overview',
        labelKey: 'nav.overview',
        icon: LayoutDashboard,
        end: true,
      },
      {
        to: '/account/notifications',
        label: 'Notifications',
        labelKey: 'nav.notifications',
        icon: Bell,
      },
    ],
  },
  {
    title: 'Travel',
    titleKey: 'nav.travel',
    items: [
      { to: '/account/bookings', label: 'Bookings', labelKey: 'nav.bookings', icon: CalendarCheck },
      { to: '/trips', label: 'TripSpace', labelKey: 'nav.trips', icon: Map },
      { to: '/account/assistant', label: 'Travel assistant', labelKey: 'nav.assistant', icon: Bot },
      {
        to: '/account/price-alerts',
        label: 'Price alerts',
        labelKey: 'nav.priceAlerts',
        icon: TrendingDown,
      },
      { to: '/account/rewards', label: 'Rewards', labelKey: 'nav.rewards', icon: Gift },
      { to: '/account/payments', label: 'Payments', labelKey: 'nav.payments', icon: CreditCard },
      { to: '/account/refunds', label: 'Refunds', labelKey: 'nav.refunds', icon: Wallet },
      { to: '/account/wishlists', label: 'Wishlists', labelKey: 'nav.wishlists', icon: Heart },
      { to: '/account/reviews', label: 'Reviews', labelKey: 'nav.reviews', icon: Star },
      {
        to: '/account/corporate',
        label: 'Corporate travel',
        labelKey: 'nav.corporate',
        icon: Briefcase,
      },
      { to: '/account/support', label: 'Help & support', labelKey: 'nav.support', icon: LifeBuoy },
    ],
  },
  {
    title: 'Account',
    titleKey: 'nav.account',
    items: [
      { to: '/account/profile', label: 'Profile', labelKey: 'nav.profile', icon: UserRound },
      {
        to: '/account/settings',
        label: 'Settings',
        labelKey: 'nav.settings',
        icon: SlidersHorizontal,
      },
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
      {
        to: '/partner/dashboard',
        label: 'Performance',
        icon: LineChart,
        permissions: ['partner:access'],
      },
      { to: '/partner/onboarding', label: 'Onboarding', icon: ClipboardList },
    ],
  },
  {
    title: 'Property management',
    items: [
      {
        to: '/partner/properties',
        label: 'Properties',
        icon: Building2,
        permissions: ['partner:access'],
      },
      {
        to: '/partner/inventory',
        label: 'Inventory calendar',
        icon: BedDouble,
        end: true,
        permissions: ['partner:access'],
      },
      {
        to: '/partner/inventory/blocks',
        label: 'Blocks & closures',
        icon: Ban,
        permissions: ['partner:access'],
      },
      {
        to: '/partner/bookings',
        label: 'Reservations',
        icon: CalendarCheck,
        permissions: ['partner:access'],
      },
      {
        to: '/partner/reviews',
        label: 'Guest reviews',
        icon: Star,
        permissions: ['partner:access'],
      },
      {
        to: '/partner/accessibility',
        label: 'Accessibility',
        icon: Accessibility,
        permissions: ['partner:access'],
      },
      {
        to: '/partner/channels',
        label: 'Channel manager',
        icon: Network,
        permissions: ['partner:access'],
      },
      {
        to: '/partner/support',
        label: 'Guest support',
        icon: LifeBuoy,
        permissions: ['partner:access'],
      },
    ],
  },
  {
    title: 'Business',
    items: [
      {
        to: '/partner/settlements',
        label: 'Settlements',
        icon: Wallet,
        permissions: ['partner:access'],
      },
      { to: '/partner/staff', label: 'Team', icon: Users, permissions: ['staff:manage'] },
      { to: '/account/profile', label: 'Profile & security', icon: Settings },
    ],
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
      {
        to: '/admin/dashboard',
        label: 'Platform dashboard',
        icon: LineChart,
        permissions: ['reports:view'],
      },
      {
        to: '/admin/reports',
        label: 'Reports & analytics',
        icon: LineChart,
        permissions: ['analytics:platform'],
      },
      { to: '/admin/users', label: 'Users & roles', icon: Users, permissions: ['users:read'] },
      { to: '/admin/customers', label: 'Customers', icon: UserRound, permissions: ['users:read'] },
      {
        to: '/admin/audit-logs',
        label: 'Audit log',
        icon: ScrollText,
        permissions: ['audit:read'],
      },
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
      },
      {
        to: '/admin/properties',
        label: 'Property moderation',
        icon: House,
        permissions: ['hotels:moderate'],
      },
      { to: '/admin/catalog', label: 'Catalogue', icon: Tags, permissions: ['catalog:manage'] },
      {
        to: '/admin/bookings',
        label: 'Bookings & escalations',
        icon: CalendarCheck,
        permissions: ['bookings:read-all'],
      },
      {
        to: '/admin/reviews',
        label: 'Review moderation',
        icon: Star,
        permissions: ['reviews:moderate'],
      },
      {
        to: '/admin/support',
        label: 'Support queue',
        icon: LifeBuoy,
        permissions: ['support:manage'],
      },
      { to: '/admin/content', label: 'Content', icon: FileText, permissions: ['content:manage'] },
      {
        to: '/admin/organizations',
        label: 'Corporate accounts',
        icon: Briefcase,
        permissions: ['users:manage'],
      },
    ],
  },
  {
    title: 'Finance',
    items: [
      {
        to: '/admin/operations',
        label: 'Payments & operations',
        icon: CreditCard,
        permissions: ['payments:read'],
      },
      {
        to: '/admin/payments',
        label: 'Payments',
        icon: ReceiptIndianRupee,
        permissions: ['payments:read'],
      },
      { to: '/admin/refunds', label: 'Refunds', icon: Wallet, permissions: ['payments:read'] },
      {
        to: '/admin/commissions',
        label: 'Commissions',
        icon: Percent,
        permissions: ['payments:read'],
      },
      {
        to: '/admin/settlements',
        label: 'Settlements',
        icon: Landmark,
        permissions: ['payments:read'],
      },
      {
        to: '/admin/coupons',
        label: 'Coupons',
        icon: TicketPercent,
        permissions: ['coupons:manage'],
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
