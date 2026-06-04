import { NextResponse } from 'next/server';

import {
  getAttributionSettings,
  getAutomationOverview,
  getBrandingSettings,
  getCampaignStats,
  getMerchantOverview,
  getOptInSettings,
  getPrivacySettings,
  getSubscriberBreakdown,
  getSubscriberKpis,
  getSubscriberLocationBreakdown,
  listCampaigns,
  listSegments,
} from '@/lib/server/data/store';
import { extractShopDomain } from '@/lib/server/shop-context';

export const runtime = 'nodejs';

const CACHE_HEADERS = {
  'Cache-Control': 'private, max-age=15, stale-while-revalidate=60',
};

export async function GET(request: Request) {
  try {
    const shopDomain = extractShopDomain(request);

    const [
      merchantOverview,
      campaignStats,
      subscriberKpis,
      subscriberBreakdown,
      subscriberLocations,
      automationsOverview,
      campaigns,
      segments,
      attribution,
      privacy,
      branding,
      optIn,
    ] = await Promise.all([
      getMerchantOverview(shopDomain),
      getCampaignStats(shopDomain),
      getSubscriberKpis(shopDomain),
      getSubscriberBreakdown(shopDomain),
      getSubscriberLocationBreakdown(shopDomain),
      getAutomationOverview(shopDomain),
      listCampaigns(shopDomain, 100),
      listSegments(shopDomain),
      getAttributionSettings(shopDomain),
      getPrivacySettings(shopDomain),
      getBrandingSettings(shopDomain),
      getOptInSettings(shopDomain),
    ]);

    const subscriberOverview = {
      shopDomain,
      ...subscriberKpis,
      browsers: subscriberBreakdown.browsers,
      platforms: subscriberBreakdown.platforms,
      countries: subscriberLocations.countries,
      cities: subscriberLocations.cities,
    };

    return NextResponse.json(
      {
        ok: true,
        shopDomain,
        merchantOverview,
        campaignStats,
        subscriberKpis,
        subscriberOverview,
        automationsOverview,
        campaigns,
        segments,
        attribution,
        privacy,
        branding,
        optIn,
      },
      { headers: CACHE_HEADERS },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to bootstrap app data.';
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
