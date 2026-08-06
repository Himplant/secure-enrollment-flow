import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Info } from "lucide-react";
import { IntlSurgeonsSection } from "./IntlSurgeonsSection";
import { ProviderAccountsSection } from "./ProviderAccountsSection";
import { DistributorsSection } from "./DistributorsSection";
import { IntlTermsSection } from "./IntlTermsSection";
import { PortalUsersSection } from "./PortalUsersSection";

function HowItWorks() {
  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Info className="h-4 w-4" /> How the international flow works
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground space-y-2">
        <p>
          Set up in this order:{" "}
          <strong>International surgeon (country + fee) → Payment account → Terms</strong>. Countries come from the
          CRM surgeon address, so a surgeon shows up here as soon as the CRM sync runs.
        </p>
        <ol className="list-decimal pl-5 space-y-1">
          <li>
            International tab → <strong>New consultation</strong>: pick the surgeon, enter the patient and fee, and
            copy the payment link.
          </li>
          <li>
            The patient opens <code>/consult/&lt;token&gt;</code>, accepts the terms and pays the surgeon directly.
          </li>
          <li>The consultation moves to awaiting contact and a follow-up task is created.</li>
          <li>
            People you invite under <strong>Portal users</strong> sign in at <code>/portal/login</code> to see their
            own consultations, mark contact/scheduling and resend links.
          </li>
        </ol>
        <p>Distributors are optional: they give a partner oversight of the surgeons assigned to them.</p>
      </CardContent>
    </Card>
  );
}

export function IntlSetupTab() {
  return (
    <div className="space-y-4">
      <HowItWorks />
      <Tabs defaultValue="surgeons">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="surgeons">International surgeons</TabsTrigger>
          <TabsTrigger value="accounts">Payment accounts</TabsTrigger>
          <TabsTrigger value="distributors">Distributors</TabsTrigger>
          <TabsTrigger value="terms">Terms</TabsTrigger>
          <TabsTrigger value="portal">Portal users</TabsTrigger>
        </TabsList>
        <TabsContent value="surgeons" className="mt-4">
          <IntlSurgeonsSection />
        </TabsContent>
        <TabsContent value="accounts" className="mt-4">
          <ProviderAccountsSection />
        </TabsContent>
        <TabsContent value="distributors" className="mt-4">
          <DistributorsSection />
        </TabsContent>
        <TabsContent value="terms" className="mt-4">
          <IntlTermsSection />
        </TabsContent>
        <TabsContent value="portal" className="mt-4">
          <PortalUsersSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}
