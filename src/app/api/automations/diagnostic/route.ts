import { NextRequest, NextResponse } from 'next/server';

import { env } from '@/lib/config/env';
import { getNeonSql } from '@/lib/integrations/database/neon';
import { getWelcomeAutomationDiagnostics } from '@/lib/server/data/store';

type DiagnosticIssue = {
  severity: 'error' | 'warning' | 'info';
  component: string;
  title: string;
  description: string;
  details?: Record<string, unknown>;
};

type DiagnosticResult = {
  ok: boolean;
  checkedAt: string;
  shopDomain: string;
  issues: DiagnosticIssue[];
  welcomeDiagnostics?: Awaited<ReturnType<typeof getWelcomeAutomationDiagnostics>>;
  duplicateReminderGroups?: Array<{
    externalId: string;
    stepKey: string;
    deliveryCount: number;
    tokenCount: number;
    subscriberCount: number;
    spreadSeconds: number;
    firstDeliveredAt: string | null;
    lastDeliveredAt: string | null;
  }>;
  multiTokenExternalIds?: Array<{
    externalId: string;
    activeTokenCount: number;
    subscriberCount: number;
    latestSeenAt: string | null;
  }>;
  clickTracking?: {
    deliveries7d: number;
    deliveryRowsClicked7d: number;
    clicks7d: number;
    lastDeliveryClickAt: string | null;
    lastAutomationClickAt: string | null;
  };
  clickTrackingDebug?: {
    configuredBases: string[];
    resolvedTrackingBase: string | null;
    sampleTrackingUrls: Array<{ base: string; url: string }>;
    endpointProbes: Array<{ base: string; ok: boolean; status: number | null; error: string | null }>;
  };
  recentWelcomeDeliveries?: Array<{
    id: number;
    externalId: string | null;
    subscriberId: number | null;
    tokenId: number | null;
    stepKey: string;
    targetUrl: string | null;
    deliveredAt: string | null;
    clickedAt: string | null;
  }>;
  recentAutomationClicks?: Array<{
    id: number;
    externalId: string | null;
    targetUrl: string;
    clickedAt: string | null;
  }>;
};

export async function GET(request: NextRequest) {
  try {
    const shopDomain = request.nextUrl.searchParams.get('shop')?.trim().toLowerCase();
    if (!shopDomain) {
      return NextResponse.json({ ok: false, error: 'Missing shop parameter.' }, { status: 400 });
    }

    const sql = getNeonSql();
    const checkedAt = new Date().toISOString();

    const [welcomeDiagnostics, duplicateRows, multiTokenRows, deliverySummaryRows, clickSummaryRows, recentDeliveryRows, recentClickRows] = await Promise.all([
      getWelcomeAutomationDiagnostics(shopDomain),
      sql`
        WITH grouped AS (
          SELECT
            d.external_id,
            COALESCE(j.payload -> 'metadata' ->> 'stepKey', 'unknown') AS step_key,
            COUNT(*)::INT AS delivery_count,
            COUNT(DISTINCT d.token_id)::INT AS token_count,
            COUNT(DISTINCT d.subscriber_id)::INT AS subscriber_count,
            EXTRACT(EPOCH FROM (MAX(d.delivered_at) - MIN(d.delivered_at)))::INT AS spread_seconds,
            MIN(d.delivered_at) AS first_delivered_at,
            MAX(d.delivered_at) AS last_delivered_at
          FROM automation_deliveries d
          JOIN automation_jobs j ON j.id = d.automation_job_id
          WHERE d.shop_domain = ${shopDomain}
            AND d.rule_key = 'welcome_subscriber'
            AND d.delivered_at >= NOW() - INTERVAL '7 days'
            AND COALESCE(j.payload -> 'metadata' ->> 'stepKey', '') IN ('reminder-1', 'reminder-2', 'reminder-3')
            AND COALESCE(d.external_id, '') <> ''
          GROUP BY d.external_id, step_key
        )
        SELECT *
        FROM grouped
        WHERE delivery_count > 1
        ORDER BY last_delivered_at DESC
        LIMIT 25
      `,
      sql`
        SELECT
          s.external_id,
          COUNT(*)::INT AS active_token_count,
          COUNT(DISTINCT s.id)::INT AS subscriber_count,
          MAX(t.last_seen_at) AS latest_seen_at
        FROM subscriber_tokens t
        JOIN subscribers s ON s.id = t.subscriber_id
        WHERE t.shop_domain = ${shopDomain}
          AND t.status = 'active'
          AND COALESCE(s.external_id, '') <> ''
        GROUP BY s.external_id
        HAVING COUNT(*) > 1
        ORDER BY active_token_count DESC, latest_seen_at DESC NULLS LAST
        LIMIT 25
      `,
      sql`
        SELECT
          COUNT(*) FILTER (WHERE delivered_at >= NOW() - INTERVAL '7 days')::INT AS deliveries_7d,
          COUNT(*) FILTER (WHERE clicked_at IS NOT NULL AND delivered_at >= NOW() - INTERVAL '7 days')::INT AS delivery_rows_clicked_7d,
          MAX(clicked_at) AS last_delivery_click_at
        FROM automation_deliveries
        WHERE shop_domain = ${shopDomain}
          AND rule_key = 'welcome_subscriber'
      `,
      sql`
        SELECT
          COUNT(*) FILTER (WHERE clicked_at >= NOW() - INTERVAL '7 days')::INT AS clicks_7d,
          MAX(clicked_at) AS last_automation_click_at
        FROM automation_clicks
        WHERE shop_domain = ${shopDomain}
          AND rule_key = 'welcome_subscriber'
      `,
      sql`
        SELECT
          d.id,
          d.external_id,
          d.subscriber_id,
          d.token_id,
          d.target_url,
          d.delivered_at,
          d.clicked_at,
          COALESCE(j.payload -> 'metadata' ->> 'stepKey', 'unknown') AS step_key
        FROM automation_deliveries d
        JOIN automation_jobs j ON j.id = d.automation_job_id
        WHERE d.shop_domain = ${shopDomain}
          AND d.rule_key = 'welcome_subscriber'
        ORDER BY d.delivered_at DESC
        LIMIT 25
      `,
      sql`
        SELECT id, external_id, target_url, clicked_at
        FROM automation_clicks
        WHERE shop_domain = ${shopDomain}
          AND rule_key = 'welcome_subscriber'
        ORDER BY clicked_at DESC
        LIMIT 25
      `,
    ]);

    const rawBases = [
      env.SHOPIFY_APP_URL,
      env.NEXT_PUBLIC_APP_URL,
      env.SHOPIFY_ROOT_APP_URL,
      'https://push-eagle-dashboard.vercel.app',
    ];

    const configuredBases: string[] = [];
    for (const raw of rawBases) {
      const value = String(raw ?? '').trim();
      if (!value) {
        continue;
      }
      try {
        const parsed = new URL(value);
        if (!/^https?:$/i.test(parsed.protocol)) {
          continue;
        }
        const normalized = parsed.toString().replace(/\/$/, '');
        if (!configuredBases.includes(normalized)) {
          configuredBases.push(normalized);
        }
        if (parsed.hostname === 'push-eagle.vercel.app') {
          const dashboardVariant = `${parsed.protocol}//push-eagle-dashboard.vercel.app`;
          if (!configuredBases.includes(dashboardVariant)) {
            configuredBases.push(dashboardVariant);
          }
        }
      } catch {
        // Ignore malformed base URLs.
      }
    }

    const resolvedTrackingBase = configuredBases.find((item) => {
      try {
        return new URL(item).hostname.includes('dashboard');
      } catch {
        return false;
      }
    })
      || configuredBases.find((item) => {
        try {
          return new URL(item).hostname !== 'localhost';
        } catch {
          return false;
        }
      })
      || configuredBases[0]
      || null;

    const sampleRecentDelivery = (recentDeliveryRows as Array<Record<string, unknown>>)[0] ?? null;
    const sampleTarget = sampleRecentDelivery?.target_url ? String(sampleRecentDelivery.target_url) : `https://${shopDomain}/`;
    const sampleExternal = sampleRecentDelivery?.external_id ? String(sampleRecentDelivery.external_id) : 'diagnostic_probe';

    const sampleTrackingUrls = configuredBases.slice(0, 4).map((base) => {
      const tracker = new URL('/api/track/automation-click', base);
      tracker.searchParams.set('r', 'welcome_subscriber');
      tracker.searchParams.set('s', shopDomain);
      tracker.searchParams.set('u', String(sampleTarget));
      tracker.searchParams.set('e', String(sampleExternal));
      tracker.searchParams.set('nr', '1');
      return {
        base,
        url: tracker.toString(),
      };
    });

    const endpointProbes = await Promise.all(
      configuredBases.slice(0, 4).map(async (base) => {
        try {
          const probeUrl = new URL('/api/track/automation-click?probe=1', base).toString();
          const response = await fetch(probeUrl, {
            method: 'GET',
            redirect: 'manual',
            cache: 'no-store',
          });
          return {
            base,
            ok: response.status === 400 || response.status === 405 || (response.status >= 200 && response.status < 400),
            status: response.status,
            error: null,
          };
        } catch (probeError) {
          return {
            base,
            ok: false,
            status: null,
            error: probeError instanceof Error ? probeError.message : 'Probe failed',
          };
        }
      }),
    );

    const duplicateReminderGroups = (duplicateRows as Array<Record<string, unknown>>).map((row) => ({
      externalId: String(row.external_id ?? ''),
      stepKey: String(row.step_key ?? ''),
      deliveryCount: Number(row.delivery_count ?? 0),
      tokenCount: Number(row.token_count ?? 0),
      subscriberCount: Number(row.subscriber_count ?? 0),
      spreadSeconds: Number(row.spread_seconds ?? 0),
      firstDeliveredAt: row.first_delivered_at ? new Date(String(row.first_delivered_at)).toISOString() : null,
      lastDeliveredAt: row.last_delivered_at ? new Date(String(row.last_delivered_at)).toISOString() : null,
    }));

    const multiTokenExternalIds = (multiTokenRows as Array<Record<string, unknown>>).map((row) => ({
      externalId: String(row.external_id ?? ''),
      activeTokenCount: Number(row.active_token_count ?? 0),
      subscriberCount: Number(row.subscriber_count ?? 0),
      latestSeenAt: row.latest_seen_at ? new Date(String(row.latest_seen_at)).toISOString() : null,
    }));

    const recentWelcomeDeliveries = (recentDeliveryRows as Array<Record<string, unknown>>).map((row) => ({
      id: Number(row.id ?? 0),
      externalId: row.external_id ? String(row.external_id) : null,
      subscriberId: row.subscriber_id == null ? null : Number(row.subscriber_id),
      tokenId: row.token_id == null ? null : Number(row.token_id),
      stepKey: String(row.step_key ?? ''),
      targetUrl: row.target_url ? String(row.target_url) : null,
      deliveredAt: row.delivered_at ? new Date(String(row.delivered_at)).toISOString() : null,
      clickedAt: row.clicked_at ? new Date(String(row.clicked_at)).toISOString() : null,
    }));

    const recentAutomationClicks = (recentClickRows as Array<Record<string, unknown>>).map((row) => ({
      id: Number(row.id ?? 0),
      externalId: row.external_id ? String(row.external_id) : null,
      targetUrl: String(row.target_url ?? ''),
      clickedAt: row.clicked_at ? new Date(String(row.clicked_at)).toISOString() : null,
    }));

    const deliverySummary = deliverySummaryRows[0] as Record<string, unknown> | undefined;
    const clickSummary = clickSummaryRows[0] as Record<string, unknown> | undefined;

    const clickTracking = {
      deliveries7d: Number(deliverySummary?.deliveries_7d ?? 0),
      deliveryRowsClicked7d: Number(deliverySummary?.delivery_rows_clicked_7d ?? 0),
      clicks7d: Number(clickSummary?.clicks_7d ?? 0),
      lastDeliveryClickAt: deliverySummary?.last_delivery_click_at ? new Date(String(deliverySummary.last_delivery_click_at)).toISOString() : null,
      lastAutomationClickAt: clickSummary?.last_automation_click_at ? new Date(String(clickSummary.last_automation_click_at)).toISOString() : null,
    };

    const issues: DiagnosticIssue[] = [];

    for (const issue of welcomeDiagnostics.inferredIssues) {
      issues.push({
        severity: 'warning',
        component: 'WelcomeSequence',
        title: 'Welcome automation warning',
        description: issue,
      });
    }

    const simultaneousDuplicateGroups = duplicateReminderGroups.filter((group) => group.spreadSeconds <= 300 && group.deliveryCount > 1);
    if (simultaneousDuplicateGroups.length > 0) {
      issues.push({
        severity: 'error',
        component: 'ReminderDeduplication',
        title: 'Same reminder delivered multiple times close together',
        description: 'At least one welcome reminder was delivered more than once for the same external user within five minutes.',
        details: { groups: simultaneousDuplicateGroups.slice(0, 10) },
      });
    } else if (duplicateReminderGroups.length > 0) {
      issues.push({
        severity: 'warning',
        component: 'ReminderDeduplication',
        title: 'Repeated reminder deliveries detected',
        description: 'The same welcome reminder appears multiple times for the same external user in recent history.',
        details: { groups: duplicateReminderGroups.slice(0, 10) },
      });
    }

    if (multiTokenExternalIds.length > 0) {
      issues.push({
        severity: 'warning',
        component: 'TokenInventory',
        title: 'External users with multiple active tokens detected',
        description: 'Multiple active tokens can explain repeated sends if dedupe is not applied at the external user level.',
        details: { groups: multiTokenExternalIds.slice(0, 10) },
      });
    }

    if (clickTracking.deliveries7d > 0 && clickTracking.clicks7d === 0) {
      issues.push({
        severity: 'error',
        component: 'ClickTracking',
        title: 'Welcome deliveries exist but automation clicks are not being saved',
        description: 'Notifications were delivered in the last 7 days, but no welcome automation click rows were recorded.',
        details: {
          deliveries7d: clickTracking.deliveries7d,
          recentTargets: recentWelcomeDeliveries.slice(0, 5).map((row) => row.targetUrl),
          resolvedTrackingBase,
        },
      });
    } else if (clickTracking.clicks7d > 0) {
      issues.push({
        severity: 'info',
        component: 'ClickTracking',
        title: 'Welcome automation clicks exist in the database',
        description: 'Automation click rows were found for welcome notifications.',
        details: {
          clicks7d: clickTracking.clicks7d,
          lastAutomationClickAt: clickTracking.lastAutomationClickAt,
        },
      });
    }

    const recentRelativeTargets = recentWelcomeDeliveries.filter((row) => row.targetUrl?.startsWith('/'));
    if (recentRelativeTargets.length > 0) {
      issues.push({
        severity: 'info',
        component: 'ClickTracking',
        title: 'Recent welcome deliveries include relative storefront URLs',
        description: 'Relative URLs are valid storefront targets, but diagnostics lists them explicitly because click tracking failures often show up on these paths first.',
        details: { deliveries: recentRelativeTargets.slice(0, 10) },
      });
    }

    const resolvedProbe = resolvedTrackingBase
      ? endpointProbes.find((probe) => probe.base === resolvedTrackingBase) ?? null
      : null;
    const failingProbes = endpointProbes.filter((probe) => !probe.ok);

    if (resolvedTrackingBase && resolvedProbe && !resolvedProbe.ok) {
      issues.push({
        severity: 'warning',
        component: 'ClickTracking',
        title: 'Resolved tracking endpoint probe failed',
        description: 'Diagnostics could not reach the currently selected tracking base. Check tracking domain/env alignment.',
        details: { resolvedTrackingBase, endpointProbes },
      });
    } else if (!resolvedTrackingBase && failingProbes.length > 0) {
      issues.push({
        severity: 'warning',
        component: 'ClickTracking',
        title: 'Tracking endpoint probes failed with no resolved base',
        description: 'Diagnostics found failing tracking probes and could not determine a resolved tracking base.',
        details: { endpointProbes },
      });
    } else if (failingProbes.length > 0) {
      issues.push({
        severity: 'info',
        component: 'ClickTracking',
        title: 'Some non-active tracking bases are unreachable',
        description: 'The resolved tracking base is healthy. Unreachable fallback or legacy bases are listed for cleanup visibility.',
        details: { resolvedTrackingBase, endpointProbes },
      });
    }

    return NextResponse.json({
      ok: issues.every((issue) => issue.severity !== 'error'),
      checkedAt,
      shopDomain,
      issues,
      welcomeDiagnostics,
      duplicateReminderGroups,
      multiTokenExternalIds,
      clickTracking,
      clickTrackingDebug: {
        configuredBases,
        resolvedTrackingBase,
        sampleTrackingUrls,
        endpointProbes,
      },
      recentWelcomeDeliveries,
      recentAutomationClicks,
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
            description: error instanceof Error ? error.message : 'Failed to run diagnostic.',
          },
        ],
      } satisfies DiagnosticResult,
      { status: 500 },
    );
  }
}
