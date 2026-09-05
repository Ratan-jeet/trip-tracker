/** @type {import('tailwindcss').Config} */
const withOpacity = (variable) => `hsl(var(${variable}) / <alpha-value>)`;

module.exports = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./src/components/**/*.{js,ts,jsx,tsx,mdx}', './src/app/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // Semantic roles only — see globals.css. No raw palette scales in components.
        surface: {
          DEFAULT: withOpacity('--bg-elevated'),
          base: withOpacity('--bg'),
          subtle: withOpacity('--bg-subtle'),
          inset: withOpacity('--bg-inset'),
        },
        border: {
          DEFAULT: withOpacity('--border'),
          strong: withOpacity('--border-strong'),
        },
        fg: {
          DEFAULT: withOpacity('--text'),
          muted: withOpacity('--text-muted'),
          subtle: withOpacity('--text-subtle'),
        },
        accent: {
          DEFAULT: withOpacity('--accent'),
          hover: withOpacity('--accent-hover'),
          fg: withOpacity('--accent-fg'),
          soft: withOpacity('--accent-soft'),
        },
        live: {
          DEFAULT: withOpacity('--live'),
          soft: withOpacity('--live-soft'),
        },
        warning: {
          DEFAULT: withOpacity('--warning'),
          soft: withOpacity('--warning-soft'),
        },
        danger: {
          DEFAULT: withOpacity('--danger'),
          hover: withOpacity('--danger-hover'),
          soft: withOpacity('--danger-soft'),
        },
        vehicle: withOpacity('--vehicle'),
        ring: withOpacity('--ring'),
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
      },
      animation: {
        'fade-in-up': 'fade-in-up 0.18s ease-out',
        'pulse-ring': 'pulse-ring 2s cubic-bezier(0.2, 0.6, 0.4, 1) infinite',
      },
      // Keeps floating map controls clear of iOS home indicators and notches.
      spacing: {
        'safe-b': 'env(safe-area-inset-bottom, 0px)',
        'safe-t': 'env(safe-area-inset-top, 0px)',
      },
    },
  },
  plugins: [],
};
