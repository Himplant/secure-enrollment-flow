import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, CircleDashed, Loader2, RefreshCw, Settings2, UserPlus, Users } from "lucide-react";
import { AccessCard } from "./AccessCard";
import { useIntlNetwork } from "./useIntlNetwork";
import { summarise, portalAccessState, countryLaunchState, SUPPORTED_COUNTRIES } from "@/lib/intlNetwork";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import { COUNTRY_FLAG, isCountryEnabled } from "@/lib/featureFlags";

const COUNTRY_NAME: Record<string, string> = { MX: "Mexico", CO: "Colombia", CL: "Chile" };

interface Props {
  onNavigate: (tab: string) => void;
  onSync: () => void;
  syncing: boolean;
}

function StepRow({ n, title, done, detail }: { n: number; title: string; done: boolean; detail: string }) {
  return (
    <div className="flex items-start gap-3 rounded-md border p-3">
      {done ? (
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
      ) : (
        <CircleDashed className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
      )}
      <div className="min-w-0">
        <p className="text-sm font-medium">
          {n}. {title}
        </p>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-2xl font-semibold">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}

export function OverviewSection({ onNavigate, onSync, syncing }: Props) {
  const { data, isLoading } = useIntlNetwork();
  const { flags } = useFeatureFlags();

  // One plain-English line per country: availability (feature flag) and the
  // real launch switch are combined so the operator never has to reason about
  // two separate toggles.
  const countryStates = data
    ? SUPPORTED_COUNTRIES.filter((c) => !!COUNTRY_FLAG[c]).map((c) =>
        countryLaunchState(data, c, isCountryEnabled(flags, c)),
      )
    : [];

  const s = data
    ? summarise(data)
    : { surgeons: 0, unassigned: 0, distributors: 0, portalUsers: 0, paymentReady: 0, countriesLive: 0 };

  const surgeonsWithPortal = data
    ? data.surgeons.filter(
        (su) =>
          portalAccessState(data.memberships.filter((m) => m.surgeon_id === su.id)) !== "none",
      ).length
    : 0;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold">International Consultations</h2>
        <p className="text-sm text-muted-foreground">
          Zoho supplies surgeons; Himplant assigns distributors and access; surgeons connect payments.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={onSync} disabled={syncing} className="gap-2">
          {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Sync from Zoho
        </Button>
        <Button size="sm" variant="outline" className="gap-2" onClick={() => onNavigate("network")}>
          <Users className="h-4 w-4" /> Manage network
        </Button>
        <Button size="sm" variant="outline" className="gap-2" onClick={() => onNavigate("access")}>
          <UserPlus className="h-4 w-4" /> Invite portal user
        </Button>
        <Button size="sm" variant="outline" className="gap-2" onClick={() => onNavigate("advanced")}>
          <Settings2 className="h-4 w-4" /> Advanced setup
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="International surgeons" value={isLoading ? "—" : s.surgeons} />
        <StatCard label="Surgeons without a distributor" value={isLoading ? "—" : s.unassigned} />
        <StatCard label="Active distributors" value={isLoading ? "—" : s.distributors} />
        <StatCard label="Portal users" value={isLoading ? "—" : s.portalUsers} />
        <StatCard label="Payment-ready surgeons" value={isLoading ? "—" : s.paymentReady} />
        <StatCard label="Countries open" value={isLoading ? "—" : s.countriesLive} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Countries</CardTitle>
          <CardDescription>
            A country is only open to real patients once it is switched on in Advanced setup →
            Launch readiness.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {countryStates.length === 0 && (
            <p className="text-sm text-muted-foreground">Loading country status…</p>
          )}
          {countryStates.map((c) => (
            <div key={c.country} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{COUNTRY_NAME[c.country] ?? c.country}</p>
                <p className="text-xs text-muted-foreground">
                  {c.blockers.length ? c.blockers.join(" · ") : "Nothing outstanding."}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={c.live && !c.blockers.length ? "default" : "secondary"}>{c.label}</Badge>
                <Button size="sm" variant="ghost" onClick={() => onNavigate("advanced")}>
                  Launch readiness
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Getting set up</CardTitle>
          <CardDescription>
            <Badge variant="secondary" className="mr-2">
              Source of truth
            </Badge>
            Zoho CRM is the source of truth for surgeon name and country.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <StepRow
            n={1}
            title="Sync surgeons from Zoho"
            done={s.surgeons > 0}
            detail={`${s.surgeons} international surgeon(s) recognised from the CRM.`}
          />
          <StepRow
            n={2}
            title="Assign each surgeon to a distributor"
            done={s.surgeons > 0 && s.unassigned === 0}
            detail={
              s.unassigned === 0
                ? "Everyone has a distributor."
                : `${s.unassigned} surgeon(s) still need one.`
            }
          />
          <StepRow
            n={3}
            title="Invite portal users"
            done={s.portalUsers > 0}
            detail={`${surgeonsWithPortal} of ${s.surgeons} practices have someone invited.`}
          />
          <StepRow
            n={4}
            title="Surgeons connect their payment account"
            done={s.surgeons > 0 && s.paymentReady === s.surgeons}
            detail={`${s.paymentReady} of ${s.surgeons} can be paid directly today.`}
          />
          <StepRow
            n={5}
            title="Country open for live consultations"
            done={s.countriesLive > 0}
            detail={
              s.countriesLive > 0
                ? `${s.countriesLive} country/countries open.`
                : "No country is open yet — see International → Advanced setup → Launch readiness."
            }
          />
        </CardContent>
      </Card>

      <AccessCard />
    </div>
  );
}
