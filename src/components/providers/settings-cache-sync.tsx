'use client';

import { useEffect } from 'react';

import {
  useAttributionSettings,
  useBrandingSettings,
  useMerchantOverview,
} from '@/hooks/queries/use-app-queries';
import { useShopDomain } from '@/hooks/use-shop-domain';
import { useSettings } from '@/context/settings-context';

/** Applies React Query cached merchant settings into SettingsContext (instant UI). */
export function SettingsCacheSync() {
  const shop = useShopDomain();
  const { data: overview } = useMerchantOverview();
  const { data: branding } = useBrandingSettings();
  const { data: attribution } = useAttributionSettings();
  const {
    setStoreUrl,
    setLogo,
    setShopDomain,
    storeUrl,
    setAttributionModel,
    setAttributionCreditMode,
    setClickWindowDays,
    setImpressionWindowDays,
  } = useSettings();

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

  useEffect(() => {
    if (!attribution?.ok) {
      return;
    }

    const model = String(attribution.attributionModel ?? '');
    if (model === 'click' || model === 'impression') {
      setAttributionModel(model);
    }

    const creditMode = String(attribution.attributionCreditMode ?? '');
    if (creditMode === 'last_touch' || creditMode === 'all_touches') {
      setAttributionCreditMode(creditMode);
    }

    const clickDays = Number(attribution.clickWindowDays);
    if (Number.isFinite(clickDays) && clickDays > 0) {
      setClickWindowDays(clickDays);
    }

    const impressionDays = Number(attribution.impressionWindowDays);
    if (Number.isFinite(impressionDays) && impressionDays > 0) {
      setImpressionWindowDays(impressionDays);
    }
  }, [
    attribution,
    setAttributionCreditMode,
    setAttributionModel,
    setClickWindowDays,
    setImpressionWindowDays,
  ]);

  return null;
}
