import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Command Center',
    short_name: 'CC',
    description: '개인 메모함 + 프로젝트/논문/마감 커맨드 센터',
    start_url: '/',
    display: 'standalone',
    background_color: '#0b1120',
    theme_color: '#0b1120',
    // Rasters come from app/icon.svg via scripts/build-icons.mjs.
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    share_target: {
      action: '/share',
      method: 'GET',
      params: { title: 'title', text: 'text', url: 'url' },
    },
  };
}
