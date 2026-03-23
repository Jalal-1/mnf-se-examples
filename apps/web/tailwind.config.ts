import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        midnight: {
          950: '#000000',
          900: '#060610',
          800: '#0c0c1a',
          700: '#141422',
          600: '#1c1c2e',
          500: '#2a2a3d',
          accent: '#0080ff',
          'accent-hover': '#0066cc',
          success: '#00d66f',
          warn: '#f5a623',
        },
      },
      fontFamily: {
        sans: ['Outfit', 'system-ui', 'sans-serif'],
        mono: ['"Courier New"', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
