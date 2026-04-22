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
  ingestionHealth: {
    pendingJobs: number;
    processingJobs: number;
    failedJobs: number;
    processedJobs7d: number;
    lastProcessedAt: string | null;
    lastFailedAt: string | null;
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
  recentFailedIngestionJobs: Array<{
    id: string;
    jobType: string;
    attempts: number;
    errorMessage: string | null;
    updatedAt: string | null;
  }>;
  welcomeTouchIdentityDebug: {
    recentClickExternalIds: string[];
    recentDeliveryExternalIds: string[];
  };
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
      ingestionRows,
      failedIngestionRows,
      ordersRows,
      attributedOrderRows,
      identityRows,
      campaignRevenueRows,
      automationRevenueRows,
      welcomeRevenueRows,
      welcomeTouchRows,
      welcomeExternalRows,
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
          COUNT(*) FILTER (WHERE status = 'pending')::INT AS pending_jobs,
          COUNT(*) FILTER (WHERE status = 'processing')::INT AS processing_jobs,
          COUNT(*) FILTER (WHERE status = 'failed')::INT AS failed_jobs,
          COUNT(*) FILTER (WHERE status = 'processed' AND processed_at >= NOW() - INTERVAL '7 days')::INT AS processed_jobs_7d,
          MAX(processed_at) AS last_processed_at,
          MAX(updated_at) FILTER (WHERE status = 'failed') AS last_failed_at
        FROM ingestion_jobs
        WHERE shop_domain = ${shopDomain}
          AND job_type = 'shopify_order_create'
      `,
      sql`
        SELECT id, job_type, attempts, error_message, updated_at
        FROM ingestion_jobs
        WHERE shop_domain = ${shopDomain}
          AND job_type = 'shopify_order_create'
          AND status = 'failed'
        ORDER BY updated_at DESC
        LIMIT 20
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
        SELECT source, external_id
        FROM (
          SELECT 'click'::TEXT AS source, external_id, clicked_at AS occurred_at
          FROM automation_clicks
          WHERE shop_domain = ${shopDomain}
            AND rule_key = 'welcome_subscriber'
            AND external_id IS NOT NULL
          UNION ALL
          SELECT 'delivery'::TEXT AS source, external_id, delivered_at AS occurred_at
          FROM automation_deliveries
          WHERE shop_domain = ${shopDomain}
            AND rule_key = 'welcome_subscriber'
            AND external_id IS NOT NULL
        ) w
        WHERE occurred_at >= NOW() - INTERVAL '7 days'
        ORDER BY occurred_at DESC
        LIMIT 80
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

    const webhookHealth = {
      ordersCreateEvents7d: Number(webhookRows[0]?.events_7d ?? 0),
      lastOrdersCreateEventAt: webhookRows[0]?.last_event_at ? new Date(String(webhookRows[0].last_event_at)).toISOString() : null,
    };

    const ingestionHealth: DiagnosticResult['ingestionHealth'] = {
      pendingJobs: Number(ingestionRows[0]?.pending_jobs ?? 0),
      processingJobs: Number(ingestionRows[0]?.processing_jobs ?? 0),
      failedJobs: Number(ingestionRows[0]?.failed_jobs ?? 0),
      processedJobs7d: Number(ingestionRows[0]?.processed_jobs_7d ?? 0),
      lastProcessedAt: ingestionRows[0]?.last_processed_at ? new Date(String(ingestionRows[0].last_processed_at)).toISOString() : null,
      lastFailedAt: ingestionRows[0]?.last_failed_at ? new Date(String(ingestionRows[0].last_failed_at)).toISOString() : null,
    };

    const identityCoverage = {
      orders7d,
      withExternalId,
      withCustomerId,
      withEmail,
      missingAllIdentity,
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

    const recentFailedIngestionJobs = (failedIngestionRows as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id ?? ''),
      jobType: String(row.job_type ?? ''),
      attempts: Number(row.attempts ?? 0),
      errorMessage: row.error_message ? String(row.error_message) : null,
      updatedAt: row.updated_at ? new Date(String(row.updated_at)).toISOString() : null,
    }));

    const welcomeTouchIdentityDebug: DiagnosticResult['welcomeTouchIdentityDebug'] = {
      recentClickExternalIds: Array.from(
        new Set(
          (welcomeExternalRows as Array<Record<string, unknown>>)
            .filter((row) => String(row.source ?? '') === 'click')
            .map((row) => String(row.external_id ?? ''))
            .filter(Boolean),
        ),
      ).slice(0, 20),
      recentDeliveryExternalIds: Array.from(
        new Set(
          (welcomeExternalRows as Array<Record<string, unknown>>)
            .filter((row) => String(row.source ?? '') === 'delivery')
            .map((row) => String(row.external_id ?? ''))
            .filter(Boolean),
        ),
      ).slice(0, 20),
    };

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

    if (ingestionHealth.failedJobs > 0) {
      issues.push({
        severity: 'error',
        component: 'AttributionIngestion',
        title: 'Order ingestion jobs failed',
        description: 'One or more shopify_order_create ingestion jobs are failing, so revenue attribution cannot complete for those orders.',
        details: {
          ingestionHealth,
          recentFailedIngestionJobs: recentFailedIngestionJobs.slice(0, 5),
        },
      });
    } else if (ingestionHealth.pendingJobs > 0 || ingestionHealth.processingJobs > 0) {
      issues.push({
        severity: 'warning',
        component: 'AttributionIngestion',
        title: 'Order ingestion jobs are queued',
        description: 'Some order ingestion jobs are pending or processing; attribution metrics may lag until jobs complete.',
        details: ingestionHealth,
      });
    } else {
      issues.push({
        severity: 'info',
        component: 'AttributionIngestion',
        title: 'Order ingestion queue is healthy',
        description: 'No failed or stuck shopify_order_create ingestion jobs were detected.',
        details: ingestionHealth,
      });
    }

    if (webhookHealth.ordersCreateEvents7d > 0 && orders7d === 0) {
      issues.push({
        severity: 'warning',
        component: 'RevenueAttribution',
        title: 'Order webhooks exist but no orders are stored in attribution tables',
        description: 'Webhook events were received, but shopify_orders has no 7-day records. This usually indicates ingestion lag/failure or payload date mismatch.',
        details: {
          webhookHealth,
          ingestionHealth,
        },
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
          welcomeTouchIdentityDebug,
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
      ingestionHealth,
      identityCoverage,
      recentAttributedTouches,
      recentUnattributedOrders,
      recentFailedIngestionJobs,
      welcomeTouchIdentityDebug,
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
        ingestionHealth: {
          pendingJobs: 0,
          processingJobs: 0,
          failedJobs: 0,
          processedJobs7d: 0,
          lastProcessedAt: null,
          lastFailedAt: null,
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
        recentFailedIngestionJobs: [],
        welcomeTouchIdentityDebug: {
          recentClickExternalIds: [],
          recentDeliveryExternalIds: [],
        },
      } satisfies DiagnosticResult,
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { shop?: string; action?: string };
    const shopDomain = String(body.shop ?? '').trim().toLowerCase() || request.nextUrl.searchParams.get('shop')?.trim().toLowerCase();
    if (!shopDomain) {
      return NextResponse.json({ ok: false, error: 'Missing shop parameter.' }, { status: 400 });
    }

    if (body.action !== 'clear_attribution_test_data') {
      return NextResponse.json({ ok: false, error: 'Unsupported action.' }, { status: 400 });
    }

    const sql = getNeonSql();

    const [ordersCountRows, ingestionCountRows, webhookCountRows] = await Promise.all([
      sql`SELECT COUNT(*)::INT AS count FROM shopify_orders WHERE shop_domain = ${shopDomain}`,
      sql`SELECT COUNT(*)::INT AS count FROM ingestion_jobs WHERE shop_domain = ${shopDomain} AND job_type = 'shopify_order_create'`,
      sql`SELECT COUNT(*)::INT AS count FROM webhook_events WHERE shop_domain = ${shopDomain} AND topic = 'orders/create'`,
    ]);

    await sql`DELETE FROM shopify_order_items WHERE shop_domain = ${shopDomain}`;
    await sql`DELETE FROM shopify_orders WHERE shop_domain = ${shopDomain}`;
    await sql`DELETE FROM ingestion_jobs WHERE shop_domain = ${shopDomain} AND job_type = 'shopify_order_create'`;
    await sql`DELETE FROM webhook_events WHERE shop_domain = ${shopDomain} AND topic = 'orders/create'`;

    await sql`
      UPDATE campaign_deliveries
      SET converted_at = NULL, order_id = NULL, revenue_cents = 0
      WHERE shop_domain = ${shopDomain}
    `;
    await sql`
      UPDATE campaign_clicks
      SET converted_at = NULL, order_id = NULL, revenue_cents = 0
      WHERE shop_domain = ${shopDomain}
    `;
    await sql`
      UPDATE automation_deliveries
      SET converted_at = NULL, order_id = NULL, revenue_cents = 0
      WHERE shop_domain = ${shopDomain}
    `;
    await sql`
      UPDATE automation_clicks
      SET converted_at = NULL, order_id = NULL, revenue_cents = 0
      WHERE shop_domain = ${shopDomain}
    `;
    await sql`
      UPDATE campaigns
      SET revenue_cents = 0
      WHERE shop_domain = ${shopDomain}
    `;

    return NextResponse.json({
      ok: true,
      shopDomain,
      cleared: {
        orders: Number(ordersCountRows[0]?.count ?? 0),
        ingestionJobs: Number(ingestionCountRows[0]?.count ?? 0),
        webhookEvents: Number(webhookCountRows[0]?.count ?? 0),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to clear attribution test data.',
      },
      { status: 500 },
    );
  }
}
