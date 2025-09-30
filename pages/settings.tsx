import { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function SettingsRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/?view=settings'); }, [router]);
  return null;
}
