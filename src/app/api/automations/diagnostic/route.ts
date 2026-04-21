import { NextRequest, NextResponse } from 'next/server';

import { getNeonSql } from '@/lib/integrations/database/neon';
import { getAttributionSettings } from '@/lib/server/data/store';

type DiagnosticIssue = {
  severity: 'error' | 'warning' | 'info';
  component: string;
  title: string;
  description: string;
  details?: Record<string, unknown>;
};

type AttributionTouch = {
  sourceType: 'campaign_click' | 'campaign_impression' | 'automation_click' | 'automation_impression';
  sourceId: string;
  orderId: string;
  revenueCents: number;
  occurredAt: string | null;
};

type DiagnosticResult = {
  ok: boolean;
  checkedAt: string;
  shopDomain: string;
  issues: DiagnosticIssue[];
  attributionSettings: {
    attributionModel: 'click' | 'impression';
    attributionCreditMode: 'last_touch' | 'all_touches';
    clickWindowDays: number;
    impressionWindowDays: number;
  };
  attributionSummary: {
    orders7d: number;
    totalRevenueCents7d: number;
    attributedOrders7d: number;
    unattributedOrders7d: number;
    attributedRevenueCents7d: number;
    attributedRevenueRatePercent: number;
    campaignAttributedRevenueCents7d: number;
    automationAttributedRevenueCents7d: number;
    welcomeAttributedOrders7d: number;
    welcomeAttributedRevenueCents7d: number;
    welcomeTouches7d: {
      deliveries: number;
      clicks: number;
    };
  };
  webhookHealth: {
    ordersCreateEvents7d: number;
    lastOrdersCreateEventAt: string | null;
  };
  identityCoverage: {
    orders7d: number;
    withExternalId: number;
    withCustomerId: number;
    withEmail: number;
    missingAllIdentity: number;
  };
  recentAttributedTouches: AttributionTouch[];
  recentUnattributedOrders: Array<{
    orderId: string;
    totalPriceCents: number;
    createdAt: string | null;
    externalId: string | null;
    customerId: string | null;
    email: string | null;
  }>;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

export async function GET(request: NextRequest) {
  try {
    const shopDomain = request.nextUrl.searchParams.get('shop')?.trim().toLowerCase();
    if (!shopDomain) {
      return NextResponse.json({ ok: false, error: 'Missing shop parameter.' }, { status: 400 });
    }

    const sql = getNeonSql();
    const checkedAt = new Date().toISOString();
    const attributionSettings = await getAttributionSettings(shopDomain);

    const [
      webhookRows,
      ordersRows,
      attributedOrderRows,
      identityRows,
      campaignRevenueRows,
      automationRevenueRows,
      welcomeRevenueRows,
      welcomeTouchRows,
      attributedTouchRows,
      unattributedRows,
    ] = await Promise.all([
      sql`
        SELECT
          COUNT(*) FILTER (WHERE received_at >= NOW() - INTERVAL '7 days')::INT AS events_7d,
          MAX(received_at) AS last_event_at
        FROM webhook_events
        WHERE shop_domain = ${shopDomain}
          AND topic = 'orders/create'
      `,
      sql`
        SELECT
          COUNT(*)::INT AS orders_7d,
          COALESCE(SUM(total_price_cents), 0)::BIGINT AS revenue_cents_7d
        FROM shopify_orders
        WHERE shop_domain = ${shopDomain}
          AND created_at >= NOW() - INTERVAL '7 days'
      `,
      sql`
        WITH orders_7d AS (
          SELECT order_id, total_price_cents
          FROM shopify_orders
          WHERE shop_domain = ${shopDomain}
            AND created_at >= NOW() - INTERVAL '7 days'
        ),
        attributed_order_ids AS (
          SELECT DISTINCT order_id FROM campaign_deliveries WHERE shop_domain = ${shopDomain} AND order_id IS NOT NULL
          UNION
          SELECT DISTINCT order_id FROM campaign_clicks WHERE shop_domain = ${shopDomain} AND order_id IS NOT NULL
          UNION
          SELECT DISTINCT order_id FROM automation_deliveries WHERE shop_domain = ${shopDomain} AND order_id IS NOT NULL
          UNION
          SELECT DISTINCT order_id FROM automation_clicks WHERE shop_domain = ${shopDomain} AND order_id IS NOT NULL
        )
        SELECT
          COUNT(*) FILTER (WHERE a.order_id IS NOT NULL)::INT AS attributed_orders_7d,
          COUNT(*) FILTER (WHERE a.order_id IS NULL)::INT AS unattributed_orders_7d,
          COALESCE(SUM(CASE WHEN a.order_id IS NOT NULL THEN o.total_price_cents ELSE 0 END), 0)::BIGINT AS attributed_revenue_cents_7d
        FROM orders_7d o
        LEFT JOIN attributed_order_ids a ON a.order_id = o.order_id
      `,
      sql`
        SELECT
          COUNT(*)::INT AS orders_7d,
          COUNT(*) FILTER (WHERE COALESCE(external_id, '') <> '')::INT AS with_external_id,
          COUNT(*) FILTER (WHERE COALESCE(customer_id, '') <> '')::INT AS with_customer_id,
          COUNT(*) FILTER (WHERE COALESCE(email, '') <> '')::INT AS with_email,
          COUNT(*) FILTER (
            WHERE COALESCE(external_id, '') = ''
              AND COALESCE(customer_id, '') = ''
              AND COALESCE(email, '') = ''
          )::INT AS missing_all_identity
        FROM shopify_orders
        WHERE shop_domain = ${shopDomain}
          AND created_at >= NOW() - INTERVAL '7 days'
      `,
      sql`
        SELECT COALESCE(SUM(revenue_cents), 0)::BIGINT AS revenue_cents
        FROM campaigns
        WHERE shop_domain = ${shopDomain}
      `,
      sql`
        SELECT
          COALESCE(SUM(revenue_cents), 0)::BIGINT AS revenue_cents
        FROM (
          SELECT revenue_cents FROM automation_deliveries WHERE shop_domain = ${shopDomain}
          UNION ALL
          SELECT revenue_cents FROM automation_clicks WHERE shop_domain = ${shopDomain}
        ) s
      `,
      sql`
        SELECT
          COUNT(DISTINCT order_id)::INT AS orders_7d,
          COALESCE(SUM(revenue_cents), 0)::BIGINT AS revenue_cents_7d
        FROM (
          SELECT order_id, revenue_cents
          FROM automation_deliveries
          WHERE shop_domain = ${shopDomain}
            AND rule_key = 'welcome_subscriber'
            AND order_id IS NOT NULL
            AND converted_at >= NOW() - INTERVAL '7 days'
          UNION ALL
          SELECT order_id, revenue_cents
          FROM automation_clicks
          WHERE shop_domain = ${shopDomain}
            AND rule_key = 'welcome_subscriber'
            AND order_id IS NOT NULL
            AND converted_at >= NOW() - INTERVAL '7 days'
        ) w
      `,
      sql`
        SELECT
          COUNT(*) FILTER (WHERE delivered_at >= NOW() - INTERVAL '7 days')::INT AS deliveries_7d,
          0::INT AS clicks_7d
        FROM automation_deliveries
        WHERE shop_domain = ${shopDomain}
          AND rule_key = 'welcome_subscriber'
        UNION ALL
        SELECT
          0::INT AS deliveries_7d,
          COUNT(*) FILTER (WHERE clicked_at >= NOW() - INTERVAL '7 days')::INT AS clicks_7d
        FROM automation_clicks
        WHERE shop_domain = ${shopDomain}
          AND rule_key = 'welcome_subscriber'
      `,
      sql`
        SELECT *
        FROM (
          SELECT
            'campaign_click'::TEXT AS source_type,
            campaign_id AS source_id,
            order_id,
            revenue_cents,
            converted_at AS occurred_at
          FROM campaign_clicks
          WHERE shop_domain = ${shopDomain}
            AND order_id IS NOT NULL
          UNION ALL
          SELECT
            'campaign_impression'::TEXT AS source_type,
            campaign_id AS source_id,
            order_id,
            revenue_cents,
            converted_at AS occurred_at
          FROM campaign_deliveries
          WHERE shop_domain = ${shopDomain}
            AND order_id IS NOT NULL
          UNION ALL
          SELECT
            'automation_click'::TEXT AS source_type,
            rule_key AS source_id,
            order_id,
            revenue_cents,
            converted_at AS occurred_at
          FROM automation_clicks
          WHERE shop_domain = ${shopDomain}
            AND order_id IS NOT NULL
          UNION ALL
          SELECT
            'automation_impression'::TEXT AS source_type,
            rule_key AS source_id,
            order_id,
            revenue_cents,
            converted_at AS occurred_at
          FROM automation_deliveries
          WHERE shop_domain = ${shopDomain}
            AND order_id IS NOT NULL
        ) touches
        ORDER BY occurred_at DESC NULLS LAST
        LIMIT 40
      `,
      sql`
        WITH orders_7d AS (
          SELECT order_id, total_price_cents, created_at, external_id, customer_id, email
          FROM shopify_orders
          WHERE shop_domain = ${shopDomain}
            AND created_at >= NOW() - INTERVAL '7 days'
        ),
        attributed_order_ids AS (
          SELECT DISTINCT order_id FROM campaign_deliveries WHERE shop_domain = ${shopDomain} AND order_id IS NOT NULL
          UNION
          SELECT DISTINCT order_id FROM campaign_clicks WHERE shop_domain = ${shopDomain} AND order_id IS NOT NULL
          UNION
          SELECT DISTINCT order_id FROM automation_deliveries WHERE shop_domain = ${shopDomain} AND order_id IS NOT NULL
          UNION
          SELECT DISTINCT order_id FROM automation_clicks WHERE shop_domain = ${shopDomain} AND order_id IS NOT NULL
        )
        SELECT o.order_id, o.total_price_cents, o.created_at, o.external_id, o.customer_id, o.email
        FROM orders_7d o
        LEFT JOIN attributed_order_ids a ON a.order_id = o.order_id
        WHERE a.order_id IS NULL
        ORDER BY o.created_at DESC
        LIMIT 20
      `,
    ]);

    const orders7d = Number(ordersRows[0]?.orders_7d ?? 0);
    const totalRevenueCents7d = Number(ordersRows[0]?.revenue_cents_7d ?? 0);
    const attributedOrders7d = Number(attributedOrderRows[0]?.attributed_orders_7d ?? 0);
    const unattributedOrders7d = Number(attributedOrderRows[0]?.unattributed_orders_7d ?? 0);
    const attributedRevenueCents7d = Number(attributedOrderRows[0]?.attributed_revenue_cents_7d ?? 0);

    const withExternalId = Number(identityRows[0]?.with_external_id ?? 0);
    const withCustomerId = Number(identityRows[0]?.with_customer_id ?? 0);
    const withEmail = Number(identityRows[0]?.with_email ?? 0);
    const missingAllIdentity = Number(identityRows[0]?.missing_all_identity ?? 0);

    const welcomeAttributedOrders7d = Number(welcomeRevenueRows[0]?.orders_7d ?? 0);
    const welcomeAttributedRevenueCents7d = Number(welcomeRevenueRows[0]?.revenue_cents_7d ?? 0);

    const welcomeTouches7d = {
      deliveries: Number(welcomeTouchRows[0]?.deliveries_7d ?? 0) + Number(welcomeTouchRows[1]?.deliveries_7d ?? 0),
      clicks: Number(welcomeTouchRows[0]?.clicks_7d ?? 0) + Number(welcomeTouchRows[1]?.clicks_7d ?? 0),
    };

    const recentAttributedTouches = (attributedTouchRows as Array<Record<string, unknown>>).map((row) => ({
      sourceType: String(row.source_type) as AttributionTouch['sourceType'],
      sourceId: String(row.source_id ?? ''),
      orderId: String(row.order_id ?? ''),
      revenueCents: Number(row.revenue_cents ?? 0),
      occurredAt: row.occurred_at ? new Date(String(row.occurred_at)).toISOString() : null,
    }));

    const recentUnattributedOrders = (unattributedRows as Array<Record<string, unknown>>).map((row) => ({
      orderId: String(row.order_id ?? ''),
      totalPriceCents: Number(row.total_price_cents ?? 0),
      createdAt: row.created_at ? new Date(String(row.created_at)).toISOString() : null,
      externalId: row.external_id ? String(row.external_id) : null,
      customerId: row.customer_id ? String(row.customer_id) : null,
      email: row.email ? String(row.email) : null,
    }));

    const attributionSummary: DiagnosticResult['attributionSummary'] = {
      orders7d,
      totalRevenueCents7d,
      attributedOrders7d,
      unattributedOrders7d,
      attributedRevenueCents7d,
      attributedRevenueRatePercent: totalRevenueCents7d > 0 ? round2((attributedRevenueCents7d / totalRevenueCents7d) * 100) : 0,
      campaignAttributedRevenueCents7d: Number(campaignRevenueRows[0]?.revenue_cents ?? 0),
      automationAttributedRevenueCents7d: Number(automationRevenueRows[0]?.revenue_cents ?? 0),
      welcomeAttributedOrders7d,
      welcomeAttributedRevenueCents7d,
      welcomeTouches7d,
    };

    const webhookHealth = {
      ordersCreateEvents7d: Number(webhookRows[0]?.events_7d ?? 0),
      lastOrdersCreateEventAt: webhookRows[0]?.last_event_at ? new Date(String(webhookRows[0].last_event_at)).toISOString() : null,
    };

    const identityCoverage = {
      orders7d,
      withExternalId,
      withCustomerId,
      withEmail,
      missingAllIdentity,
    };

    const issues: DiagnosticIssue[] = [];

    if (webhookHealth.ordersCreateEvents7d === 0) {
      issues.push({
        severity: 'error',
        component: 'AttributionWebhook',
        title: 'No orders/create webhook events seen in the last 7 days',
        description: 'Attribution cannot run without order ingestion. Verify Shopify webhook delivery and endpoint configuration.',
        details: webhookHealth,
      });
    } else {
      issues.push({
        severity: 'info',
        component: 'AttributionWebhook',
        title: 'orders/create webhook events are being ingested',
        description: 'Order webhook ingestion is active.',
        details: webhookHealth,
      });
    }

    if (orders7d > 0 && attributedOrders7d === 0) {
      issues.push({
        severity: 'warning',
        component: 'RevenueAttribution',
        title: 'Orders exist but none are attributed in the last 7 days',
        description: 'Identity linkage or attribution windows may be too strict for current traffic.',
        details: attributionSummary,
      });
    }

    if (unattributedOrders7d > 0) {
      issues.push({
        severity: 'warning',
        component: 'RevenueAttribution',
        title: 'Some recent orders are not attributed',
        description: 'Orders were captured but no qualifying campaign or automation touch was found in the configured window.',
        details: {
          unattributedOrders7d,
          orders7d,
          attributionModel: attributionSettings.attributionModel,
          clickWindowDays: attributionSettings.clickWindowDays,
          impressionWindowDays: attributionSettings.impressionWindowDays,
          sampleUnattributedOrders: recentUnattributedOrders.slice(0, 5),
        },
      });
    }

    if (missingAllIdentity > 0) {
      issues.push({
        severity: 'warning',
        component: 'IdentityResolution',
        title: 'Some orders have no externalId, customerId, or email',
        description: 'Orders without identity keys cannot be reliably linked to subscribers for attribution.',
        details: identityCoverage,
      });
    }

    if (attributionSettings.clickWindowDays !== 7 || attributionSettings.impressionWindowDays !== 7) {
      issues.push({
        severity: 'info',
        component: 'AttributionSettings',
        title: 'Attribution windows differ from the 7-day recommendation',
        description: 'Your current settings are valid, but this diagnostics profile is tuned around a 7-day attribution cap.',
        details: attributionSettings,
      });
    }

    if (welcomeTouches7d.deliveries > 0 && welcomeAttributedRevenueCents7d === 0) {
      issues.push({
        severity: 'info',
        component: 'WelcomeAttribution',
        title: 'Welcome touches recorded but no welcome-attributed revenue yet',
        description: 'Welcome notifications are being delivered/clicked, but no order matched attribution conditions yet.',
        details: {
          welcomeTouches7d,
          welcomeAttributedOrders7d,
          welcomeAttributedRevenueCents7d,
        },
      });
    }

    return NextResponse.json({
      ok: issues.every((issue) => issue.severity !== 'error'),
      checkedAt,
      shopDomain,
      issues,
      attributionSettings,
      attributionSummary,
      webhookHealth,
      identityCoverage,
      recentAttributedTouches,
      recentUnattributedOrders,
    } satisfies DiagnosticResult);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        checkedAt: new Date().toISOString(),
        shopDomain: 'unknown',
        issues: [
          {
            severity: 'error',
            component: 'Diagnostic',
            title: 'Diagnostic error',
            description: error instanceof Error ? error.message : 'Failed to run diagnostics.',
          },
        ],
        attributionSettings: {
          attributionModel: 'impression',
          attributionCreditMode: 'last_touch',
          clickWindowDays: 7,
          impressionWindowDays: 7,
        },
        attributionSummary: {
          orders7d: 0,
          totalRevenueCents7d: 0,
          attributedOrders7d: 0,
          unattributedOrders7d: 0,
          attributedRevenueCents7d: 0,
          attributedRevenueRatePercent: 0,
          campaignAttributedRevenueCents7d: 0,
          automationAttributedRevenueCents7d: 0,
          welcomeAttributedOrders7d: 0,
          welcomeAttributedRevenueCents7d: 0,
          welcomeTouches7d: {
            deliveries: 0,
            clicks: 0,
          },
        },
        webhookHealth: {
          ordersCreateEvents7d: 0,
          lastOrdersCreateEventAt: null,
        },
        identityCoverage: {
          orders7d: 0,
          withExternalId: 0,
          withCustomerId: 0,
          withEmail: 0,
          missingAllIdentity: 0,
        },
        recentAttributedTouches: [],
        recentUnattributedOrders: [],
      } satisfies DiagnosticResult,
      { status: 500 },
    );
  }
}
