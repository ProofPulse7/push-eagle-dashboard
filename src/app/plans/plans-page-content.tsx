'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Check, Info, Loader2, Mail } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageLoadingShell } from '@/components/ui/loading-ui';
import { BUSINESS_TIERS, BASIC_PLAN } from '@/lib/client/billing-plans';
import { useBillingStatus, useConfirmBilling, useSubscribePlan } from '@/hooks/queries/use-billing';
import { useToast } from '@/hooks/use-toast';

const BUSINESS_FEATURES = [
  'All Basic features',
  'All automations',
  'Campaigns & scheduling',
  'Analytics & attribution',
  'Segments',
  'Smart delivery',
];

const BASIC_FEATURES = [
  '10,000 impressions / month',
  'Unlimited subscribers',
  'Campaigns & scheduling',
  'All automations',
  'Analytics',
  'Chat support',
];

export function PlansPageContent() {
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const { data, isLoading, isFetching } = useBillingStatus();
  const subscribe = useSubscribePlan();
  const confirmBilling = useConfirmBilling();
  const [tierIndex, setTierIndex] = useState(0);

  const billing = (data?.billing ?? null) as Record<string, unknown> | null;
  const currentPlanKey = String(billing?.planKey ?? 'basic');
  const currentTierId = billing?.tierId ? String(billing.tierId) : null;
  const impressionsUsed = Number(billing?.impressionsUsed ?? 0);
  const impressionLimit = Number(billing?.impressionLimit ?? BASIC_PLAN.impressions);
  const periodEnd = billing?.periodEnd ? new Date(String(billing.periodEnd)) : null;

  const selectedTier = BUSINESS_TIERS[tierIndex] ?? BUSINESS_TIERS[0];

  useEffect(() => {
    if (currentTierId) {
      const index = BUSINESS_TIERS.findIndex((tier) => tier.id === currentTierId);
      if (index >= 0) {
        setTierIndex(index);
      }
    }
  }, [currentTierId]);

  const billingReturnHandled = useRef(false);
  useEffect(() => {
    if (searchParams.get('billing') !== 'return' || billingReturnHandled.current) {
      return;
    }
    billingReturnHandled.current = true;
    confirmBilling.mutate(undefined, {
      onSuccess: (result) => {
        if (result?.activated) {
          toast({ title: 'Plan activated', description: 'Your Business plan is now active.' });
        }
      },
      onError: () => {
        toast({
          variant: 'destructive',
          title: 'Billing confirmation pending',
          description: 'Complete approval in Shopify if you have not already.',
        });
      },
    });
  }, [searchParams, confirmBilling, toast]);

  const resetLabel = useMemo(() => {
    if (!periodEnd) {
      return 'Resets on the 1st of each month';
    }
    return `Resets ${periodEnd.toLocaleString()}`;
  }, [periodEnd]);

  const handleSubscribeBasic = () => {
    subscribe.mutate(
      { planKey: 'basic' },
      {
        onSuccess: () => {
          toast({ title: 'Basic plan active', description: 'You are on the free Basic plan.' });
        },
        onError: (error) => {
          toast({
            variant: 'destructive',
            title: 'Could not activate Basic',
            description: error instanceof Error ? error.message : 'Try again.',
          });
        },
      },
    );
  };

  const handleSubscribeBusiness = () => {
    subscribe.mutate(
      { planKey: 'business', tierId: selectedTier.id },
      {
        onSuccess: (result) => {
          if (result?.confirmationUrl) {
            window.top?.location.assign(result.confirmationUrl);
            return;
          }
          toast({ title: 'Business plan active', description: 'Your plan is ready to use.' });
        },
        onError: (error) => {
          toast({
            variant: 'destructive',
            title: 'Could not start checkout',
            description: error instanceof Error ? error.message : 'Try again.',
          });
        },
      },
    );
  };

  const usagePercent = impressionLimit > 0 ? Math.min(100, (impressionsUsed / impressionLimit) * 100) : 0;

  return (
    <PageLoadingShell
      title="Plans"
      isLoading={isLoading}
      hasData={Boolean(data)}
      isFetching={isFetching}
    >
      <div className="p-4 sm:p-6 md:p-8 flex flex-col gap-8 pe-page-enter">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Plans</h1>
          <p className="text-muted-foreground mt-1">
            Impressions include manual campaigns and automation sends. {resetLabel}.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">This month&apos;s usage</CardTitle>
            <CardDescription>
              {impressionsUsed.toLocaleString()} / {impressionLimit.toLocaleString()} impressions
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-primary transition-all duration-300" style={{ width: `${usagePercent}%` }} />
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-stretch">
          <Card className={cn('flex flex-col pe-pressable', currentPlanKey === 'basic' && 'border-primary ring-2 ring-primary/30')}>
            <CardHeader className="bg-muted/40">
              <CardTitle>Basic</CardTitle>
              <CardDescription>Free — perfect to get started</CardDescription>
            </CardHeader>
            <CardContent className="flex-grow pt-6 space-y-4">
              <p className="text-4xl font-bold">
                $0<span className="text-base font-normal text-muted-foreground">/mo</span>
              </p>
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Info className="h-4 w-4" />
                {BASIC_PLAN.impressions.toLocaleString()} impressions per month
              </p>
              <ul className="space-y-2 text-sm">
                {BASIC_FEATURES.map((feature) => (
                  <li key={feature} className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-green-500" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
            <CardFooter>
              <Button
                className="w-full pe-pressable"
                variant={currentPlanKey === 'basic' ? 'secondary' : 'default'}
                disabled={currentPlanKey === 'basic' || subscribe.isPending}
                onClick={handleSubscribeBasic}
              >
                {currentPlanKey === 'basic' ? 'Current plan' : subscribe.isPending ? 'Processing…' : 'Subscribe free'}
              </Button>
            </CardFooter>
          </Card>

          <Card className={cn('flex flex-col pe-pressable', currentPlanKey === 'business' && 'border-primary ring-2 ring-primary/30')}>
            <CardHeader className="bg-primary text-primary-foreground rounded-t-lg">
              <CardTitle>Business</CardTitle>
              <CardDescription className="text-primary-foreground/80">
                Scale with higher monthly impression limits
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-grow pt-6 space-y-5">
              <p className="text-4xl font-bold">
                ${selectedTier.priceUsd}
                <span className="text-base font-normal text-muted-foreground">/mo</span>
              </p>
              <Slider
                value={[tierIndex]}
                max={BUSINESS_TIERS.length - 1}
                step={1}
                onValueChange={(value) => setTierIndex(value[0] ?? 0)}
              />
              <p className="text-sm font-medium flex items-center gap-2">
                {selectedTier.impressions.toLocaleString()} impressions / month
              </p>
              <ul className="space-y-2 text-sm">
                {BUSINESS_FEATURES.map((feature) => (
                  <li key={feature} className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-green-500" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
            <CardFooter>
              <Button
                className="w-full pe-pressable"
                disabled={
                  (currentPlanKey === 'business' && currentTierId === selectedTier.id) ||
                  subscribe.isPending
                }
                onClick={handleSubscribeBusiness}
              >
                {subscribe.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Redirecting to Shopify…
                  </>
                ) : currentPlanKey === 'business' && currentTierId === selectedTier.id ? (
                  'Current plan'
                ) : (
                  'Subscribe'
                )}
              </Button>
            </CardFooter>
          </Card>
        </div>

        <Card className="pe-pressable">
          <CardContent className="flex flex-col md:flex-row items-center justify-between gap-6 p-8">
            <div className="space-y-2">
              <CardTitle className="text-2xl">Custom Enterprise</CardTitle>
              <CardDescription>
                Need more than 1M impressions or custom terms? Contact us for custom pricing.
              </CardDescription>
            </div>
            <Button size="lg" variant="outline" className="pe-pressable" asChild>
              <a href="mailto:support@push-eagle.com">
                <Mail className="mr-2 h-5 w-5" />
                Contact for custom pricing
              </a>
            </Button>
          </CardContent>
        </Card>
      </div>
    </PageLoadingShell>
  );
}
