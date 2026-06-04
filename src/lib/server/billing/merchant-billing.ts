import { getNeonSql } from '@/lib/integrations/database/neon';
import { BASIC_PLAN, getBillingPeriodEnd, getBillingPeriodStart, type PlanKey } from '@/lib/server/billing/plans';
import { ensureMerchantAccount } from '@/lib/server/data/store';

export type MerchantBillingRecord = {
  shopDomain: string;
  planKey: PlanKey;
  tierId: string | null;
  impressionLimit: number;
  priceUsd: number;
  shopifySubscriptionId: string | null;
  status: string;
  periodStart: string;
  periodEnd: string;
  impressionsUsed: number;
};

const ensureBillingSchema = async (shopDomain: string) => {
  await ensureMerchantAccount(shopDomain);
  const sql = getNeonSql();
  await sql`
    CREATE TABLE IF NOT EXISTS merchant_billing (
      shop_domain TEXT PRIMARY KEY REFERENCES merchants(shop_domain) ON DELETE CASCADE,
      plan_key TEXT NOT NULL DEFAULT 'basic',
      tier_id TEXT,
      impression_limit INTEGER NOT NULL DEFAULT 10000,
      price_usd NUMERIC(10,2) NOT NULL DEFAULT 0,
      shopify_subscription_id TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      period_start TIMESTAMPTZ NOT NULL,
      period_end TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
};

export const countImpressionsForPeriod = async (shopDomain: string, periodStart: Date, periodEnd: Date) => {
  await ensureBillingSchema(shopDomain);
  const sql = getNeonSql();
  const rows = await sql`
    SELECT
      (
        SELECT COUNT(*)::BIGINT
        FROM campaign_deliveries
        WHERE shop_domain = ${shopDomain}
          AND created_at >= ${periodStart}
          AND created_at < ${periodEnd}
      ) +
      (
        SELECT COUNT(*)::BIGINT
        FROM automation_deliveries
        WHERE shop_domain = ${shopDomain}
          AND created_at >= ${periodStart}
          AND created_at < ${periodEnd}
      ) AS total
  `;
  return Number(rows[0]?.total ?? 0);
};

export const getMerchantBilling = async (shopDomain: string): Promise<MerchantBillingRecord> => {
  await ensureBillingSchema(shopDomain);
  const sql = getNeonSql();
  const periodStart = getBillingPeriodStart();
  const periodEnd = getBillingPeriodEnd(periodStart);

  const rows = await sql`
    SELECT *
    FROM merchant_billing
    WHERE shop_domain = ${shopDomain}
    LIMIT 1
  `;

  if (!rows[0]) {
    await sql`
      INSERT INTO merchant_billing (
        shop_domain,
        plan_key,
        tier_id,
        impression_limit,
        price_usd,
        status,
        period_start,
        period_end
      )
      VALUES (
        ${shopDomain},
        ${BASIC_PLAN.key},
        NULL,
        ${BASIC_PLAN.impressions},
        ${BASIC_PLAN.priceUsd},
        'active',
        ${periodStart},
        ${periodEnd}
      )
      ON CONFLICT (shop_domain) DO NOTHING
    `;
    return getMerchantBilling(shopDomain);
  }

  const row = rows[0] as Record<string, unknown>;
  const storedStart = new Date(String(row.period_start));
  const now = new Date();

  if (now >= new Date(String(row.period_end))) {
    const nextStart = getBillingPeriodStart(now);
    const nextEnd = getBillingPeriodEnd(nextStart);
    await sql`
      UPDATE merchant_billing
      SET
        period_start = ${nextStart},
        period_end = ${nextEnd},
        updated_at = NOW()
      WHERE shop_domain = ${shopDomain}
    `;
    row.period_start = nextStart.toISOString();
    row.period_end = nextEnd.toISOString();
  }

  const impressionsUsed = await countImpressionsForPeriod(
    shopDomain,
    new Date(String(row.period_start)),
    new Date(String(row.period_end)),
  );

  return {
    shopDomain,
    planKey: String(row.plan_key) as PlanKey,
    tierId: row.tier_id ? String(row.tier_id) : null,
    impressionLimit: Number(row.impression_limit ?? BASIC_PLAN.impressions),
    priceUsd: Number(row.price_usd ?? 0),
    shopifySubscriptionId: row.shopify_subscription_id ? String(row.shopify_subscription_id) : null,
    status: String(row.status ?? 'active'),
    periodStart: String(row.period_start),
    periodEnd: String(row.period_end),
    impressionsUsed,
  };
};

export const upsertMerchantBilling = async (input: {
  shopDomain: string;
  planKey: PlanKey;
  tierId?: string | null;
  impressionLimit: number;
  priceUsd: number;
  shopifySubscriptionId?: string | null;
  status?: string;
}) => {
  await ensureBillingSchema(input.shopDomain);
  const sql = getNeonSql();
  const periodStart = getBillingPeriodStart();
  const periodEnd = getBillingPeriodEnd(periodStart);

  await sql`
    INSERT INTO merchant_billing (
      shop_domain,
      plan_key,
      tier_id,
      impression_limit,
      price_usd,
      shopify_subscription_id,
      status,
      period_start,
      period_end,
      updated_at
    )
    VALUES (
      ${input.shopDomain},
      ${input.planKey},
      ${input.tierId ?? null},
      ${input.impressionLimit},
      ${input.priceUsd},
      ${input.shopifySubscriptionId ?? null},
      ${input.status ?? 'active'},
      ${periodStart},
      ${periodEnd},
      NOW()
    )
    ON CONFLICT (shop_domain) DO UPDATE SET
      plan_key = EXCLUDED.plan_key,
      tier_id = EXCLUDED.tier_id,
      impression_limit = EXCLUDED.impression_limit,
      price_usd = EXCLUDED.price_usd,
      shopify_subscription_id = COALESCE(EXCLUDED.shopify_subscription_id, merchant_billing.shopify_subscription_id),
      status = EXCLUDED.status,
      period_start = EXCLUDED.period_start,
      period_end = EXCLUDED.period_end,
      updated_at = NOW()
  `;

  return getMerchantBilling(input.shopDomain);
};

export const assertCanSendNotifications = async (shopDomain: string, requestedCount = 1) => {
  const billing = await getMerchantBilling(shopDomain);
  if (billing.status !== 'active' && billing.status !== 'pending') {
    throw new Error('Your subscription is not active. Open Plans to subscribe again.');
  }

  const remaining = billing.impressionLimit - billing.impressionsUsed;
  if (remaining < requestedCount) {
    throw new Error(
      `Monthly impression limit reached (${billing.impressionsUsed.toLocaleString()} / ${billing.impressionLimit.toLocaleString()}). Upgrade your plan to send more notifications.`,
    );
  }

  return billing;
};
