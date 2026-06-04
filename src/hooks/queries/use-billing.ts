'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { fetchJson, fetchJsonWithShop } from '@/lib/client/api-fetch';
import { useShopDomain } from '@/hooks/use-shop-domain';

export const billingKeys = {
  status: (shop: string) => ['pe', shop, 'billing', 'status'] as const,
};

export function useBillingStatus() {
  const shop = useShopDomain();
  return useQuery({
    queryKey: billingKeys.status(shop),
    queryFn: () => fetchJsonWithShop<{ billing: Record<string, unknown> }>('/api/billing/status', shop),
    enabled: Boolean(shop),
    staleTime: 5 * 60 * 1000,
    placeholderData: (previous) => previous,
  });
}

export function useSubscribePlan() {
  const shop = useShopDomain();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: { planKey: 'basic' | 'business'; tierId?: string }) =>
      fetchJson<{ confirmationUrl?: string; activated?: boolean }>('/api/billing/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopDomain: shop, ...body }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: billingKeys.status(shop) });
    },
  });
}

export function useConfirmBilling() {
  const shop = useShopDomain();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      fetchJson<{ activated?: boolean }>('/api/billing/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopDomain: shop }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: billingKeys.status(shop) });
    },
  });
}
