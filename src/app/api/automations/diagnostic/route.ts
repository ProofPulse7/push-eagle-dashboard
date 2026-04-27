import { NextRequest, NextResponse } from 'next/server';

import { getNeonSql } from '@/lib/integrations/database/neon';

type DiagnosticIssue = {
  severity: 'error' | 'warning' | 'info';
  component: string;
  title: string;
  description: string;
  details?: Record<string, unknown>;
};

type CronJobHealth = {
  lastRunAt: string | null;
  lastOkAt: string | null;
  lastErrorAt: string | null;
  minutesSinceLastRun: number | null;
  errorsLastHour: number;
};

type CartStepSummary = {
  pending: number;
  dueNow: number;
  sent: number;
  failed: number;
  skipped: number;
  processing: number;
  delivered: number;
  lastDeliveredAt: string | null;
};

type DiagnosticResult = {
  ok: boolean;
  checkedAt: string;
  shopDomain: string;
  issues: DiagnosticIssue[];
  automationQueueHealth: {
    pendingJobs: number;
    processingJobs: number;
    failedJobs: number;
    dueNowJobs: number;
    overdueBy5Minutes: number;
    oldestDueAt: string | null;
    oldestDueAgeMinutes: number | null;
    abandonedCartPendingJobs: number;
    abandonedCartDueNowJobs: number;
  };
  cronHealth: {
    processAutomations: CronJobHealth;
    processIngestion: CronJobHealth;
    processCampaigns: CronJobHealth;
  };
  abandonedCartDiagnostics: {
    checkedAt: string;
    summary: {
      reminder1: CartStepSummary;
      reminder2: CartStepSummary;
      reminder3: CartStepSummary;
      staleProcessing: number;
    };
    stepConfig: {
      reminder1: { enabled: boolean; delayMinutes: number };
      reminder2: { enabled: boolean; delayMinutes: number };
      reminder3: { enabled: boolean; delayMinutes: number };
    };
    sendLagDiagnostics: {
      reminder1: { sampleCount: number; averageLagMinutes: number | null; maxLagMinutes: number | null };
      reminder2: { sampleCount: number; averageLagMinutes: number | null; maxLagMinutes: number | null };
      reminder3: { sampleCount: number; averageLagMinutes: number | null; maxLagMinutes: number | null };
    };
    inferredIssues: string[];
    recentFailedReasons: {
      reminder1: string[];
      reminder2: string[];
      reminder3: string[];
    };
  };
};

const toIsoOrNull = (value: unknown) => (value ? new Date(String(value)).toISOString() : null);

const toStepKey = (value: unknown): 'cart-reminder-1' | 'cart-reminder-2' | 'cart-reminder-3' | null => {
  const key = String(value ?? '');
  if (key === 'cart-reminder-1' || key === 'cart-reminder-2' || key === 'cart-reminder-3') {
    return key;
  }
  return null;
};

const summarizeLag = (samples: number[]) => {
  if (samples.length === 0) {
    return {
      sampleCount: 0,
      averageLagMinutes: null,
      maxLagMinutes: null,
    };
  }

  const average = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const max = Math.max(...samples);

  return {
    sampleCount: samples.length,
    averageLagMinutes: Math.round(average * 100) / 100,
    maxLagMinutes: Math.round(max * 100) / 100,
  };
};

export async function GET(request: NextRequest) {
  try {
    const shopDomain = request.nextUrl.searchParams.get('shop')?.trim().toLowerCase();
    if (!shopDomain) {
      return NextResponse.json({ ok: false, error: 'Missing shop parameter.' }, { status: 400 });
    }

    const sql = getNeonSql();
    const checkedAt = new Date().toISOString();

    const [
      automationQueueRows,
      cronHeartbeatRows,
      cartJobRows,
      cartDeliveryRows,
      staleProcessingRows,
      lagRows,
      failedRows,
      cartRuleRows,
      activitySignalRows,
    ] = await Promise.all([
      sql`
        SELECT
          COUNT(*) FILTER (WHERE status = 'pending')::INT AS pending_jobs,
          COUNT(*) FILTER (WHERE status = 'processing')::INT AS processing_jobs,
          COUNT(*) FILTER (WHERE status = 'failed')::INT AS failed_jobs,
          COUNT(*) FILTER (WHERE status = 'pending' AND due_at <= NOW())::INT AS due_now_jobs,
          COUNT(*) FILTER (WHERE status = 'pending' AND due_at <= NOW() - INTERVAL '5 minutes')::INT AS overdue_by_5m,
          MIN(due_at) FILTER (WHERE status = 'pending') AS oldest_due_at,
          COUNT(*) FILTER (WHERE rule_key = 'cart_abandonment_30m' AND status = 'pending')::INT AS cart_pending_jobs,
          COUNT(*) FILTER (WHERE rule_key = 'cart_abandonment_30m' AND status = 'pending' AND due_at <= NOW())::INT AS cart_due_now_jobs
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
          COALESCE(payload -> 'metadata' ->> 'stepKey', '') AS step_key,
          COUNT(*) FILTER (WHERE status = 'pending')::INT AS pending,
          COUNT(*) FILTER (WHERE status = 'pending' AND due_at <= NOW())::INT AS due_now,
          COUNT(*) FILTER (WHERE status = 'sent')::INT AS sent,
          COUNT(*) FILTER (WHERE status = 'failed')::INT AS failed,
          COUNT(*) FILTER (WHERE status = 'skipped')::INT AS skipped,
          COUNT(*) FILTER (WHERE status = 'processing')::INT AS processing
        FROM automation_jobs
        WHERE shop_domain = ${shopDomain}
          AND rule_key = 'cart_abandonment_30m'
          AND COALESCE(payload -> 'metadata' ->> 'stepKey', '') IN ('cart-reminder-1', 'cart-reminder-2', 'cart-reminder-3')
        GROUP BY 1
      `,
      sql`
        SELECT
          COALESCE(j.payload -> 'metadata' ->> 'stepKey', '') AS step_key,
          COUNT(*)::INT AS delivered,
          MAX(d.delivered_at) AS last_delivered_at
        FROM automation_deliveries d
        JOIN automation_jobs j ON j.id = d.automation_job_id
        WHERE d.shop_domain = ${shopDomain}
          AND d.rule_key = 'cart_abandonment_30m'
          AND COALESCE(j.payload -> 'metadata' ->> 'stepKey', '') IN ('cart-reminder-1', 'cart-reminder-2', 'cart-reminder-3')
        GROUP BY 1
      `,
      sql`
        SELECT COUNT(*)::INT AS stale_processing
        FROM automation_jobs
        WHERE shop_domain = ${shopDomain}
          AND rule_key = 'cart_abandonment_30m'
          AND status = 'processing'
          AND updated_at < NOW() - INTERVAL '2 minutes'
          AND COALESCE(payload -> 'metadata' ->> 'stepKey', '') IN ('cart-reminder-1', 'cart-reminder-2', 'cart-reminder-3')
      `,
      sql`
        SELECT
          COALESCE(payload -> 'metadata' ->> 'stepKey', '') AS step_key,
          EXTRACT(EPOCH FROM (sent_at - due_at)) / 60.0 AS lag_minutes
        FROM automation_jobs
        WHERE shop_domain = ${shopDomain}
          AND rule_key = 'cart_abandonment_30m'
          AND status = 'sent'
          AND sent_at IS NOT NULL
          AND due_at IS NOT NULL
          AND COALESCE(payload -> 'metadata' ->> 'stepKey', '') IN ('cart-reminder-1', 'cart-reminder-2', 'cart-reminder-3')
        ORDER BY sent_at DESC
        LIMIT 120
      `,
      sql`
        SELECT
          COALESCE(payload -> 'metadata' ->> 'stepKey', '') AS step_key,
          error_message
        FROM automation_jobs
        WHERE shop_domain = ${shopDomain}
          AND rule_key = 'cart_abandonment_30m'
          AND status = 'failed'
          AND COALESCE(payload -> 'metadata' ->> 'stepKey', '') IN ('cart-reminder-1', 'cart-reminder-2', 'cart-reminder-3')
          AND COALESCE(error_message, '') <> ''
        ORDER BY updated_at DESC
        LIMIT 60
      `,
      sql`
        SELECT config
        FROM automation_rules
        WHERE shop_domain = ${shopDomain}
          AND rule_key = 'cart_abandonment_30m'
        LIMIT 1
      `,
      sql`
        SELECT
          COUNT(*) FILTER (WHERE event_type = 'add_to_cart' AND created_at >= NOW() - INTERVAL '24 hours')::INT AS add_to_cart_24h,
          COUNT(*) FILTER (WHERE event_type = 'checkout_start' AND created_at >= NOW() - INTERVAL '24 hours')::INT AS checkout_start_24h,
          COUNT(*) FILTER (WHERE event_type = 'add_to_cart' AND created_at >= NOW() - INTERVAL '7 days')::INT AS add_to_cart_7d,
          COUNT(*) FILTER (WHERE event_type = 'checkout_start' AND created_at >= NOW() - INTERVAL '7 days')::INT AS checkout_start_7d
        FROM subscriber_activity_events
        WHERE shop_domain = ${shopDomain}
      `,
    ]);

    const queueRow = automationQueueRows[0] as Record<string, unknown> | undefined;
    const automationQueueHealth: DiagnosticResult['automationQueueHealth'] = {
      pendingJobs: Number(queueRow?.pending_jobs ?? 0),
      processingJobs: Number(queueRow?.processing_jobs ?? 0),
      failedJobs: Number(queueRow?.failed_jobs ?? 0),
      dueNowJobs: Number(queueRow?.due_now_jobs ?? 0),
      overdueBy5Minutes: Number(queueRow?.overdue_by_5m ?? 0),
      oldestDueAt: toIsoOrNull(queueRow?.oldest_due_at),
      oldestDueAgeMinutes: queueRow?.oldest_due_at
        ? Math.max(0, Math.floor((Date.now() - new Date(String(queueRow.oldest_due_at)).getTime()) / 60000))
        : null,
      abandonedCartPendingJobs: Number(queueRow?.cart_pending_jobs ?? 0),
      abandonedCartDueNowJobs: Number(queueRow?.cart_due_now_jobs ?? 0),
    };

    const heartbeatByJob = new Map(
      (cronHeartbeatRows as Array<Record<string, unknown>>).map((row) => [
        String(row.job_name ?? ''),
        {
          lastRunAt: toIsoOrNull(row.last_run_at),
          lastOkAt: toIsoOrNull(row.last_ok_at),
          lastErrorAt: toIsoOrNull(row.last_error_at),
          errorsLastHour: Number(row.errors_last_hour ?? 0),
        },
      ]),
    );

    const toCronHealth = (jobName: string): CronJobHealth => {
      const raw = heartbeatByJob.get(jobName) ?? {
        lastRunAt: null,
        lastOkAt: null,
        lastErrorAt: null,
        errorsLastHour: 0,
      };

      return {
        ...raw,
        minutesSinceLastRun: raw.lastRunAt
          ? Math.max(0, Math.floor((Date.now() - new Date(raw.lastRunAt).getTime()) / 60000))
          : null,
      };
    };

    const cronHealth: DiagnosticResult['cronHealth'] = {
      processAutomations: toCronHealth('process_automations'),
      processIngestion: toCronHealth('process_ingestion'),
      processCampaigns: toCronHealth('process_campaigns'),
    };

    const baseStepSummary = (): CartStepSummary => ({
      pending: 0,
      dueNow: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      processing: 0,
      delivered: 0,
      lastDeliveredAt: null,
    });

    const summary: DiagnosticResult['abandonedCartDiagnostics']['summary'] = {
      reminder1: baseStepSummary(),
      reminder2: baseStepSummary(),
      reminder3: baseStepSummary(),
      staleProcessing: Number(staleProcessingRows[0]?.stale_processing ?? 0),
    };

    for (const row of cartJobRows as Array<Record<string, unknown>>) {
      const stepKey = toStepKey(row.step_key);
      if (!stepKey) {
        continue;
      }

      const bucket = stepKey === 'cart-reminder-1'
        ? summary.reminder1
        : stepKey === 'cart-reminder-2'
          ? summary.reminder2
          : summary.reminder3;

      bucket.pending = Number(row.pending ?? 0);
      bucket.dueNow = Number(row.due_now ?? 0);
      bucket.sent = Number(row.sent ?? 0);
      bucket.failed = Number(row.failed ?? 0);
      bucket.skipped = Number(row.skipped ?? 0);
      bucket.processing = Number(row.processing ?? 0);
    }

    for (const row of cartDeliveryRows as Array<Record<string, unknown>>) {
      const stepKey = toStepKey(row.step_key);
      if (!stepKey) {
        continue;
      }

      const bucket = stepKey === 'cart-reminder-1'
        ? summary.reminder1
        : stepKey === 'cart-reminder-2'
          ? summary.reminder2
          : summary.reminder3;

      bucket.delivered = Number(row.delivered ?? 0);
      bucket.lastDeliveredAt = toIsoOrNull(row.last_delivered_at);
    }

    const stepConfigRaw = (cartRuleRows[0]?.config as Record<string, unknown> | null)?.steps as
      | Record<string, { enabled?: boolean; delayMinutes?: number }>
      | undefined;

    const stepConfig: DiagnosticResult['abandonedCartDiagnostics']['stepConfig'] = {
      reminder1: {
        enabled: Boolean(stepConfigRaw?.['cart-reminder-1']?.enabled),
        delayMinutes: Number(stepConfigRaw?.['cart-reminder-1']?.delayMinutes ?? 20),
      },
      reminder2: {
        enabled: Boolean(stepConfigRaw?.['cart-reminder-2']?.enabled),
        delayMinutes: Number(stepConfigRaw?.['cart-reminder-2']?.delayMinutes ?? 120),
      },
      reminder3: {
        enabled: Boolean(stepConfigRaw?.['cart-reminder-3']?.enabled),
        delayMinutes: Number(stepConfigRaw?.['cart-reminder-3']?.delayMinutes ?? 1440),
      },
    };

    const lagSamples = {
      reminder1: [] as number[],
      reminder2: [] as number[],
      reminder3: [] as number[],
    };

    for (const row of lagRows as Array<Record<string, unknown>>) {
      const stepKey = toStepKey(row.step_key);
      const lag = Number(row.lag_minutes ?? 0);
      if (!stepKey || !Number.isFinite(lag)) {
        continue;
      }

      if (stepKey === 'cart-reminder-1') {
        lagSamples.reminder1.push(lag);
      } else if (stepKey === 'cart-reminder-2') {
        lagSamples.reminder2.push(lag);
      } else {
        lagSamples.reminder3.push(lag);
      }
    }

    const sendLagDiagnostics: DiagnosticResult['abandonedCartDiagnostics']['sendLagDiagnostics'] = {
      reminder1: summarizeLag(lagSamples.reminder1),
      reminder2: summarizeLag(lagSamples.reminder2),
      reminder3: summarizeLag(lagSamples.reminder3),
    };

    const failedByStep: Record<'cart-reminder-1' | 'cart-reminder-2' | 'cart-reminder-3', string[]> = {
      'cart-reminder-1': [],
      'cart-reminder-2': [],
      'cart-reminder-3': [],
    };

    for (const row of failedRows as Array<Record<string, unknown>>) {
      const stepKey = toStepKey(row.step_key);
      const message = String(row.error_message ?? '').trim();
      if (!stepKey || !message) {
        continue;
      }
      if (failedByStep[stepKey].length < 6 && !failedByStep[stepKey].includes(message)) {
        failedByStep[stepKey].push(message);
      }
    }

    const recentFailedReasons: DiagnosticResult['abandonedCartDiagnostics']['recentFailedReasons'] = {
      reminder1: failedByStep['cart-reminder-1'],
      reminder2: failedByStep['cart-reminder-2'],
      reminder3: failedByStep['cart-reminder-3'],
    };

    const activitySignals = activitySignalRows[0] as Record<string, unknown> | undefined;
    const addToCart24h = Number(activitySignals?.add_to_cart_24h ?? 0);
    const checkoutStart24h = Number(activitySignals?.checkout_start_24h ?? 0);
    const addToCart7d = Number(activitySignals?.add_to_cart_7d ?? 0);
    const checkoutStart7d = Number(activitySignals?.checkout_start_7d ?? 0);

    const deliveredTotal = summary.reminder1.delivered + summary.reminder2.delivered + summary.reminder3.delivered;
    const queuedTotal = summary.reminder1.pending + summary.reminder2.pending + summary.reminder3.pending
      + summary.reminder1.processing + summary.reminder2.processing + summary.reminder3.processing;

    const inferredIssues: string[] = [];

    if (!cronHealth.processAutomations.lastRunAt) {
      inferredIssues.push('Automation cron has never run, so delayed cart reminders will wait for fallback traffic.');
    }

    if ((automationQueueHealth.abandonedCartDueNowJobs ?? 0) > 0) {
      inferredIssues.push('Due abandoned-cart jobs exist and should be picked immediately by process_automations.');
    }

    if ((summary.staleProcessing ?? 0) > 0) {
      inferredIssues.push('Stale cart processing jobs detected (>2m); worker interruption/backpressure likely occurred.');
    }

    const cartFailedTotal = summary.reminder1.failed + summary.reminder2.failed + summary.reminder3.failed;
    if (cartFailedTotal > 0) {
      inferredIssues.push('Some cart reminder jobs are failing; review recent failed reasons per step.');
    }

    if (addToCart24h === 0 && checkoutStart24h === 0) {
      inferredIssues.push('No recent add_to_cart or checkout_start activity was recorded in the last 24h. Trigger ingestion may be missing.');
    }

    if (addToCart7d === 0 && checkoutStart7d === 0 && deliveredTotal === 0 && queuedTotal === 0) {
      inferredIssues.push('No abandoned-cart trigger activity was observed in 7d, so reminder steps were never queued.');
    }

    const delayedR2 = lagSamples.reminder2.filter((value) => value >= 2).length;
    const delayedR3 = lagSamples.reminder3.filter((value) => value >= 2).length;
    if (delayedR2 > 0 || delayedR3 > 0) {
      inferredIssues.push(
        `Observed delayed sends: cart-reminder-2 delayed >=2m ${delayedR2} times, cart-reminder-3 delayed >=2m ${delayedR3} times.`,
      );
    }

    if (inferredIssues.length === 0) {
      inferredIssues.push('Abandoned-cart automation looks healthy: queue, scheduling, and send lag are within expected bounds.');
    }

    const abandonedCartDiagnostics: DiagnosticResult['abandonedCartDiagnostics'] = {
      checkedAt,
      summary,
      stepConfig,
      sendLagDiagnostics,
      inferredIssues,
      recentFailedReasons,
    };

    const issues: DiagnosticIssue[] = [];

    if (!cronHealth.processAutomations.lastRunAt) {
      issues.push({
        severity: 'error',
        component: 'AutomationCron',
        title: 'Automation cron has never run',
        description: 'No process_automations heartbeat was found. Delayed cart reminders may wait for fallback traffic.',
        details: cronHealth.processAutomations,
      });
    } else if ((cronHealth.processAutomations.minutesSinceLastRun ?? 9999) > 3) {
      issues.push({
        severity: 'warning',
        component: 'AutomationCron',
        title: 'Automation cron heartbeat is stale',
        description: 'process_automations has not run recently enough for timely cart reminder processing.',
        details: cronHealth.processAutomations,
      });
    } else {
      issues.push({
        severity: 'info',
        component: 'AutomationCron',
        title: 'Automation cron heartbeat is healthy',
        description: 'process_automations is running within expected cadence.',
        details: cronHealth.processAutomations,
      });
    }

    if ((automationQueueHealth.overdueBy5Minutes ?? 0) > 0 || (automationQueueHealth.abandonedCartDueNowJobs ?? 0) > 0) {
      issues.push({
        severity: 'warning',
        component: 'AbandonedCartQueue',
        title: 'Abandoned-cart jobs are waiting in queue',
        description: 'Pending due jobs are present; verify scheduler cadence and worker throughput.',
        details: automationQueueHealth,
      });
    } else {
      issues.push({
        severity: 'info',
        component: 'AbandonedCartQueue',
        title: 'Abandoned-cart queue is healthy',
        description: 'No overdue pending abandoned-cart jobs are currently detected.',
        details: automationQueueHealth,
      });
    }

    if (addToCart24h === 0 && checkoutStart24h === 0) {
      issues.push({
        severity: 'warning',
        component: 'AbandonedCartSignals',
        title: 'No recent abandoned-cart trigger signals detected',
        description: 'No add_to_cart or checkout_start activity was observed in the last 24h; reminders cannot enqueue without trigger events.',
        details: {
          addToCart24h,
          checkoutStart24h,
          addToCart7d,
          checkoutStart7d,
          queuedTotal,
          deliveredTotal,
        },
      });
    }

    if (cartFailedTotal > 0 || summary.staleProcessing > 0) {
      issues.push({
        severity: 'warning',
        component: 'AbandonedCartAutomation',
        title: 'Abandoned-cart diagnostics found reliability issues',
        description: 'Failed or stale abandoned-cart jobs were detected in recent data.',
        details: abandonedCartDiagnostics,
      });
    } else {
      issues.push({
        severity: 'info',
        component: 'AbandonedCartAutomation',
        title: 'Abandoned-cart automation is working as expected',
        description: 'No failure/staleness signal was detected for the abandoned-cart flow.',
        details: abandonedCartDiagnostics,
      });
    }

    return NextResponse.json({
      ok: issues.every((issue) => issue.severity !== 'error'),
      checkedAt,
      shopDomain,
      issues,
      automationQueueHealth,
      cronHealth,
      abandonedCartDiagnostics,
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
        automationQueueHealth: {
          pendingJobs: 0,
          processingJobs: 0,
          failedJobs: 0,
          dueNowJobs: 0,
          overdueBy5Minutes: 0,
          oldestDueAt: null,
          oldestDueAgeMinutes: null,
          abandonedCartPendingJobs: 0,
          abandonedCartDueNowJobs: 0,
        },
        cronHealth: {
          processAutomations: {
            lastRunAt: null,
            lastOkAt: null,
            lastErrorAt: null,
            minutesSinceLastRun: null,
            errorsLastHour: 0,
          },
          processIngestion: {
            lastRunAt: null,
            lastOkAt: null,
            lastErrorAt: null,
            minutesSinceLastRun: null,
            errorsLastHour: 0,
          },
          processCampaigns: {
            lastRunAt: null,
            lastOkAt: null,
            lastErrorAt: null,
            minutesSinceLastRun: null,
            errorsLastHour: 0,
          },
        },
        abandonedCartDiagnostics: {
          checkedAt: new Date().toISOString(),
          summary: {
            reminder1: {
              pending: 0,
              dueNow: 0,
              sent: 0,
              failed: 0,
              skipped: 0,
              processing: 0,
              delivered: 0,
              lastDeliveredAt: null,
            },
            reminder2: {
              pending: 0,
              dueNow: 0,
              sent: 0,
              failed: 0,
              skipped: 0,
              processing: 0,
              delivered: 0,
              lastDeliveredAt: null,
            },
            reminder3: {
              pending: 0,
              dueNow: 0,
              sent: 0,
              failed: 0,
              skipped: 0,
              processing: 0,
              delivered: 0,
              lastDeliveredAt: null,
            },
            staleProcessing: 0,
          },
          stepConfig: {
            reminder1: { enabled: false, delayMinutes: 20 },
            reminder2: { enabled: false, delayMinutes: 120 },
            reminder3: { enabled: false, delayMinutes: 1440 },
          },
          sendLagDiagnostics: {
            reminder1: { sampleCount: 0, averageLagMinutes: null, maxLagMinutes: null },
            reminder2: { sampleCount: 0, averageLagMinutes: null, maxLagMinutes: null },
            reminder3: { sampleCount: 0, averageLagMinutes: null, maxLagMinutes: null },
          },
          inferredIssues: ['Diagnostics could not be computed.'],
          recentFailedReasons: {
            reminder1: [],
            reminder2: [],
            reminder3: [],
          },
        },
      } satisfies DiagnosticResult,
      { status: 500 },
    );
  }
}

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: 'This diagnostics endpoint is now read-only and focused on abandoned-cart automation.',
    },
    { status: 405 },
  );
}
