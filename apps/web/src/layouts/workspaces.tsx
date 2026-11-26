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
import { tr } from '@/lib/tr';

const customerSections: NavSection[] = [
  {
    items: [
      {
        to: '/account',
        get label() {
          return tr('Overview');
        },
        labelKey: 'nav.overview',
        icon: LayoutDashboard,
        end: true,
      },
      {
        to: '/account/notifications',
        get label() {
          return tr('Notifications');
        },
        labelKey: 'nav.notifications',
        icon: Bell,
      },
    ],
  },
  {
    get title() {
      return tr('Travel');
    },
    titleKey: 'nav.travel',
    items: [
      {
        to: '/account/bookings',
        get label() {
          return tr('Bookings');
        },
        labelKey: 'nav.bookings',
        icon: CalendarCheck,
      },
      {
        to: '/trips',
        get label() {
          return tr('TripSpace');
        },
        labelKey: 'nav.trips',
        icon: Map,
      },
      {
        to: '/account/assistant',
        get label() {
          return tr('Travel assistant');
        },
        labelKey: 'nav.assistant',
        icon: Bot,
      },
      {
        to: '/account/price-alerts',
        get label() {
          return tr('Price alerts');
        },
        labelKey: 'nav.priceAlerts',
        icon: TrendingDown,
      },
      {
        to: '/account/rewards',
        get label() {
          return tr('Rewards');
        },
        labelKey: 'nav.rewards',
        icon: Gift,
      },
      {
        to: '/account/payments',
        get label() {
          return tr('Payments');
        },
        labelKey: 'nav.payments',
        icon: CreditCard,
      },
      {
        to: '/account/refunds',
        get label() {
          return tr('Refunds');
        },
        labelKey: 'nav.refunds',
        icon: Wallet,
      },
      {
        to: '/account/wishlists',
        get label() {
          return tr('Wishlists');
        },
        labelKey: 'nav.wishlists',
        icon: Heart,
      },
      {
        to: '/account/reviews',
        get label() {
          return tr('Reviews');
        },
        labelKey: 'nav.reviews',
        icon: Star,
      },
      {
        to: '/account/corporate',
        get label() {
          return tr('Corporate travel');
        },
        labelKey: 'nav.corporate',
        icon: Briefcase,
      },
      {
        to: '/account/support',
        get label() {
          return tr('Help & support');
        },
        labelKey: 'nav.support',
        icon: LifeBuoy,
      },
    ],
  },
  {
    get title() {
      return tr('Account');
    },
    titleKey: 'nav.account',
    items: [
      {
        to: '/account/profile',
        get label() {
          return tr('Profile');
        },
        labelKey: 'nav.profile',
        icon: UserRound,
      },
      {
        to: '/account/settings',
        get label() {
          return tr('Settings');
        },
        labelKey: 'nav.settings',
        icon: SlidersHorizontal,
      },
    ],
  },
];

export function CustomerLayout() {
  return (
    <DashboardShell
      workspace={tr('Traveller account')}
      sections={customerSections}
      homeLink="/account"
    />
  );
}

const partnerSections: NavSection[] = [
  {
    items: [
      {
        to: '/partner',
        get label() {
          return tr('Overview');
        },
        icon: LayoutDashboard,
        end: true,
        permissions: ['partner:access'],
      },
      {
        to: '/partner/dashboard',
        get label() {
          return tr('Performance');
        },
        icon: LineChart,
        permissions: ['partner:access'],
      },
      {
        to: '/partner/onboarding',
        get label() {
          return tr('Onboarding');
        },
        icon: ClipboardList,
      },
    ],
  },
  {
    get title() {
      return tr('Property management');
    },
    items: [
      {
        to: '/partner/properties',
        get label() {
          return tr('Properties');
        },
        icon: Building2,
        permissions: ['partner:access'],
      },
      {
        to: '/partner/inventory',
        get label() {
          return tr('Inventory calendar');
        },
        icon: BedDouble,
        end: true,
        permissions: ['partner:access'],
      },
      {
        to: '/partner/inventory/blocks',
        get label() {
          return tr('Blocks & closures');
        },
        icon: Ban,
        permissions: ['partner:access'],
      },
      {
        to: '/partner/bookings',
        get label() {
          return tr('Reservations');
        },
        icon: CalendarCheck,
        permissions: ['partner:access'],
      },
      {
        to: '/partner/reviews',
        get label() {
          return tr('Guest reviews');
        },
        icon: Star,
        permissions: ['partner:access'],
      },
      {
        to: '/partner/accessibility',
        get label() {
          return tr('Accessibility');
        },
        icon: Accessibility,
        permissions: ['partner:access'],
      },
      {
        to: '/partner/channels',
        get label() {
          return tr('Channel manager');
        },
        icon: Network,
        permissions: ['partner:access'],
      },
      {
        to: '/partner/support',
        get label() {
          return tr('Guest support');
        },
        icon: LifeBuoy,
        permissions: ['partner:access'],
      },
    ],
  },
  {
    get title() {
      return tr('Business');
    },
    items: [
      {
        to: '/partner/settlements',
        get label() {
          return tr('Settlements');
        },
        icon: Wallet,
        permissions: ['partner:access'],
      },
      {
        to: '/partner/staff',
        get label() {
          return tr('Team');
        },
        icon: Users,
        permissions: ['staff:manage'],
      },
      {
        to: '/account/profile',
        get label() {
          return tr('Profile & security');
        },
        icon: Settings,
      },
    ],
  },
];

export function PartnerLayout() {
  return (
    <DashboardShell
      workspace={tr('Partner workspace')}
      sections={partnerSections}
      homeLink="/partner/onboarding"
    />
  );
}

const adminSections: NavSection[] = [
  {
    items: [
      {
        to: '/admin',
        get label() {
          return tr('Overview');
        },
        icon: LayoutDashboard,
        end: true,
      },
      {
        to: '/admin/dashboard',
        get label() {
          return tr('Platform dashboard');
        },
        icon: LineChart,
        permissions: ['reports:view'],
      },
      {
        to: '/admin/reports',
        get label() {
          return tr('Reports & analytics');
        },
        icon: LineChart,
        permissions: ['analytics:platform'],
      },
      {
        to: '/admin/users',
        get label() {
          return tr('Users & roles');
        },
        icon: Users,
        permissions: ['users:read'],
      },
      {
        to: '/admin/customers',
        get label() {
          return tr('Customers');
        },
        icon: UserRound,
        permissions: ['users:read'],
      },
      {
        to: '/admin/audit-logs',
        get label() {
          return tr('Audit log');
        },
        icon: ScrollText,
        permissions: ['audit:read'],
      },
    ],
  },
  {
    get title() {
      return tr('Marketplace');
    },
    items: [
      {
        to: '/admin/partners',
        get label() {
          return tr('Partner approvals');
        },
        icon: ShieldCheck,
        permissions: ['partners:approve'],
      },
      {
        to: '/admin/properties',
        get label() {
          return tr('Property moderation');
        },
        icon: House,
        permissions: ['hotels:moderate'],
      },
      {
        to: '/admin/catalog',
        get label() {
          return tr('Catalogue');
        },
        icon: Tags,
        permissions: ['catalog:manage'],
      },
      {
        to: '/admin/bookings',
        get label() {
          return tr('Bookings & escalations');
        },
        icon: CalendarCheck,
        permissions: ['bookings:read-all'],
      },
      {
        to: '/admin/reviews',
        get label() {
          return tr('Review moderation');
        },
        icon: Star,
        permissions: ['reviews:moderate'],
      },
      {
        to: '/admin/support',
        get label() {
          return tr('Support queue');
        },
        icon: LifeBuoy,
        permissions: ['support:manage'],
      },
      {
        to: '/admin/content',
        get label() {
          return tr('Content');
        },
        icon: FileText,
        permissions: ['content:manage'],
      },
      {
        to: '/admin/organizations',
        get label() {
          return tr('Corporate accounts');
        },
        icon: Briefcase,
        permissions: ['users:manage'],
      },
    ],
  },
  {
    get title() {
      return tr('Finance');
    },
    items: [
      {
        to: '/admin/operations',
        get label() {
          return tr('Payments & operations');
        },
        icon: CreditCard,
        permissions: ['payments:read'],
      },
      {
        to: '/admin/payments',
        get label() {
          return tr('Payments');
        },
        icon: ReceiptIndianRupee,
        permissions: ['payments:read'],
      },
      {
        to: '/admin/refunds',
        get label() {
          return tr('Refunds');
        },
        icon: Wallet,
        permissions: ['payments:read'],
      },
      {
        to: '/admin/commissions',
        get label() {
          return tr('Commissions');
        },
        icon: Percent,
        permissions: ['payments:read'],
      },
      {
        to: '/admin/settlements',
        get label() {
          return tr('Settlements');
        },
        icon: Landmark,
        permissions: ['payments:read'],
      },
      {
        to: '/admin/coupons',
        get label() {
          return tr('Coupons');
        },
        icon: TicketPercent,
        permissions: ['coupons:manage'],
      },
    ],
  },
  {
    get title() {
      return tr('You');
    },
    items: [
      {
        to: '/admin/settings',
        get label() {
          return tr('Account & security');
        },
        icon: Settings,
      },
    ],
  },
];

export function AdminLayout() {
  return (
    <DashboardShell workspace={tr('Administration')} sections={adminSections} homeLink="/admin" />
  );
}
