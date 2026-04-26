import { NextRequest, NextResponse } from 'next/server';

import { getNeonSql } from '@/lib/integrations/database/neon';
import { getAttributionSettings, getWelcomeAutomationDiagnostics } from '@/lib/server/data/store';

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
  automationQueueHealth?: {
    pendingJobs: number;
    processingJobs: number;
    failedJobs: number;
    dueNowJobs: number;
    overdueBy5Minutes: number;
    oldestDueAt: string | null;
    oldestDueAgeMinutes: number | null;
    welcomePendingJobs: number;
    welcomeDueNowJobs: number;
  };
  cronHealth?: {
    processAutomations: {
      lastRunAt: string | null;
      lastOkAt: string | null;
      lastErrorAt: string | null;
      minutesSinceLastRun: number | null;
      errorsLastHour: number;
    };
    processIngestion: {
      lastRunAt: string | null;
      lastOkAt: string | null;
      lastErrorAt: string | null;
      minutesSinceLastRun: number | null;
      errorsLastHour: number;
    };
    processCampaigns: {
      lastRunAt: string | null;
      lastOkAt: string | null;
      lastErrorAt: string | null;
      minutesSinceLastRun: number | null;
      errorsLastHour: number;
    };
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
  recentPendingIngestionJobs: Array<{
    id: string;
    jobType: string;
    attempts: number;
    errorMessage: string | null;
    dueAt: string | null;
    updatedAt: string | null;
  }>;
  welcomeTouchIdentityDebug: {
    recentClickExternalIds: string[];
    recentDeliveryExternalIds: string[];
  };
  impressionCoverageDebug?: {
    welcomeDeliveries7d: number;
    welcomeDeliveriesWithExternalId7d: number;
    welcomeDeliveriesWithUserAgent7d: number;
    welcomeDeliveriesMissingExternalId7d: number;
    welcomeDeliveriesMissingUserAgent7d: number;
    welcomeClicksWithIpAndUserAgent7d: number;
  };
  orderIdentityNamespaceDebug?: {
    cartNamespaceOrders7d: number;
    customerNamespaceOrders7d: number;
    emailNamespaceOrders7d: number;
    anonNamespaceOrders7d: number;
    otherNamespaceOrders7d: number;
  };
  welcomeReminderDiagnostics?: {
    checkedAt: string;
    summary: {
      reminder2: {
        pending: number;
        dueNow: number;
        sent: number;
        failed: number;
        skipped: number;
        processing: number;
        delivered: number;
        lastDeliveredAt: string | null;
      };
      reminder3: {
        pending: number;
        dueNow: number;
        sent: number;
        failed: number;
        skipped: number;
        processing: number;
        delivered: number;
        lastDeliveredAt: string | null;
      };
      staleProcessing: number;
    };
    stepConfig: {
      reminder2: {
        enabled: boolean;
        delayMinutes: number;
      };
      reminder3: {
        enabled: boolean;
        delayMinutes: number;
      };
    };
    sendLagDiagnostics: {
      reminder2: {
        sampleCount: number;
        averageLagMinutes: number | null;
        maxLagMinutes: number | null;
      };
      reminder3: {
        sampleCount: number;
        averageLagMinutes: number | null;
        maxLagMinutes: number | null;
      };
    };
    inferredIssues: string[];
  };
  pendingJobDebug?: Array<{
    jobId: string;
    orderData: {
      orderId: string | null;
      externalId: string | null;
      customerId: string | null;
      email: string | null;
      browserIp: string | null;
      userAgent: string | null;
      cartToken: string | null;
      clientId: string | null;
    };
  }>;
  automationClicksDebug?: Array<{
    clickId: string;
    externalId: string;
    ipAddress: string;
    userAgent: string;
    clickedAt: string | null;
  }>;
  automationDeliveriesDebug?: Array<{
    deliveryId: string;
    externalId: string;
    userAgent: string;
    deliveredAt: string | null;
    convertedAt: string | null;
    orderId: string | null;
  }>;
  unattributedOrderBridgeDebug?: Array<{
    orderId: string;
    externalId: string | null;
    derivedCartToken: string | null;
    sameExternalClickMatches: number;
    sameExternalDeliveryMatches: number;
    cartActivityMatches: number;
    historicalCustomerExternalMatches: number;
  }>;
  unattributedOrdersDebug?: Array<{
    orderId: string;
    externalId: string;
    customerId: string;
    email: string;
    createdAt: string | null;
    totalPriceCents: number;
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
    const welcomeReminderDiagnosticsRaw = await getWelcomeAutomationDiagnostics(shopDomain);

    const [
      webhookRows,
      ingestionRows,
      failedIngestionRows,
      pendingIngestionRows,
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
      pendingJobPayloadsRows,
      automationClicksFingerprintRows,
      automationDeliveriesFingerprintRows,
      unattributedOrderContextRows,
      automationQueueRows,
      cronHeartbeatRows,
      impressionCoverageRows,
      orderIdentityNamespaceRows,
      unattributedOrderBridgeRows,
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
          COUNT(*) FILTER (WHERE status = 'pending' AND COALESCE(error_message, '') <> '')::INT AS pending_with_error_jobs,
          COUNT(*) FILTER (WHERE status = 'processed' AND processed_at >= NOW() - INTERVAL '7 days')::INT AS processed_jobs_7d,
          MIN(updated_at) FILTER (WHERE status = 'pending') AS oldest_pending_at,
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
        SELECT id, job_type, attempts, error_message, due_at, updated_at
        FROM ingestion_jobs
        WHERE shop_domain = ${shopDomain}
          AND job_type = 'shopify_order_create'
          AND status = 'pending'
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
      sql`
        SELECT id, payload
        FROM ingestion_jobs
        WHERE shop_domain = ${shopDomain}
          AND job_type = 'shopify_order_create'
          AND status = 'pending'
        ORDER BY updated_at DESC
        LIMIT 5
      `,
      sql`
        SELECT id, rule_key, ip_address, user_agent, external_id, clicked_at
        FROM automation_clicks
        WHERE shop_domain = ${shopDomain}
          AND rule_key = 'welcome_subscriber'
          AND clicked_at >= NOW() - INTERVAL '7 days'
        ORDER BY clicked_at DESC
        LIMIT 20
      `,
      sql`
        SELECT id, rule_key, external_id, user_agent, delivered_at, converted_at, order_id
        FROM automation_deliveries
        WHERE shop_domain = ${shopDomain}
          AND rule_key = 'welcome_subscriber'
          AND delivered_at >= NOW() - INTERVAL '7 days'
        ORDER BY delivered_at DESC
        LIMIT 20
      `,
      sql`
        SELECT order_id, external_id, customer_id, email, created_at, total_price_cents
        FROM shopify_orders
        WHERE shop_domain = ${shopDomain}
          AND created_at >= NOW() - INTERVAL '7 days'
        ORDER BY created_at DESC
        LIMIT 5
      `,
      sql`
        SELECT
          COUNT(*) FILTER (WHERE status = 'pending')::INT AS pending_jobs,
          COUNT(*) FILTER (WHERE status = 'processing')::INT AS processing_jobs,
          COUNT(*) FILTER (WHERE status = 'failed')::INT AS failed_jobs,
          COUNT(*) FILTER (WHERE status = 'pending' AND due_at <= NOW())::INT AS due_now_jobs,
          COUNT(*) FILTER (WHERE status = 'pending' AND due_at <= NOW() - INTERVAL '5 minutes')::INT AS overdue_by_5m,
          MIN(due_at) FILTER (WHERE status = 'pending') AS oldest_due_at,
          COUNT(*) FILTER (WHERE rule_key = 'welcome_subscriber' AND status = 'pending')::INT AS welcome_pending_jobs,
          COUNT(*) FILTER (WHERE rule_key = 'welcome_subscriber' AND status = 'pending' AND due_at <= NOW())::INT AS welcome_due_now_jobs
        FROM automation_jobs
        WHERE shop_domain = ${shopDomain}
      `,
      sql`
        SELECT
          job_name,
          MAX(started_at) AS last_run_at,
          MAX(completed_at) FILTER (WHERE status = 'ok') AS last_ok_at,
          MAX(completed_at) FILTER (WHERE status = 'error') AS last_error_at,
          COUNT(*) FILTER (
            WHERE status = 'error'
              AND started_at >= NOW() - INTERVAL '1 hour'
          )::INT AS errors_last_hour
        FROM cron_heartbeats
        WHERE job_name IN ('process_automations', 'process_ingestion', 'process_campaigns')
          AND started_at >= NOW() - INTERVAL '7 days'
        GROUP BY job_name
      `,
      sql`
        SELECT
          COUNT(*)::INT AS welcome_deliveries_7d,
          COUNT(*) FILTER (WHERE COALESCE(external_id, '') <> '')::INT AS with_external_id_7d,
          COUNT(*) FILTER (WHERE COALESCE(user_agent, '') <> '')::INT AS with_user_agent_7d,
          COUNT(*) FILTER (WHERE COALESCE(external_id, '') = '')::INT AS missing_external_id_7d,
          COUNT(*) FILTER (WHERE COALESCE(user_agent, '') = '')::INT AS missing_user_agent_7d,
          (
            SELECT COUNT(*)::INT
            FROM automation_clicks c
            WHERE c.shop_domain = ${shopDomain}
              AND c.rule_key = 'welcome_subscriber'
              AND c.clicked_at >= NOW() - INTERVAL '7 days'
              AND COALESCE(c.ip_address, '') <> ''
              AND COALESCE(c.user_agent, '') <> ''
          ) AS clicks_with_ip_and_user_agent_7d
        FROM automation_deliveries
        WHERE shop_domain = ${shopDomain}
          AND rule_key = 'welcome_subscriber'
          AND delivered_at >= NOW() - INTERVAL '7 days'
      `,
      sql`
        SELECT
          COUNT(*) FILTER (WHERE COALESCE(external_id, '') LIKE 'cart:%')::INT AS cart_namespace_orders_7d,
          COUNT(*) FILTER (WHERE COALESCE(external_id, '') LIKE 'shopify_customer:%')::INT AS customer_namespace_orders_7d,
          COUNT(*) FILTER (WHERE COALESCE(external_id, '') LIKE 'email:%')::INT AS email_namespace_orders_7d,
          COUNT(*) FILTER (WHERE COALESCE(external_id, '') LIKE 'anon:%')::INT AS anon_namespace_orders_7d,
          COUNT(*) FILTER (
            WHERE COALESCE(external_id, '') <> ''
              AND COALESCE(external_id, '') NOT LIKE 'cart:%'
              AND COALESCE(external_id, '') NOT LIKE 'shopify_customer:%'
              AND COALESCE(external_id, '') NOT LIKE 'email:%'
              AND COALESCE(external_id, '') NOT LIKE 'anon:%'
          )::INT AS other_namespace_orders_7d
        FROM shopify_orders
        WHERE shop_domain = ${shopDomain}
          AND created_at >= NOW() - INTERVAL '7 days'
      `,
      sql`
        WITH recent_unattributed_orders AS (
          SELECT o.order_id, o.external_id, o.customer_id, o.email
          FROM shopify_orders o
          LEFT JOIN (
            SELECT DISTINCT order_id FROM campaign_deliveries WHERE shop_domain = ${shopDomain} AND order_id IS NOT NULL
            UNION
            SELECT DISTINCT order_id FROM campaign_clicks WHERE shop_domain = ${shopDomain} AND order_id IS NOT NULL
            UNION
            SELECT DISTINCT order_id FROM automation_deliveries WHERE shop_domain = ${shopDomain} AND order_id IS NOT NULL
            UNION
            SELECT DISTINCT order_id FROM automation_clicks WHERE shop_domain = ${shopDomain} AND order_id IS NOT NULL
          ) a ON a.order_id = o.order_id
          WHERE o.shop_domain = ${shopDomain}
            AND o.created_at >= NOW() - INTERVAL '7 days'
            AND a.order_id IS NULL
          ORDER BY o.created_at DESC
          LIMIT 10
        )
        SELECT
          o.order_id,
          o.external_id,
          CASE
            WHEN COALESCE(o.external_id, '') LIKE 'cart:%' THEN regexp_replace(o.external_id, '^cart:[^:]+:', '')
            ELSE NULL
          END AS derived_cart_token,
          (
            SELECT COUNT(*)::INT
            FROM automation_clicks c
            WHERE c.shop_domain = ${shopDomain}
              AND c.rule_key = 'welcome_subscriber'
              AND c.external_id = o.external_id
          ) AS same_external_click_matches,
          (
            SELECT COUNT(*)::INT
            FROM automation_deliveries d
            WHERE d.shop_domain = ${shopDomain}
              AND d.rule_key = 'welcome_subscriber'
              AND d.external_id = o.external_id
          ) AS same_external_delivery_matches,
          (
            SELECT COUNT(*)::INT
            FROM subscriber_activity_events e
            WHERE e.shop_domain = ${shopDomain}
              AND CASE
                WHEN COALESCE(o.external_id, '') LIKE 'cart:%' THEN e.cart_token = regexp_replace(o.external_id, '^cart:[^:]+:', '')
                ELSE FALSE
              END
          ) AS cart_activity_matches,
          (
            SELECT COUNT(*)::INT
            FROM shopify_orders historical
            WHERE historical.shop_domain = ${shopDomain}
              AND historical.order_id <> o.order_id
              AND COALESCE(historical.external_id, '') <> ''
              AND (
                (COALESCE(o.customer_id, '') <> '' AND historical.customer_id = o.customer_id)
                OR (COALESCE(o.email, '') <> '' AND LOWER(COALESCE(historical.email, '')) = LOWER(o.email))
              )
          ) AS historical_customer_external_matches
        FROM recent_unattributed_orders o
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

    const pendingWithErrorJobs = Number(ingestionRows[0]?.pending_with_error_jobs ?? 0);
    const oldestPendingAt = ingestionRows[0]?.oldest_pending_at ? new Date(String(ingestionRows[0].oldest_pending_at)) : null;
    const oldestPendingAgeMinutes = oldestPendingAt
      ? Math.max(0, Math.floor((Date.now() - oldestPendingAt.getTime()) / 60000))
      : null;

    const identityCoverage = {
      orders7d,
      withExternalId,
      withCustomerId,
      withEmail,
      missingAllIdentity,
    };

    const automationQueueHealth: DiagnosticResult['automationQueueHealth'] = {
      pendingJobs: Number(automationQueueRows[0]?.pending_jobs ?? 0),
      processingJobs: Number(automationQueueRows[0]?.processing_jobs ?? 0),
      failedJobs: Number(automationQueueRows[0]?.failed_jobs ?? 0),
      dueNowJobs: Number(automationQueueRows[0]?.due_now_jobs ?? 0),
      overdueBy5Minutes: Number(automationQueueRows[0]?.overdue_by_5m ?? 0),
      oldestDueAt: automationQueueRows[0]?.oldest_due_at ? new Date(String(automationQueueRows[0].oldest_due_at)).toISOString() : null,
      oldestDueAgeMinutes: automationQueueRows[0]?.oldest_due_at
        ? Math.max(0, Math.floor((Date.now() - new Date(String(automationQueueRows[0].oldest_due_at)).getTime()) / 60000))
        : null,
      welcomePendingJobs: Number(automationQueueRows[0]?.welcome_pending_jobs ?? 0),
      welcomeDueNowJobs: Number(automationQueueRows[0]?.welcome_due_now_jobs ?? 0),
    };

    const heartbeatByJob = new Map(
      (cronHeartbeatRows as Array<Record<string, unknown>>).map((row) => [
        String(row.job_name ?? ''),
        {
          lastRunAt: row.last_run_at ? new Date(String(row.last_run_at)).toISOString() : null,
          lastOkAt: row.last_ok_at ? new Date(String(row.last_ok_at)).toISOString() : null,
          lastErrorAt: row.last_error_at ? new Date(String(row.last_error_at)).toISOString() : null,
          errorsLastHour: Number(row.errors_last_hour ?? 0),
        },
      ]),
    );

    const toHealth = (jobName: string) => {
      const raw = heartbeatByJob.get(jobName) ?? {
        lastRunAt: null,
        lastOkAt: null,
        lastErrorAt: null,
        errorsLastHour: 0,
      };
      const minutesSinceLastRun = raw.lastRunAt
        ? Math.max(0, Math.floor((Date.now() - new Date(raw.lastRunAt).getTime()) / 60000))
        : null;
      return {
        ...raw,
        minutesSinceLastRun,
      };
    };

    const cronHealth: DiagnosticResult['cronHealth'] = {
      processAutomations: toHealth('process_automations'),
      processIngestion: toHealth('process_ingestion'),
      processCampaigns: toHealth('process_campaigns'),
    };

    const impressionCoverageDebug: DiagnosticResult['impressionCoverageDebug'] = {
      welcomeDeliveries7d: Number(impressionCoverageRows[0]?.welcome_deliveries_7d ?? 0),
      welcomeDeliveriesWithExternalId7d: Number(impressionCoverageRows[0]?.with_external_id_7d ?? 0),
      welcomeDeliveriesWithUserAgent7d: Number(impressionCoverageRows[0]?.with_user_agent_7d ?? 0),
      welcomeDeliveriesMissingExternalId7d: Number(impressionCoverageRows[0]?.missing_external_id_7d ?? 0),
      welcomeDeliveriesMissingUserAgent7d: Number(impressionCoverageRows[0]?.missing_user_agent_7d ?? 0),
      welcomeClicksWithIpAndUserAgent7d: Number(impressionCoverageRows[0]?.clicks_with_ip_and_user_agent_7d ?? 0),
    };

    const orderIdentityNamespaceDebug: DiagnosticResult['orderIdentityNamespaceDebug'] = {
      cartNamespaceOrders7d: Number(orderIdentityNamespaceRows[0]?.cart_namespace_orders_7d ?? 0),
      customerNamespaceOrders7d: Number(orderIdentityNamespaceRows[0]?.customer_namespace_orders_7d ?? 0),
      emailNamespaceOrders7d: Number(orderIdentityNamespaceRows[0]?.email_namespace_orders_7d ?? 0),
      anonNamespaceOrders7d: Number(orderIdentityNamespaceRows[0]?.anon_namespace_orders_7d ?? 0),
      otherNamespaceOrders7d: Number(orderIdentityNamespaceRows[0]?.other_namespace_orders_7d ?? 0),
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

    const recentPendingIngestionJobs = (pendingIngestionRows as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id ?? ''),
      jobType: String(row.job_type ?? ''),
      attempts: Number(row.attempts ?? 0),
      errorMessage: row.error_message ? String(row.error_message) : null,
      dueAt: row.due_at ? new Date(String(row.due_at)).toISOString() : null,
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

    // Deep diagnostics: analyze pending job payloads and fingerprint matching
    const pendingJobDebug = (pendingJobPayloadsRows as Array<Record<string, unknown>>).map((row) => {
      const payload = row.payload as Record<string, unknown> | null;
      return {
        jobId: String(row.id ?? ''),
        orderData: {
          orderId: payload?.orderId ? String(payload.orderId) : null,
          externalId: payload?.externalId ? String(payload.externalId) : null,
          customerId: payload?.customerId ? String(payload.customerId) : null,
          email: payload?.email ? String(payload.email) : null,
          browserIp: payload?.browserIp ? String(payload.browserIp) : null,
          userAgent: payload?.userAgent ? String(payload.userAgent) : null,
          cartToken: payload?.cartToken ? String(payload.cartToken) : null,
          clientId: payload?.clientId ? String(payload.clientId) : null,
        },
      };
    });

    const automationClicksDebug = (automationClicksFingerprintRows as Array<Record<string, unknown>>).map((row) => ({
      clickId: String(row.id ?? ''),
      externalId: String(row.external_id ?? ''),
      ipAddress: String(row.ip_address ?? ''),
      userAgent: String(row.user_agent ?? ''),
      clickedAt: row.clicked_at ? new Date(String(row.clicked_at)).toISOString() : null,
    }));

    const automationDeliveriesDebug = (automationDeliveriesFingerprintRows as Array<Record<string, unknown>>).map((row) => ({
      deliveryId: String(row.id ?? ''),
      externalId: String(row.external_id ?? ''),
      userAgent: String(row.user_agent ?? ''),
      deliveredAt: row.delivered_at ? new Date(String(row.delivered_at)).toISOString() : null,
      convertedAt: row.converted_at ? new Date(String(row.converted_at)).toISOString() : null,
      orderId: row.order_id ? String(row.order_id) : null,
    }));

    const unattributedOrderBridgeDebug = (unattributedOrderBridgeRows as Array<Record<string, unknown>>).map((row) => ({
      orderId: String(row.order_id ?? ''),
      externalId: row.external_id ? String(row.external_id) : null,
      derivedCartToken: row.derived_cart_token ? String(row.derived_cart_token) : null,
      sameExternalClickMatches: Number(row.same_external_click_matches ?? 0),
      sameExternalDeliveryMatches: Number(row.same_external_delivery_matches ?? 0),
      cartActivityMatches: Number(row.cart_activity_matches ?? 0),
      historicalCustomerExternalMatches: Number(row.historical_customer_external_matches ?? 0),
    }));

    const unattributedOrdersDebug = (unattributedOrderContextRows as Array<Record<string, unknown>>).map((row) => ({
      orderId: String(row.order_id ?? ''),
      externalId: String(row.external_id ?? ''),
      customerId: String(row.customer_id ?? ''),
      email: String(row.email ?? ''),
      createdAt: row.created_at ? new Date(String(row.created_at)).toISOString() : null,
      totalPriceCents: Number(row.total_price_cents ?? 0),
    }));

    const welcomeReminderDiagnostics: DiagnosticResult['welcomeReminderDiagnostics'] = {
      checkedAt: welcomeReminderDiagnosticsRaw.checkedAt,
      summary: {
        reminder2: {
          pending: Number(welcomeReminderDiagnosticsRaw.summary?.reminder2?.pending ?? 0),
          dueNow: Number(welcomeReminderDiagnosticsRaw.summary?.reminder2?.dueNow ?? 0),
          sent: Number(welcomeReminderDiagnosticsRaw.summary?.reminder2?.sent ?? 0),
          failed: Number(welcomeReminderDiagnosticsRaw.summary?.reminder2?.failed ?? 0),
          skipped: Number(welcomeReminderDiagnosticsRaw.summary?.reminder2?.skipped ?? 0),
          processing: Number(welcomeReminderDiagnosticsRaw.summary?.reminder2?.processing ?? 0),
          delivered: Number(welcomeReminderDiagnosticsRaw.summary?.reminder2?.delivered ?? 0),
          lastDeliveredAt: welcomeReminderDiagnosticsRaw.summary?.reminder2?.lastDeliveredAt ?? null,
        },
        reminder3: {
          pending: Number(welcomeReminderDiagnosticsRaw.summary?.reminder3?.pending ?? 0),
          dueNow: Number(welcomeReminderDiagnosticsRaw.summary?.reminder3?.dueNow ?? 0),
          sent: Number(welcomeReminderDiagnosticsRaw.summary?.reminder3?.sent ?? 0),
          failed: Number(welcomeReminderDiagnosticsRaw.summary?.reminder3?.failed ?? 0),
          skipped: Number(welcomeReminderDiagnosticsRaw.summary?.reminder3?.skipped ?? 0),
          processing: Number(welcomeReminderDiagnosticsRaw.summary?.reminder3?.processing ?? 0),
          delivered: Number(welcomeReminderDiagnosticsRaw.summary?.reminder3?.delivered ?? 0),
          lastDeliveredAt: welcomeReminderDiagnosticsRaw.summary?.reminder3?.lastDeliveredAt ?? null,
        },
        staleProcessing: Number(welcomeReminderDiagnosticsRaw.summary?.staleProcessing ?? 0),
      },
      stepConfig: {
        reminder2: {
          enabled: Boolean(welcomeReminderDiagnosticsRaw.stepConfig?.['reminder-2']?.enabled),
          delayMinutes: Number(welcomeReminderDiagnosticsRaw.stepConfig?.['reminder-2']?.delayMinutes ?? 0),
        },
        reminder3: {
          enabled: Boolean(welcomeReminderDiagnosticsRaw.stepConfig?.['reminder-3']?.enabled),
          delayMinutes: Number(welcomeReminderDiagnosticsRaw.stepConfig?.['reminder-3']?.delayMinutes ?? 0),
        },
      },
      sendLagDiagnostics: {
        reminder2: {
          sampleCount: Number(welcomeReminderDiagnosticsRaw.sendLagDiagnostics?.reminder2?.sampleCount ?? 0),
          averageLagMinutes: welcomeReminderDiagnosticsRaw.sendLagDiagnostics?.reminder2?.averageLagMinutes ?? null,
          maxLagMinutes: welcomeReminderDiagnosticsRaw.sendLagDiagnostics?.reminder2?.maxLagMinutes ?? null,
        },
        reminder3: {
          sampleCount: Number(welcomeReminderDiagnosticsRaw.sendLagDiagnostics?.reminder3?.sampleCount ?? 0),
          averageLagMinutes: welcomeReminderDiagnosticsRaw.sendLagDiagnostics?.reminder3?.averageLagMinutes ?? null,
          maxLagMinutes: welcomeReminderDiagnosticsRaw.sendLagDiagnostics?.reminder3?.maxLagMinutes ?? null,
        },
      },
      inferredIssues: Array.isArray(welcomeReminderDiagnosticsRaw.inferredIssues)
        ? welcomeReminderDiagnosticsRaw.inferredIssues.map((issue: unknown) => String(issue))
        : [],
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

    if ((automationQueueHealth.overdueBy5Minutes ?? 0) > 0) {
      issues.push({
        severity: 'warning',
        component: 'AutomationQueue',
        title: 'Automation jobs are overdue past their due time',
        description: 'Delayed automation jobs are sitting pending after due_at, which points to scheduler cadence, worker drift, or processing backlog.',
        details: automationQueueHealth,
      });
    } else {
      issues.push({
        severity: 'info',
        component: 'AutomationQueue',
        title: 'Automation queue does not show overdue backlog',
        description: 'No pending automation jobs are currently overdue by more than 5 minutes.',
        details: automationQueueHealth,
      });
    }

    if (!cronHealth.processAutomations.lastRunAt) {
      issues.push({
        severity: 'error',
        component: 'AutomationCron',
        title: 'Automation cron has never run',
        description: 'No process_automations heartbeat was found. Configure deployment cron schedules so reminder-2/reminder-3 run without storefront traffic.',
        details: cronHealth.processAutomations,
      });
    } else if ((cronHealth.processAutomations.minutesSinceLastRun ?? 9999) > 3) {
      issues.push({
        severity: 'warning',
        component: 'AutomationCron',
        title: 'Automation cron heartbeat is stale',
        description: 'process_automations has not run recently; delayed reminders may wait for fallback paths.',
        details: cronHealth.processAutomations,
      });
    } else {
      issues.push({
        severity: 'info',
        component: 'AutomationCron',
        title: 'Automation cron heartbeat is recent',
        description: 'process_automations is running within expected cadence.',
        details: cronHealth.processAutomations,
      });
    }

    if ((cronHealth.processAutomations.errorsLastHour ?? 0) > 0 || (cronHealth.processIngestion.errorsLastHour ?? 0) > 0) {
      issues.push({
        severity: 'warning',
        component: 'CronErrors',
        title: 'Recent cron errors detected',
        description: 'One or more cron workers reported errors in the last hour.',
        details: cronHealth,
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
        details: {
          ...ingestionHealth,
          pendingWithErrorJobs,
          oldestPendingAgeMinutes,
          recentPendingIngestionJobs: recentPendingIngestionJobs.slice(0, 5),
        },
      });

      if (pendingWithErrorJobs > 0 || (oldestPendingAgeMinutes !== null && oldestPendingAgeMinutes >= 2)) {
        issues.push({
          severity: 'warning',
          component: 'AttributionIngestion',
          title: 'Pending ingestion jobs look stalled',
          description: 'At least one order ingestion job has been pending long enough to delay attribution and may be retrying after an internal error.',
          details: {
            ...ingestionHealth,
            pendingWithErrorJobs,
            oldestPendingAgeMinutes,
            recentPendingIngestionJobs: recentPendingIngestionJobs.slice(0, 5),
          },
        });
      }
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

      const unattributedHasCustomerNamespace = recentUnattributedOrders.some((order) =>
        String(order.externalId ?? '').startsWith('shopify_customer:'),
      );
      const welcomeHasAnonNamespace =
        welcomeTouchIdentityDebug.recentClickExternalIds.some((externalId) => externalId.startsWith('anon:'))
        || welcomeTouchIdentityDebug.recentDeliveryExternalIds.some((externalId) => externalId.startsWith('anon:'));

      if (unattributedHasCustomerNamespace && welcomeHasAnonNamespace) {
        issues.push({
          severity: 'warning',
          component: 'IdentityResolution',
          title: 'Core mismatch detected: order identity and welcome touch identity use different namespaces',
          description: 'Recent unattributed orders are customer-based while welcome touches are anonymous, so attribution depends on alias stitching or browser-level matching.',
          details: {
            sampleUnattributedOrders: recentUnattributedOrders.slice(0, 5),
            welcomeTouchIdentityDebug,
          },
        });
      }
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

    if ((impressionCoverageDebug.welcomeDeliveriesMissingUserAgent7d ?? 0) > 0) {
      issues.push({
        severity: 'warning',
        component: 'ImpressionCoverage',
        title: 'Some welcome deliveries are missing delivery fingerprint data',
        description: 'Impression fallback is weaker when delivery rows do not carry user agent data.',
        details: impressionCoverageDebug,
      });
    } else {
      issues.push({
        severity: 'info',
        component: 'ImpressionCoverage',
        title: 'Delivery fingerprint coverage is present for recent welcome deliveries',
        description: 'Recent welcome deliveries include the fingerprint fields needed for stronger impression fallback.',
        details: impressionCoverageDebug,
      });
    }

    if ((orderIdentityNamespaceDebug.cartNamespaceOrders7d ?? 0) > 0 && welcomeTouchIdentityDebug.recentDeliveryExternalIds.some((externalId) => externalId.startsWith('anon:'))) {
      issues.push({
        severity: 'warning',
        component: 'IdentityResolution',
        title: 'Recent orders are still landing in cart namespace while welcome touches stay anonymous',
        description: 'Cart-token to subscriber stitching is likely still a major attribution boundary for impression credit.',
        details: {
          orderIdentityNamespaceDebug,
          unattributedOrderBridgeDebug: unattributedOrderBridgeDebug.slice(0, 5),
        },
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

    if ((welcomeReminderDiagnostics.inferredIssues ?? []).length > 0) {
      issues.push({
        severity: 'warning',
        component: 'WelcomeReminders',
        title: 'Welcome delayed reminder diagnostics found timing issues',
        description: 'Reminder queue, lag, or rule configuration indicates delayed reminder delivery behavior.',
        details: welcomeReminderDiagnostics,
      });
    } else {
      issues.push({
        severity: 'info',
        component: 'WelcomeReminders',
        title: 'Welcome delayed reminder diagnostics look healthy',
        description: 'No queue/lag issue was inferred for reminder-2 and reminder-3 from recent jobs.',
        details: welcomeReminderDiagnostics,
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
      automationQueueHealth,
      cronHealth,
      identityCoverage,
      impressionCoverageDebug,
      orderIdentityNamespaceDebug,
      recentAttributedTouches,
      recentUnattributedOrders,
      recentFailedIngestionJobs,
      recentPendingIngestionJobs,
      welcomeTouchIdentityDebug,
      welcomeReminderDiagnostics,
      pendingJobDebug,
      automationClicksDebug,
      automationDeliveriesDebug,
      unattributedOrderBridgeDebug,
      unattributedOrdersDebug,
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
        recentPendingIngestionJobs: [],
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
