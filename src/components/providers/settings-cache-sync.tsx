'use client';

import { useEffect } from 'react';

import { useBrandingSettings, useMerchantOverview } from '@/hooks/queries/use-app-queries';
import { useShopDomain } from '@/hooks/use-shop-domain';
import { useSettings } from '@/context/settings-context';

/** Applies React Query cached merchant settings into SettingsContext (instant UI). */
export function SettingsCacheSync() {
  const shop = useShopDomain();
  const { data: overview } = useMerchantOverview();
  const { data: branding } = useBrandingSettings();
  const { setStoreUrl, setLogo, setShopDomain, storeUrl } = useSettings();

  useEffect(() => {
    if (shop) {
      setShopDomain(shop);
    }
  }, [shop, setShopDomain]);

  useEffect(() => {
    if (!overview) {
      return;
    }

    const nextStoreUrl = String(overview.storeUrl ?? '').trim();
    if (nextStoreUrl) {
      setStoreUrl(nextStoreUrl);
      return;
    }

    if (!storeUrl && shop) {
      setStoreUrl(`https://${shop}`);
    }
  }, [overview, setStoreUrl, shop, storeUrl]);

  useEffect(() => {
    if (!branding) {
      return;
    }

    const logoUrl = String(branding.logoUrl ?? '').trim();
    if (logoUrl) {
      setLogo({ file: null, preview: logoUrl });
    }
  }, [branding, setLogo]);

  return null;
}
