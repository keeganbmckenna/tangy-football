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
    icons: [
      { src: '/app-icon/192', sizes: '192x192', type: 'image/png' },
      { src: '/app-icon/512', sizes: '512x512', type: 'image/png' },
      { src: '/app-icon/512', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
