/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  safelist: [
    // InstallPage에서 동적으로 만들어지는 클래스
    'text-stt', 'text-llm', 'text-tts',
    'accent-stt', 'accent-llm', 'accent-tts',
    'bg-stt', 'bg-llm', 'bg-tts',
    'border-stt', 'border-llm', 'border-tts',
  ],
  theme: {
    extend: {
      colors: {
        // Lab instrument panel palette (slightly brighter v2)
        ink: {
          950: '#0a0a0e',   // 본문 베이스 (조금 밝게)
          900: '#101015',
          850: '#15151c',
          800: '#1c1c24',
          750: '#23232d',
          700: '#2c2c38',
          600: '#3d3d4a',
          500: '#555562',
          400: '#787884',
          300: '#a8a8b3',
          200: '#d0d0d7',
          100: '#f0f0f3',
        },
        // Service accents
        stt:  { DEFAULT: '#22d3ee', glow: '#22d3ee33' }, // cyan
        llm:  { DEFAULT: '#a78bfa', glow: '#a78bfa33' }, // violet
        tts:  { DEFAULT: '#f472b6', glow: '#f472b633' }, // pink
        // Status
        live: { DEFAULT: '#22d3a5', glow: '#22d3a544' },
        dead: { DEFAULT: '#ef4444', glow: '#ef444444' },
        wait: { DEFAULT: '#f59e0b', glow: '#f59e0b44' },
        // Log levels (뷰어용)
        loginfo:  '#7dd3fc',  // sky
        logwarn:  '#fbbf24',  // amber
        logerror: '#f87171',  // red
        logdebug: '#9a9aa5',  // ink-300
      },
      fontFamily: {
        sans: ['Geist', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.04em' }],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'scan': 'scan 2.5s linear infinite',
        'fade-in': 'fadeIn 0.4s ease-out',
      },
      keyframes: {
        scan: {
          '0%':   { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
        fadeIn: {
          '0%':   { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}
