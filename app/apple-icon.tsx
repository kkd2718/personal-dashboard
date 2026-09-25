import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

// Generated at build/request time via next/og — no extra image tooling needed.
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#2563eb',
          color: '#ffffff',
          fontSize: 88,
          fontWeight: 700,
          fontFamily: 'sans-serif',
        }}
      >
        CC
      </div>
    ),
    size
  );
}
