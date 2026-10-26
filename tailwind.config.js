import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#E9EBF3',
        surface: '#FFFFFF',
        panel: '#F7F8FC',
        ink: '#101828',
        muted: '#667085',
        line: '#EAECF0',
        brand: {
          50: '#F1F0FF',
          100: '#E6E4FF',
          200: '#D1CDFF',
          300: '#B3ACFF',
          400: '#8F84FF',
          500: '#6C5CE7',
          600: '#5B4BD6',
          700: '#4A3BB5',
          800: '#3D3292',
          900: '#342C78'
        },
        success: {
          50: '#ECFDF3',
          100: '#D1FADF',
          500: '#12B76A',
          600: '#039855',
          700: '#027A48'
        },
        warning: {
          50: '#FFFAEB',
          100: '#FEF0C7',
          500: '#F79009',
          600: '#DC6803',
          700: '#B54708'
        },
        danger: {
          50: '#FEF3F2',
          100: '#FEE4E2',
          500: '#F04438',
          600: '#D92D20',
          700: '#B42318'
        },
        sky: {
          50: '#F0F9FF',
          100: '#E0F2FE',
          500: '#0EA5E9',
          600: '#0284C7'
        }
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'system-ui', 'sans-serif'],
        display: ['"Plus Jakarta Sans Variable"', '"Plus Jakarta Sans"', 'system-ui', 'sans-serif']
      },
      boxShadow: {
        card: '0 12px 40px -24px rgba(16, 24, 40, 0.28)',
        soft: '0 4px 20px -12px rgba(16, 24, 40, 0.18)',
        shell: '0 40px 100px -48px rgba(16, 24, 40, 0.38)',
        pop: '0 20px 48px -16px rgba(16, 24, 40, 0.22)'
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' }
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' }
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.97)' },
          to: { opacity: '1', transform: 'scale(1)' }
        },
        'slide-in-right': {
          from: { opacity: '0', transform: 'translateX(24px)' },
          to: { opacity: '1', transform: 'translateX(0)' }
        },
        'slide-in-left': {
          from: { opacity: '0', transform: 'translateX(-24px)' },
          to: { opacity: '1', transform: 'translateX(0)' }
        }
      },
      animation: {
        'fade-in': 'fade-in 180ms ease-out both',
        'slide-up': 'slide-up 240ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'scale-in': 'scale-in 180ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'slide-in-right': 'slide-in-right 240ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'slide-in-left': 'slide-in-left 240ms cubic-bezier(0.16, 1, 0.3, 1) both'
      }
    }
  },
  plugins: []
}

export default config
