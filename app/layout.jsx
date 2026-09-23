// app/layout.jsx
import './globals.css';

export const metadata = {
  title: 'Watch2Gether - Birlikte YouTube İzle',
  description: 'Anlık senkronize YouTube izleme ve sohbet odaları',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({ children }) {
  return (
    <html lang="tr">
      <head>
        <script src="https://www.youtube.com/iframe_api" async></script>
      </head>
      <body>{children}</body>
    </html>
  );
}
