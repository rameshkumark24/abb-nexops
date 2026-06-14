'use client';

import { useRouter } from 'next/navigation';
import Landing from '@/components/Landing';

export default function Page() {
  const router = useRouter();

  const handleEnter = (selectedRole: 'admin' | 'engineer' | 'technician') => {
    router.push(`/login?role=${selectedRole}`);
  };

  return <Landing onEnter={handleEnter} />;
}
