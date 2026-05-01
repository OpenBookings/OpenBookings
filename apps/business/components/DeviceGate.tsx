// components/DeviceGate.tsx
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export function DeviceGate() {
  const router = useRouter();

  useEffect(() => {
    const check = () => {
      if (window.innerWidth < 1024) router.replace('/unsupported-device');
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  return null;
}