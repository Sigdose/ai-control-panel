import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    // Cloudflare Tunnel (`npx cloudflared tunnel --url ...`)을 통해 접속할 때
    // Vite의 호스트 헤더 검증을 통과시키기 위해 명시적으로 허용.
    // trycloudflare 무료 티어는 매번 다른 서브도메인이라 와일드카드 사용.
    allowedHosts: [
      '.trycloudflare.com',  // 모든 *.trycloudflare.com 서브도메인 허용
      '.cloudflare.com',     // 정식 cloudflare 터널용
      'localhost',
      '127.0.0.1',
    ],
  },
})
