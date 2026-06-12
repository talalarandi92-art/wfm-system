/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#eef2ff',
          100: '#e0e7ff',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          900: '#312e81',
        },
        accent: {
          cyan:   '#06b6d4',
          violet: '#8b5cf6',
          emerald:'#10b981',
          amber:  '#f59e0b',
          rose:   '#f43f5e',
        },
        /* Semantic surfaces driven by CSS variables (theme-aware) */
        surface: {
          DEFAULT: 'var(--surface)',
          2:       'var(--surface-2)',
        },
      },
      textColor: {
        1: 'var(--text-1)',
        2: 'var(--text-2)',
        3: 'var(--text-3)',
      },
      borderColor: {
        token:        'var(--border)',
        'token-strong': 'var(--border-strong)',
      },
      fontFamily: {
        sans:    ['Inter', 'Segoe UI', 'sans-serif'],
        display: ['Plus Jakarta Sans', 'Inter', 'sans-serif'],
        arabic:  ['Cairo', 'Tajawal', 'sans-serif'],
        mono:    ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      borderRadius: {
        '2xl': '16px',
        '3xl': '24px',
      },
      boxShadow: {
        'glow-indigo': '0 0 24px rgba(99,102,241,0.4)',
        'glow-cyan':   '0 0 24px rgba(6,182,212,0.4)',
        'glow-green':  '0 0 24px rgba(16,185,129,0.4)',
        'card':        '0 1px 3px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.04)',
        'card-hover':  '0 4px 24px rgba(0,0,0,0.08)',
        'dark-card':   '0 1px 0 rgba(255,255,255,0.04), 0 4px 16px rgba(0,0,0,0.3)',
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic':  'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
      },
      animation: {
        'fade-up':    'fadeUp .4s cubic-bezier(.22,.68,0,1.2) both',
        'scale-in':   'scaleIn .28s cubic-bezier(.34,1.56,.64,1) both',
        'orb-float':  'float 6s ease-in-out infinite',
        'spin-slow':  'spin 4s linear infinite',
        'pulse-slow': 'pulse 3s ease-in-out infinite',
      },
      keyframes: {
        fadeUp:  { from:{opacity:'0',transform:'translateY(16px)'}, to:{opacity:'1',transform:'translateY(0)'} },
        scaleIn: { from:{opacity:'0',transform:'scale(.94)'},        to:{opacity:'1',transform:'scale(1)'}    },
        float:   { '0%,100%':{transform:'translateY(0)'},            '50%':{transform:'translateY(-12px)'}   },
      },
      spacing: {
        '18': '4.5rem',
        '88': '22rem',
      },
      transitionTimingFunction: {
        'spring': 'cubic-bezier(0.34,1.56,0.64,1)',
      },
    },
  },
  plugins: [],
};
