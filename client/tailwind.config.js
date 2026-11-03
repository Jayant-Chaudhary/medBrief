/** @type {import('tailwindcss').Config} */
export default {
  // `.dark` on <html> (set by ThemeContext) switches the colour tokens.
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // Every colour is a CSS variable (src/theme-tokens.css) with a light and
      // a dark value, so the same class works in both themes.
      colors: {
        primary: {
          DEFAULT: 'rgb(var(--c-primary) / <alpha-value>)',
          dark: 'rgb(var(--c-primary-dark) / <alpha-value>)',
          light: 'rgb(var(--c-primary-light) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--c-accent) / <alpha-value>)',
          dark: 'rgb(var(--c-accent-dark) / <alpha-value>)',
          light: 'rgb(var(--c-accent-light) / <alpha-value>)',
        },
        canvas: {
          DEFAULT: 'rgb(var(--c-canvas) / <alpha-value>)',
          alt: 'rgb(var(--c-canvas-alt) / <alpha-value>)',
        },
        ink: {
          DEFAULT: 'rgb(var(--c-ink) / <alpha-value>)',
          soft: 'rgb(var(--c-ink-soft) / <alpha-value>)',
        },
        success: {
          DEFAULT: 'rgb(var(--c-success) / <alpha-value>)',
          light: 'rgb(var(--c-success-light) / <alpha-value>)',
          dark: 'rgb(var(--c-success-dark) / <alpha-value>)',
        },
        attention: {
          DEFAULT: 'rgb(var(--c-attention) / <alpha-value>)',
          light: 'rgb(var(--c-attention-light) / <alpha-value>)',
          dark: 'rgb(var(--c-attention-dark) / <alpha-value>)',
        },
        danger: { DEFAULT: 'rgb(var(--c-danger) / <alpha-value>)' },
        subcanvas: 'rgb(var(--c-subcanvas) / <alpha-value>)',
        surface: 'rgb(var(--c-surface) / <alpha-value>)',
        raised: 'rgb(var(--c-raised) / <alpha-value>)',
        line: 'rgb(var(--c-line) / <alpha-value>)',
        'line-strong': 'rgb(var(--c-line-strong) / <alpha-value>)',
        'ink-2': 'rgb(var(--c-ink-2) / <alpha-value>)',
        'ink-3': 'rgb(var(--c-ink-3) / <alpha-value>)',
        cypress: {
          DEFAULT: 'rgb(var(--c-cypress) / <alpha-value>)',
          deep: 'rgb(var(--c-cypress-deep) / <alpha-value>)',
          soft: 'rgb(var(--c-cypress-soft) / <alpha-value>)',
        },
        sage: {
          DEFAULT: 'rgb(var(--c-sage) / <alpha-value>)',
          surface: 'rgb(var(--c-sage-surface) / <alpha-value>)',
          border: 'rgb(var(--c-sage-border) / <alpha-value>)',
          ink: 'rgb(var(--c-sage-ink) / <alpha-value>)',
        },
        terracotta: {
          DEFAULT: 'rgb(var(--c-terracotta) / <alpha-value>)',
          surface: 'rgb(var(--c-terracotta-surface) / <alpha-value>)',
          border: 'rgb(var(--c-terracotta-border) / <alpha-value>)',
          deep: 'rgb(var(--c-terracotta-deep) / <alpha-value>)',
          '50': 'rgb(var(--c-terracotta-surface) / <alpha-value>)',
          '200': 'rgb(var(--c-terracotta-border) / <alpha-value>)',
          '600': 'rgb(var(--c-terracotta-deep) / <alpha-value>)',
        },
        rose: {
          DEFAULT: 'rgb(var(--c-rose) / <alpha-value>)',
          surface: 'rgb(var(--c-rose-surface) / <alpha-value>)',
          border: 'rgb(var(--c-rose-border) / <alpha-value>)',
        },
        olive: {
          DEFAULT: 'rgb(var(--c-olive) / <alpha-value>)',
          surface: 'rgb(var(--c-olive-surface) / <alpha-value>)',
          border: 'rgb(var(--c-olive-border) / <alpha-value>)',
        },
        sand: {
          '100': 'rgb(var(--c-sand-100) / <alpha-value>)',
          '800': 'rgb(var(--c-sand-800) / <alpha-value>)',
        },
        pine: {
          '50': 'rgb(var(--c-pine-50) / <alpha-value>)',
          '100': 'rgb(var(--c-pine-100) / <alpha-value>)',
          '200': 'rgb(var(--c-pine-200) / <alpha-value>)',
          '300': 'rgb(var(--c-pine-300) / <alpha-value>)',
          '400': 'rgb(var(--c-pine-400) / <alpha-value>)',
          '500': 'rgb(var(--c-pine-500) / <alpha-value>)',
          '600': 'rgb(var(--c-pine-600) / <alpha-value>)',
          '700': 'rgb(var(--c-pine-700) / <alpha-value>)',
          '800': 'rgb(var(--c-pine-800) / <alpha-value>)',
          '900': 'rgb(var(--c-pine-900) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        'label-sm': ['12px', { lineHeight: '16px', letterSpacing: '0.03em', fontWeight: '700' }],
        'label-md': ['13px', { lineHeight: '18px', letterSpacing: '0.02em', fontWeight: '600' }],
        'label-lg': ['14px', { lineHeight: '20px', letterSpacing: '0em', fontWeight: '600' }],
        'body-sm': ['13.5px', { lineHeight: '20px' }],
        'body-md': ['14px', { lineHeight: '22px' }],
        'body-lg': ['16px', { lineHeight: '24px', letterSpacing: '-0.005em' }],
        'head-sm': ['18px', { lineHeight: '26px', letterSpacing: '-0.01em', fontWeight: '600' }],
        'head-lg': ['24px', { lineHeight: '32px', letterSpacing: '-0.015em', fontWeight: '600' }],
      },
      borderRadius: {
        card: '20px',
        control: '16px',
        xl: '0.75rem', 
        '2xl': '1rem'
      },
      boxShadow: {
        card: '0 1px 3px 0 rgba(15, 23, 42, 0.05), 0 1px 2px -1px rgba(15, 23, 42, 0.05)',
        raised: '0 4px 6px -1px rgba(15, 23, 42, 0.07), 0 2px 4px -2px rgba(15, 23, 42, 0.05)',
        overlay: '0 20px 25px -5px rgba(15, 23, 42, 0.1), 0 8px 10px -6px rgba(15, 23, 42, 0.1)',
        focus: '0 0 0 3px rgba(13, 148, 136, 0.18)',
      },
      transitionDuration: { 250: '250ms' },
    },
  },
  plugins: [],
}
