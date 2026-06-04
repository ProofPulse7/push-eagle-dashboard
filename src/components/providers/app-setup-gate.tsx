'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';

import { AppSetupScreen } from '@/components/ui/loading-ui';
import { useAppBootstrap } from '@/hooks/queries/use-app-queries';
import { useShopDomain } from '@/hooks/use-shop-domain';

const SETUP_STEPS = [
  'Connecting to your Shopify store…',
  'Loading campaigns and automations…',
  'Loading analytics and subscribers…',
  'Applying your saved settings…',
  'Almost ready…',
] as const;

const shouldSkipSetup = (pathname: string) => {
  if (pathname.startsWith('/login')) {
    return true;
  }
  if (pathname.startsWith('/campaigns/new')) {
    return true;
  }
  return /^\/automations\/[a-zA-Z0-9-]+\/[^/]+\/edit$/.test(pathname);
};

export function AppSetupGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const shop = useShopDomain();
  const bootstrap = useAppBootstrap();
  const skip = shouldSkipSetup(pathname);
  const [animatedProgress, setAnimatedProgress] = useState(8);

  const hasBootstrapData = Boolean(bootstrap.data);
  const isReady =
    skip || !shop || bootstrap.isSuccess || (hasBootstrapData && !bootstrap.isPending);
  const showSetup = !skip && Boolean(shop) && !isReady;

  const targetProgress = useMemo(() => {
    if (bootstrap.isSuccess) {
      return 100;
    }
    if (bootstrap.isFetching && hasBootstrapData) {
      return 88;
    }
    if (bootstrap.isFetching) {
      return 72;
    }
    if (bootstrap.isPending) {
      return 36;
    }
    return 12;
  }, [bootstrap.isSuccess, bootstrap.isFetching, bootstrap.isPending, hasBootstrapData]);

  useEffect(() => {
    if (!showSetup) {
      return;
    }

    const interval = window.setInterval(() => {
      setAnimatedProgress((current) => {
        if (current >= targetProgress) {
          return current;
        }
        const delta = Math.max(2, (targetProgress - current) * 0.35);
        return Math.min(targetProgress, current + delta);
      });
    }, 80);

    return () => window.clearInterval(interval);
  }, [showSetup, targetProgress]);

  useEffect(() => {
    if (bootstrap.isSuccess) {
      setAnimatedProgress(100);
    }
  }, [bootstrap.isSuccess]);

  const stepIndex = Math.min(
    SETUP_STEPS.length - 1,
    Math.floor((animatedProgress / 100) * SETUP_STEPS.length),
  );
  const stepLabel = SETUP_STEPS[stepIndex];

  if (showSetup) {
    return (
      <AppSetupScreen
        progress={animatedProgress}
        stepLabel={stepLabel}
        error={
          bootstrap.isError
            ? bootstrap.error instanceof Error
              ? bootstrap.error.message
              : 'Setup failed. Please try again.'
            : null
        }
        onRetry={
          bootstrap.isError
            ? () => {
                void bootstrap.refetch();
              }
            : undefined
        }
      />
    );
  }

  return <>{children}</>;
}
