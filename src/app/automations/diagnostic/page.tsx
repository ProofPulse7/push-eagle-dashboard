'use client';

import { Suspense, useEffect, useState } from 'react';

import { useSearchParams } from 'next/navigation';
import { AlertCircle, AlertTriangle, CheckCircle, Copy, Info, Loader2, RefreshCw, Trash2 } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useSettings } from '@/context/settings-context';

interface DiagnosticIssue {
  severity: 'error' | 'warning' | 'info';
  component: string;
  title: string;
  description: string;
  details?: Record<string, unknown>;
}

interface DiagnosticResult {
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
  identityCoverage: {
    orders7d: number;
    withExternalId: number;
    withCustomerId: number;
    withEmail: number;
    missingAllIdentity: number;
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
  recentAttributedTouches: Array<{
    sourceType: 'campaign_click' | 'campaign_impression' | 'automation_click' | 'automation_impression';
    sourceId: string;
    orderId: string;
    revenueCents: number;
    occurredAt: string | null;
  }>;
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
}

const formatMoney = (cents: number) => {
  const amount = Number(cents || 0) / 100;
  return amount.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

function DiagnosticPageContent() {
  const { shopDomain } = useSettings();
  const searchParams = useSearchParams();
  const shop = searchParams.get('shop') || shopDomain || '';

  const [diagnostic, setDiagnostic] = useState<DiagnosticResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDiagnostic = async () => {
    if (!shop) {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/automations/diagnostic?shop=${encodeURIComponent(shop)}`, { cache: 'no-store' });
      const payload = (await response.json()) as DiagnosticResult & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      setDiagnostic(payload);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to load diagnostics.');
    } finally {
      setLoading(false);
    }
  };

  const copyDiagnostic = async () => {
    if (!diagnostic) {
      return;
    }

    try {
      await navigator.clipboard.writeText(JSON.stringify(diagnostic, null, 2));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError('Failed to copy diagnostic JSON.');
    }
  };

  const clearAttributionTestData = async () => {
    if (!shop || clearing) {
      return;
    }

    setClearing(true);
    setError(null);
    try {
      const response = await fetch(`/api/automations/diagnostic?shop=${encodeURIComponent(shop)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          shop,
          action: 'clear_attribution_test_data',
        }),
      });

      const payload = await response.json();
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || 'Failed to clear attribution test data.');
      }

      await fetchDiagnostic();
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : 'Failed to clear attribution test data.');
    } finally {
      setClearing(false);
    }
  };

  useEffect(() => {
    if (shop) {
      fetchDiagnostic();
    }
  }, [shop]);

  const getSeverityIcon = (severity: DiagnosticIssue['severity']) => {
    switch (severity) {
      case 'error':
        return <AlertTriangle className="h-5 w-5 text-red-600" />;
      case 'warning':
        return <AlertCircle className="h-5 w-5 text-amber-600" />;
      case 'info':
        return <Info className="h-5 w-5 text-blue-600" />;
    }
  };

  const getSeverityVariant = (severity: DiagnosticIssue['severity']) => {
    switch (severity) {
      case 'error':
        return 'destructive';
      case 'warning':
        return 'secondary';
      case 'info':
        return 'outline';
    }
  };

  if (!shop) {
    return (
      <div className="p-6">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Shop not found</AlertTitle>
          <AlertDescription>Open this page from the Shopify app so diagnostics can load for the current store.</AlertDescription>
        </Alert>
      </div>
    );
  }

  const errorCount = diagnostic?.issues.filter((issue) => issue.severity === 'error').length ?? 0;
  const warningCount = diagnostic?.issues.filter((issue) => issue.severity === 'warning').length ?? 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Attribution Diagnostics</h1>
          <p className="mt-2 text-sm text-muted-foreground">Revenue attribution health for campaigns and automations, including welcome automation.</p>
          <p className="mt-1 text-sm text-muted-foreground">Shop: {shop}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={clearAttributionTestData} disabled={loading || clearing}>
            <Trash2 className="mr-2 h-4 w-4" />
            {clearing ? 'Clearing...' : 'Clear attribution test data'}
          </Button>
          <Button variant="outline" size="sm" onClick={fetchDiagnostic} disabled={loading}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Button size="sm" onClick={copyDiagnostic} disabled={!diagnostic}>
            <Copy className="mr-2 h-4 w-4" />
            {copied ? 'Copied' : 'Copy diagnostic JSON'}
          </Button>
        </div>
      </div>

      {loading && (
        <Card>
          <CardContent className="flex items-center justify-center py-10 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Running attribution diagnostics...
          </CardContent>
        </Card>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Diagnostic error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {diagnostic && !loading && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {diagnostic.ok ? <CheckCircle className="h-5 w-5 text-green-600" /> : <AlertTriangle className="h-5 w-5 text-red-600" />}
                {diagnostic.ok ? 'No blocking attribution errors' : 'Attribution issues found'}
              </CardTitle>
              <CardDescription>Last checked: {new Date(diagnostic.checkedAt).toLocaleString()}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-4">
              <div className="rounded-lg border p-4">
                <div className="text-2xl font-bold text-red-600">{errorCount}</div>
                <div className="text-sm text-muted-foreground">Errors</div>
              </div>
              <div className="rounded-lg border p-4">
                <div className="text-2xl font-bold text-amber-600">{warningCount}</div>
                <div className="text-sm text-muted-foreground">Warnings</div>
              </div>
              <div className="rounded-lg border p-4">
                <div className="text-2xl font-bold text-slate-900">{diagnostic.attributionSummary.orders7d}</div>
                <div className="text-sm text-muted-foreground">Orders in last 7 days</div>
              </div>
              <div className="rounded-lg border p-4">
                <div className="text-2xl font-bold text-slate-900">{diagnostic.attributionSummary.attributedRevenueRatePercent}%</div>
                <div className="text-sm text-muted-foreground">Attributed revenue rate</div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Welcome Identity Debug</CardTitle>
              <CardDescription>Compare unattributed order externalId values with recent welcome delivery/click external IDs.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6 md:grid-cols-2">
              <div>
                <div className="mb-2 text-sm font-medium">Recent welcome click external IDs</div>
                {(diagnostic.welcomeTouchIdentityDebug?.recentClickExternalIds ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No recent click external IDs.</p>
                ) : (
                  <div className="space-y-2 text-sm">
                    {diagnostic.welcomeTouchIdentityDebug.recentClickExternalIds.map((externalId) => (
                      <div key={`click-${externalId}`} className="break-all rounded border p-2">{externalId}</div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <div className="mb-2 text-sm font-medium">Recent welcome delivery external IDs</div>
                {(diagnostic.welcomeTouchIdentityDebug?.recentDeliveryExternalIds ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No recent delivery external IDs.</p>
                ) : (
                  <div className="space-y-2 text-sm">
                    {diagnostic.welcomeTouchIdentityDebug.recentDeliveryExternalIds.map((externalId) => (
                      <div key={`delivery-${externalId}`} className="break-all rounded border p-2">{externalId}</div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Welcome Reminder Delay Diagnostics</CardTitle>
              <CardDescription>Verifies reminder-2/reminder-3 queue health, configured delays, and observed send lag.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              {!diagnostic.welcomeReminderDiagnostics ? (
                <p className="text-muted-foreground">No reminder diagnostics were returned.</p>
              ) : (
                <>
                  <div>Checked at: {new Date(diagnostic.welcomeReminderDiagnostics.checkedAt).toLocaleString()}</div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-lg border p-3">
                      <div className="font-medium">Reminder 2</div>
                      <div>Configured delay: {diagnostic.welcomeReminderDiagnostics.stepConfig.reminder2.delayMinutes} minute(s)</div>
                      <div>Enabled: {diagnostic.welcomeReminderDiagnostics.stepConfig.reminder2.enabled ? 'yes' : 'no'}</div>
                      <div>Pending: {diagnostic.welcomeReminderDiagnostics.summary.reminder2.pending}</div>
                      <div>Due now: {diagnostic.welcomeReminderDiagnostics.summary.reminder2.dueNow}</div>
                      <div>Sent: {diagnostic.welcomeReminderDiagnostics.summary.reminder2.sent}</div>
                      <div>Delivered: {diagnostic.welcomeReminderDiagnostics.summary.reminder2.delivered}</div>
                      <div>Average lag: {diagnostic.welcomeReminderDiagnostics.sendLagDiagnostics.reminder2.averageLagMinutes ?? 'n/a'} minute(s)</div>
                      <div>Max lag: {diagnostic.welcomeReminderDiagnostics.sendLagDiagnostics.reminder2.maxLagMinutes ?? 'n/a'} minute(s)</div>
                      <div>Lag samples: {diagnostic.welcomeReminderDiagnostics.sendLagDiagnostics.reminder2.sampleCount}</div>
                    </div>
                    <div className="rounded-lg border p-3">
                      <div className="font-medium">Reminder 3</div>
                      <div>Configured delay: {diagnostic.welcomeReminderDiagnostics.stepConfig.reminder3.delayMinutes} minute(s)</div>
                      <div>Enabled: {diagnostic.welcomeReminderDiagnostics.stepConfig.reminder3.enabled ? 'yes' : 'no'}</div>
                      <div>Pending: {diagnostic.welcomeReminderDiagnostics.summary.reminder3.pending}</div>
                      <div>Due now: {diagnostic.welcomeReminderDiagnostics.summary.reminder3.dueNow}</div>
                      <div>Sent: {diagnostic.welcomeReminderDiagnostics.summary.reminder3.sent}</div>
                      <div>Delivered: {diagnostic.welcomeReminderDiagnostics.summary.reminder3.delivered}</div>
                      <div>Average lag: {diagnostic.welcomeReminderDiagnostics.sendLagDiagnostics.reminder3.averageLagMinutes ?? 'n/a'} minute(s)</div>
                      <div>Max lag: {diagnostic.welcomeReminderDiagnostics.sendLagDiagnostics.reminder3.maxLagMinutes ?? 'n/a'} minute(s)</div>
                      <div>Lag samples: {diagnostic.welcomeReminderDiagnostics.sendLagDiagnostics.reminder3.sampleCount}</div>
                    </div>
                  </div>
                  <div>Stale processing jobs (&gt;10 minutes): {diagnostic.welcomeReminderDiagnostics.summary.staleProcessing}</div>
                  {(diagnostic.welcomeReminderDiagnostics.inferredIssues ?? []).length > 0 && (
                    <div className="rounded-lg border p-3">
                      <div className="font-medium">Detected issues</div>
                      <ul className="mt-2 list-disc pl-5 space-y-1">
                        {diagnostic.welcomeReminderDiagnostics.inferredIssues.map((issue, index) => (
                          <li key={`${issue}-${index}`}>{issue}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Attribution Settings Snapshot</CardTitle>
              <CardDescription>These settings directly affect revenue assignment logic.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm md:grid-cols-2">
              <div>Model: <strong>{diagnostic.attributionSettings.attributionModel}</strong></div>
              <div>Credit mode: <strong>{diagnostic.attributionSettings.attributionCreditMode}</strong></div>
              <div>Click window: <strong>{diagnostic.attributionSettings.clickWindowDays} days</strong></div>
              <div>Impression window: <strong>{diagnostic.attributionSettings.impressionWindowDays} days</strong></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Revenue Attribution Summary</CardTitle>
              <CardDescription>System-level totals and welcome automation contribution.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 text-sm md:grid-cols-2 xl:grid-cols-3">
              <div className="rounded-lg border p-3">Total order revenue (7d): {formatMoney(diagnostic.attributionSummary.totalRevenueCents7d)}</div>
              <div className="rounded-lg border p-3">Attributed revenue (7d): {formatMoney(diagnostic.attributionSummary.attributedRevenueCents7d)}</div>
              <div className="rounded-lg border p-3">Attributed orders (7d): {diagnostic.attributionSummary.attributedOrders7d}</div>
              <div className="rounded-lg border p-3">Unattributed orders (7d): {diagnostic.attributionSummary.unattributedOrders7d}</div>
              <div className="rounded-lg border p-3">Campaign-attributed revenue: {formatMoney(diagnostic.attributionSummary.campaignAttributedRevenueCents7d)}</div>
              <div className="rounded-lg border p-3">Automation-attributed revenue: {formatMoney(diagnostic.attributionSummary.automationAttributedRevenueCents7d)}</div>
              <div className="rounded-lg border p-3">Welcome attributed orders (7d): {diagnostic.attributionSummary.welcomeAttributedOrders7d}</div>
              <div className="rounded-lg border p-3">Welcome attributed revenue (7d): {formatMoney(diagnostic.attributionSummary.welcomeAttributedRevenueCents7d)}</div>
              <div className="rounded-lg border p-3">Welcome touches (7d): deliveries {diagnostic.attributionSummary.welcomeTouches7d.deliveries}, clicks {diagnostic.attributionSummary.welcomeTouches7d.clicks}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Core Issues</CardTitle>
              <CardDescription>Copy this section with JSON details when troubleshooting attribution.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {diagnostic.issues.length === 0 ? (
                <p className="text-sm text-muted-foreground">No issues were inferred from the current attribution dataset.</p>
              ) : (
                diagnostic.issues.map((issue, index) => (
                  <div key={`${issue.component}-${index}`} className="rounded-lg border p-4">
                    <div className="flex items-start gap-3">
                      {getSeverityIcon(issue.severity)}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold">{issue.title}</h3>
                          <Badge variant={getSeverityVariant(issue.severity)}>{issue.severity.toUpperCase()}</Badge>
                          <Badge variant="outline">{issue.component}</Badge>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">{issue.description}</p>
                      </div>
                    </div>
                    {issue.details && (
                      <details className="mt-3">
                        <summary className="cursor-pointer text-sm font-medium">Show details</summary>
                        <pre className="mt-2 max-h-64 overflow-auto rounded bg-muted p-3 text-xs whitespace-pre-wrap">
                          {JSON.stringify(issue.details, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Identity Coverage</CardTitle>
                <CardDescription>Order records must carry identity keys for attribution matching.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div>Orders 7d: {diagnostic.identityCoverage.orders7d}</div>
                <div>With externalId: {diagnostic.identityCoverage.withExternalId}</div>
                <div>With customerId: {diagnostic.identityCoverage.withCustomerId}</div>
                <div>With email: {diagnostic.identityCoverage.withEmail}</div>
                <div>Missing all identity keys: {diagnostic.identityCoverage.missingAllIdentity}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Webhook and Ingestion Health</CardTitle>
                <CardDescription>Attribution requires healthy orders/create webhook ingestion and queue processing.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div>orders/create events 7d: {diagnostic.webhookHealth.ordersCreateEvents7d}</div>
                <div>Last orders/create event: {diagnostic.webhookHealth.lastOrdersCreateEventAt ?? 'none'}</div>
                <div>Pending ingestion jobs: {diagnostic.ingestionHealth.pendingJobs}</div>
                <div>Processing ingestion jobs: {diagnostic.ingestionHealth.processingJobs}</div>
                <div>Failed ingestion jobs: {diagnostic.ingestionHealth.failedJobs}</div>
                <div>Processed ingestion jobs (7d): {diagnostic.ingestionHealth.processedJobs7d}</div>
                <div>Last processed ingestion job: {diagnostic.ingestionHealth.lastProcessedAt ?? 'none'}</div>
                <div>Last failed ingestion job: {diagnostic.ingestionHealth.lastFailedAt ?? 'none'}</div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Automation Queue Health</CardTitle>
                <CardDescription>Shows whether delayed automation jobs are actually waiting overdue in the queue.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div>Pending jobs: {diagnostic.automationQueueHealth?.pendingJobs ?? 0}</div>
                <div>Processing jobs: {diagnostic.automationQueueHealth?.processingJobs ?? 0}</div>
                <div>Failed jobs: {diagnostic.automationQueueHealth?.failedJobs ?? 0}</div>
                <div>Due now: {diagnostic.automationQueueHealth?.dueNowJobs ?? 0}</div>
                <div>Overdue by 5+ minutes: {diagnostic.automationQueueHealth?.overdueBy5Minutes ?? 0}</div>
                <div>Oldest due at: {diagnostic.automationQueueHealth?.oldestDueAt ?? 'none'}</div>
                <div>Oldest due age: {diagnostic.automationQueueHealth?.oldestDueAgeMinutes ?? 'n/a'} minute(s)</div>
                <div>Welcome pending jobs: {diagnostic.automationQueueHealth?.welcomePendingJobs ?? 0}</div>
                <div>Welcome due now: {diagnostic.automationQueueHealth?.welcomeDueNowJobs ?? 0}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Impression Coverage</CardTitle>
                <CardDescription>Checks whether recent welcome deliveries include the fields needed for impression attribution fallback.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div>Welcome deliveries 7d: {diagnostic.impressionCoverageDebug?.welcomeDeliveries7d ?? 0}</div>
                <div>Deliveries with externalId: {diagnostic.impressionCoverageDebug?.welcomeDeliveriesWithExternalId7d ?? 0}</div>
                <div>Deliveries with userAgent: {diagnostic.impressionCoverageDebug?.welcomeDeliveriesWithUserAgent7d ?? 0}</div>
                <div>Missing externalId: {diagnostic.impressionCoverageDebug?.welcomeDeliveriesMissingExternalId7d ?? 0}</div>
                <div>Missing userAgent: {diagnostic.impressionCoverageDebug?.welcomeDeliveriesMissingUserAgent7d ?? 0}</div>
                <div>Clicks with IP + userAgent: {diagnostic.impressionCoverageDebug?.welcomeClicksWithIpAndUserAgent7d ?? 0}</div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Order Identity Namespaces</CardTitle>
              <CardDescription>Shows which identity namespace recent Shopify orders are landing in.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 text-sm md:grid-cols-2 xl:grid-cols-5">
              <div className="rounded-lg border p-3">Cart namespace: {diagnostic.orderIdentityNamespaceDebug?.cartNamespaceOrders7d ?? 0}</div>
              <div className="rounded-lg border p-3">Customer namespace: {diagnostic.orderIdentityNamespaceDebug?.customerNamespaceOrders7d ?? 0}</div>
              <div className="rounded-lg border p-3">Email namespace: {diagnostic.orderIdentityNamespaceDebug?.emailNamespaceOrders7d ?? 0}</div>
              <div className="rounded-lg border p-3">Anon namespace: {diagnostic.orderIdentityNamespaceDebug?.anonNamespaceOrders7d ?? 0}</div>
              <div className="rounded-lg border p-3">Other namespace: {diagnostic.orderIdentityNamespaceDebug?.otherNamespaceOrders7d ?? 0}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent Failed Ingestion Jobs</CardTitle>
              <CardDescription>These failures block order insertion and therefore block attribution revenue updates.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {(diagnostic.recentFailedIngestionJobs ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No failed shopify_order_create ingestion jobs.</p>
              ) : (
                diagnostic.recentFailedIngestionJobs.map((job) => (
                  <div key={job.id} className="rounded-lg border p-3 text-sm">
                    <div className="font-medium">jobId={job.id}</div>
                    <div>jobType={job.jobType}</div>
                    <div>attempts={job.attempts}</div>
                    <div>updatedAt={job.updatedAt ?? 'none'}</div>
                    <div className="break-all">error={job.errorMessage ?? 'none'}</div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent Pending Ingestion Jobs</CardTitle>
              <CardDescription>Pending jobs with error messages explain why attribution is delayed or retried.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {(diagnostic.recentPendingIngestionJobs ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No pending shopify_order_create ingestion jobs.</p>
              ) : (
                diagnostic.recentPendingIngestionJobs.map((job) => (
                  <div key={job.id} className="rounded-lg border p-3 text-sm">
                    <div className="font-medium">jobId={job.id}</div>
                    <div>jobType={job.jobType}</div>
                    <div>attempts={job.attempts}</div>
                    <div>dueAt={job.dueAt ?? 'none'}</div>
                    <div>updatedAt={job.updatedAt ?? 'none'}</div>
                    <div className="break-all">error={job.errorMessage ?? 'none'}</div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Recent Attributed Touches</CardTitle>
                <CardDescription>Each row shows which campaign or automation touch received revenue credit.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {(diagnostic.recentAttributedTouches ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No attributed touches recorded yet.</p>
                ) : (
                  diagnostic.recentAttributedTouches.slice(0, 20).map((touch, index) => (
                    <div key={`${touch.sourceType}-${touch.sourceId}-${touch.orderId}-${index}`} className="rounded-lg border p-3 text-sm">
                      <div className="font-medium">{touch.sourceType} - {touch.sourceId}</div>
                      <div>orderId={touch.orderId}</div>
                      <div>revenue={formatMoney(touch.revenueCents)}</div>
                      <div>occurredAt={touch.occurredAt ?? 'none'}</div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Recent Unattributed Orders</CardTitle>
                <CardDescription>Orders captured from Shopify but not matched to a qualifying touchpoint.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {(diagnostic.recentUnattributedOrders ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No unattributed orders in the current 7-day window.</p>
                ) : (
                  diagnostic.recentUnattributedOrders.slice(0, 20).map((order) => (
                    <div key={order.orderId} className="rounded-lg border p-3 text-sm">
                      <div className="font-medium">orderId={order.orderId}</div>
                      <div>value={formatMoney(order.totalPriceCents)}</div>
                      <div>createdAt={order.createdAt ?? 'none'}</div>
                      <div>externalId={order.externalId ?? 'none'}</div>
                      <div>customerId={order.customerId ?? 'none'}</div>
                      <div>email={order.email ?? 'none'}</div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Recent Welcome Delivery Debug</CardTitle>
                <CardDescription>Confirms whether delivered welcome rows carry the identity/fingerprint data impression attribution needs.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {(diagnostic.automationDeliveriesDebug ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No recent welcome delivery debug rows.</p>
                ) : (
                  (diagnostic.automationDeliveriesDebug ?? []).map((delivery) => (
                    <div key={delivery.deliveryId} className="rounded-lg border p-3 text-sm">
                      <div className="font-medium">deliveryId={delivery.deliveryId}</div>
                      <div>externalId={delivery.externalId || 'none'}</div>
                      <div>userAgent={delivery.userAgent || 'none'}</div>
                      <div>deliveredAt={delivery.deliveredAt ?? 'none'}</div>
                      <div>convertedAt={delivery.convertedAt ?? 'none'}</div>
                      <div>orderId={delivery.orderId ?? 'none'}</div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Unattributed Order Bridge Debug</CardTitle>
                <CardDescription>Shows whether recent unattributed orders have nearby bridge candidates through cart, same externalId, or historical customer identity.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {(diagnostic.unattributedOrderBridgeDebug ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No unattributed order bridge debug rows.</p>
                ) : (
                  (diagnostic.unattributedOrderBridgeDebug ?? []).map((order) => (
                    <div key={order.orderId} className="rounded-lg border p-3 text-sm">
                      <div className="font-medium">orderId={order.orderId}</div>
                      <div>externalId={order.externalId ?? 'none'}</div>
                      <div>derivedCartToken={order.derivedCartToken ?? 'none'}</div>
                      <div>sameExternalClickMatches={order.sameExternalClickMatches}</div>
                      <div>sameExternalDeliveryMatches={order.sameExternalDeliveryMatches}</div>
                      <div>cartActivityMatches={order.cartActivityMatches}</div>
                      <div>historicalCustomerExternalMatches={order.historicalCustomerExternalMatches}</div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Export</CardTitle>
              <CardDescription>Copy this full JSON and share it for exact attribution root-cause analysis.</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="max-h-80 overflow-auto rounded bg-muted p-3 text-xs whitespace-pre-wrap">
                {JSON.stringify(diagnostic, null, 2)}
              </pre>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

export default function DiagnosticPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6">
          <Card>
            <CardContent className="flex items-center justify-center py-10 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Loading diagnostics page...
            </CardContent>
          </Card>
        </div>
      }
    >
      <DiagnosticPageContent />
    </Suspense>
  );
}
