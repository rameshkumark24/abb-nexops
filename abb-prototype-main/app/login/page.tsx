'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Login from '@/components/Login';

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const roleParam = searchParams.get('role');
  
  const role = roleParam === 'admin' || roleParam === 'engineer' || roleParam === 'technician' 
    ? roleParam 
    : 'admin';

  const handleBack = () => {
    router.push('/');
  };

  return <Login role={role} onBack={handleBack} />;
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <LoginContent />
    </Suspense>
  );
}
