import { create } from 'zustand';
import { Lang } from '@/i18n';

interface UiState {
  lang: Lang;
  dark: boolean;
  sidebarOpen: boolean;
  toggleLang: () => void;
  toggleDark: () => void;
  toggleSidebar: () => void;
  setLang: (lang: Lang) => void;
}

const savedLang = (localStorage.getItem('lang') as Lang) ?? 'ar';
const savedDark = localStorage.getItem('dark') === 'true';

export const useUiStore = create<UiState>((set, get) => ({
  lang: savedLang,
  dark: savedDark,
  sidebarOpen: true,

  toggleLang: () => {
    const lang = get().lang === 'ar' ? 'en' : 'ar';
    localStorage.setItem('lang', lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    set({ lang });
  },

  toggleDark: () => {
    const dark = !get().dark;
    localStorage.setItem('dark', String(dark));
    document.documentElement.classList.toggle('dark', dark);
    set({ dark });
  },

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),

  setLang: (lang) => {
    localStorage.setItem('lang', lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    set({ lang });
  },
}));
