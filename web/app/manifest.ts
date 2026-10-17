import type { MetadataRoute } from 'next';

/** Lets phones add the site to the home screen as an app */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Tangy Football',
    short_name: 'Tangy Football',
    description: 'Standings, live scores, playoff odds, trades and league history for Tangy Football.',
    start_url: '/',
    display: 'standalone',
    background_color: '#000000',
    theme_color: '#000000',
    // Static files (public/), drawn from components/ui/Football.tsx; iPhones use app/apple-icon.png
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
