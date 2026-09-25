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
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
    share_target: {
      action: '/share',
      method: 'GET',
      params: { title: 'title', text: 'text', url: 'url' },
    },
  };
}
