import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { http } from '@/lib/api/client';
import { useAppSelector } from '@/app/store';

export type Language = 'en' | 'hi';
const STORAGE_KEY = 'stayscape.language';

/** English is the source; Hindi strings fall back to English when a key is missing. */
const en = {
  'nav.overview': 'Overview',
  'nav.notifications': 'Notifications',
  'nav.travel': 'Travel',
  'nav.bookings': 'Bookings',
  'nav.payments': 'Payments',
  'nav.refunds': 'Refunds',
  'nav.wishlists': 'Wishlists',
  'nav.reviews': 'Reviews',
  'nav.support': 'Help & support',
  'nav.trips': 'TripSpace',
  'nav.rewards': 'Rewards',
  'nav.priceAlerts': 'Price alerts',
  'nav.assistant': 'Travel assistant',
  'nav.corporate': 'Corporate travel',
  'nav.account': 'Account',
  'nav.profile': 'Profile',
  'nav.settings': 'Settings',
  'lang.label': 'Language',
  'lang.en': 'English',
  'lang.hi': 'हिन्दी',
  'common.loading': 'Loading',
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.delete': 'Delete',
  'common.retry': 'Try again',
  'common.empty': 'Nothing here yet.',
  'trips.title': 'TripSpace',
  'trips.description':
    'Plan trips together: save stays, add your bookings and share notes with the people travelling with you.',
  'trips.new': 'New trip',
  'rewards.title': 'Rewards',
  'rewards.balance': 'Points balance',
  'rewards.tier': 'Tier',
  'alerts.title': 'Price alerts',
  'assistant.title': 'Travel assistant',
  'assistant.placeholder': 'Ask about places to stay, dates or prices…',
  'assistant.send': 'Send',
  'assistant.disclaimer':
    'Answers use only Stayscape listings and live prices. The assistant cannot book or pay for you.',
  'corporate.title': 'Corporate travel',
} as const;
export type MessageKey = keyof typeof en;

const hi: Partial<Record<MessageKey, string>> = {
  'nav.overview': 'सारांश',
  'nav.notifications': 'सूचनाएँ',
  'nav.travel': 'यात्रा',
  'nav.bookings': 'बुकिंग',
  'nav.payments': 'भुगतान',
  'nav.refunds': 'धनवापसी',
  'nav.wishlists': 'पसंदीदा सूची',
  'nav.reviews': 'समीक्षाएँ',
  'nav.support': 'सहायता',
  'nav.trips': 'ट्रिपस्पेस',
  'nav.rewards': 'रिवॉर्ड्स',
  'nav.priceAlerts': 'मूल्य अलर्ट',
  'nav.assistant': 'यात्रा सहायक',
  'nav.corporate': 'कॉर्पोरेट यात्रा',
  'nav.account': 'खाता',
  'nav.profile': 'प्रोफ़ाइल',
  'nav.settings': 'सेटिंग्स',
  'lang.label': 'भाषा',
  'common.loading': 'लोड हो रहा है',
  'common.save': 'सहेजें',
  'common.cancel': 'रद्द करें',
  'common.delete': 'हटाएँ',
  'common.retry': 'फिर से कोशिश करें',
  'common.empty': 'अभी यहाँ कुछ नहीं है।',
  'trips.title': 'ट्रिपस्पेस',
  'trips.description':
    'साथ मिलकर यात्रा की योजना बनाएँ: ठहरने की जगहें सहेजें, अपनी बुकिंग जोड़ें और साथ यात्रा करने वालों के साथ नोट्स साझा करें।',
  'trips.new': 'नई यात्रा',
  'rewards.title': 'रिवॉर्ड्स',
  'rewards.balance': 'पॉइंट्स बैलेंस',
  'rewards.tier': 'स्तर',
  'alerts.title': 'मूल्य अलर्ट',
  'assistant.title': 'यात्रा सहायक',
  'assistant.placeholder': 'ठहरने की जगह, तारीखें या कीमतों के बारे में पूछें…',
  'assistant.send': 'भेजें',
  'assistant.disclaimer':
    'जवाब केवल Stayscape की लिस्टिंग और वर्तमान कीमतों पर आधारित हैं। सहायक आपके लिए बुकिंग या भुगतान नहीं कर सकता।',
  'corporate.title': 'कॉर्पोरेट यात्रा',
};
export const dictionaries: Record<Language, Partial<Record<MessageKey, string>>> = { en, hi };

interface I18nValue {
  language: Language;
  setLanguage: (l: Language) => void;
  t: (key: MessageKey) => string;
}
const I18nContext = createContext<I18nValue>({
  language: 'en',
  setLanguage: () => undefined,
  t: (k) => en[k],
});

function stored(): Language | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'en' || v === 'hi' ? v : null;
  } catch {
    return null;
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const userLanguage = useAppSelector((s) => s.auth.user?.preferences.language);
  const signedIn = useAppSelector((s) => s.auth.status === 'authenticated');
  const [language, setState] = useState<Language>(() => stored() ?? 'en');
  // A signed-in user's saved preference wins over this browser's.
  useEffect(() => {
    if (userLanguage === 'en' || userLanguage === 'hi') setState(userLanguage);
  }, [userLanguage]);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  const setLanguage = useCallback(
    (l: Language) => {
      setState(l);
      try {
        localStorage.setItem(STORAGE_KEY, l);
      } catch {
        /* storage unavailable: preference lasts for this visit */
      }
      if (signedIn) void http.patch('/users/preferences', { language: l }).catch(() => undefined);
    },
    [signedIn],
  );
  const value = useMemo<I18nValue>(
    () => ({ language, setLanguage, t: (key) => dictionaries[language][key] ?? en[key] }),
    [language, setLanguage],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);

export function LanguageSwitcher({ className }: { className?: string }) {
  const { language, setLanguage, t } = useI18n();
  return (
    <label className={className}>
      <span className="sr-only">{t('lang.label')}</span>
      <select
        value={language}
        onChange={(e) => setLanguage(e.target.value as Language)}
        className="h-9 rounded-full border border-border bg-surface px-3 text-sm text-fg focus-visible:outline-2 focus-visible:outline-ring"
      >
        <option value="en" lang="en">
          English
        </option>
        <option value="hi" lang="hi">
          हिन्दी
        </option>
      </select>
    </label>
  );
}
