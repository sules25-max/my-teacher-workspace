import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages(https://<id>.github.io/<repo>/) 어디에 올려도 동작하도록 상대 경로 + 해시 라우팅을 사용한다.
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      // 새 버전은 자동 새로고침하지 않고, 입력을 저장한 뒤 사용자가 적용한다(main.tsx)
      registerType: 'prompt',
      manifestFilename: 'manifest.webmanifest',
      includeAssets: ['aichatbotseat.png', 'icons/icon-180.png'],
      manifest: {
        name: 'My Teacher Workspace',
        short_name: 'Teacher WS',
        description: '나만의 교사 업무수첩',
        lang: 'ko',
        id: './',
        start_url: './#/today',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        background_color: '#F2FBFF',
        theme_color: '#F2FBFF',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: 'index.html',
        globPatterns: ['**/*.{js,css,html,png,svg,woff2,webp}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.hostname === 'cdn.jsdelivr.net',
            handler: 'CacheFirst',
            options: { cacheName: 'fonts', expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
        ],
      },
    }),
  ],
});
