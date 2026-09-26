'use client';

import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { logoutAction } from '@/app/actions/auth';

export function LogoutButton() {
  return (
    <Button variant="secondary" onClick={() => logoutAction()}>
      <LogOut size={14} />
      로그아웃
    </Button>
  );
}
