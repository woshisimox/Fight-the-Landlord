import { useEffect } from 'react';
import { useRouter } from 'next/router';
export default function ArenaRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/?view=arena'); }, [router]);
  return null;
}
