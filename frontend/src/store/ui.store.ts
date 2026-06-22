import { create } from 'zustand';
import { Lang } from '@/i18n';

export type Theme = 'dark' | 'light' | 'glass';

interface UiState {
  lang: Lang;
  dark: boolean;          // kept for back-compat: true for dark AND glass (both dark-based)
  glass: boolean;
  theme: Theme;
  sidebarOpen: boolean;
  toggleLang: () => void;
  toggleDark: () => void;       // back-compat alias → cycles the theme
  cycleTheme: () => void;
  setTheme: (t: Theme) => void;
  toggleSidebar: () => void;
  setLang: (lang: Lang) => void;
}

const savedLang = (localStorage.getItem('lang') as Lang) ?? 'ar';
// Migrate from the old `dark` boolean key, then prefer the newer `theme` key.
const legacyDark = localStorage.getItem('dark');
const savedTheme: Theme =
  (localStorage.getItem('theme') as Theme) ||
  (legacyDark === 'false' ? 'light' : 'dark');

function applyTheme(t: Theme) {
  const root = document.documentElement;
  root.classList.toggle('dark', t === 'dark' || t === 'glass'); // glass is a dark-based atmosphere
  root.classList.toggle('theme-glass', t === 'glass');
  root.classList.toggle('theme-light', t === 'light'); // hook for the dark-first→light comfort overrides
}
applyTheme(savedTheme);   // apply immediately on module load (avoids flash)

const ORDER: Theme[] = ['dark', 'light', 'glass'];

export const useUiStore = create<UiState>((set, get) => ({
  lang: savedLang,
  theme: savedTheme,
  dark: savedTheme !== 'light',
  glass: savedTheme === 'glass',
  sidebarOpen: true,

  toggleLang: () => {
    const lang = get().lang === 'ar' ? 'en' : 'ar';
    localStorage.setItem('lang', lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    set({ lang });
  },

  setTheme: (theme) => {
    localStorage.setItem('theme', theme);
    applyTheme(theme);
    set({ theme, dark: theme !== 'light', glass: theme === 'glass' });
  },

  cycleTheme: () => {
    const next = ORDER[(ORDER.indexOf(get().theme) + 1) % ORDER.length];
    get().setTheme(next);
  },

  // back-compat: anything still calling toggleDark now advances the theme cycle
  toggleDark: () => get().cycleTheme(),

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),

  setLang: (lang) => {
    localStorage.setItem('lang', lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    set({ lang });
  },
}));
