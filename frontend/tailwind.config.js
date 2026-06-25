/** @type {import('tailwindcss').Config} */
// CDN(cdn.tailwindcss.com) 대신 빌드 타임에 Tailwind를 생성한다.
// extend 토큰은 기존 index.html 인라인 tailwind.config와 동일하게 유지(카드 배경/테두리/폰트).
module.exports = {
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        'surface-container': '#161b22',
        'surface-variant':   '#2d333b',
        'on-surface':        '#e5e7eb',
      },
      fontFamily: {
        display: ['Noto Sans KR', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
