import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Info } from "lucide-react";
import { DistributorsSection } from "./DistributorsSection";
import { RegionsSection } from "./RegionsSection";
import { ClinicsSection } from "./ClinicsSection";
import { ClinicSurgeonsSection } from "./ClinicSurgeonsSection";
import { ProviderAccountsSection } from "./ProviderAccountsSection";
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
          Set up in this order: <strong>Distributor → Region → Clinic → Clinic surgeons → Payment account → Terms</strong>.
          Once a clinic has at least one surgeon and a payment account, it appears in the International tab.
        </p>
        <ol className="list-decimal pl-5 space-y-1">
          <li>International tab → <strong>New consultation</strong>: pick the clinic and surgeon, enter the patient and fee, and copy the payment link.</li>
          <li>The patient opens <code>/consult/&lt;token&gt;</code>, accepts the terms and pays.</li>
          <li>The consultation moves to <em>awaiting clinic contact</em> and a follow-up task is created.</li>
          <li>Clinic staff you invite under <strong>Portal users</strong> sign in at <code>/portal/login</code> to see their own consultations, mark contact/scheduling and resend links.</li>
        </ol>
        <p>Surgeon country comes from the CRM Surgeons module — run "Sync from Zoho" on the Surgeons tab to refresh it.</p>
      </CardContent>
    </Card>
  );
}

export function IntlSetupTab() {
  return (
    <div className="space-y-4">
      <HowItWorks />
      <Tabs defaultValue="clinics" className="space-y-4">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="clinics">Clinics</TabsTrigger>
          <TabsTrigger value="surgeons">Clinic surgeons</TabsTrigger>
          <TabsTrigger value="accounts">Payment accounts</TabsTrigger>
          <TabsTrigger value="distributors">Distributors</TabsTrigger>
          <TabsTrigger value="regions">Regions</TabsTrigger>
          <TabsTrigger value="terms">Terms</TabsTrigger>
          <TabsTrigger value="portal">Portal users</TabsTrigger>
        </TabsList>
        <TabsContent value="clinics"><ClinicsSection /></TabsContent>
        <TabsContent value="surgeons"><ClinicSurgeonsSection /></TabsContent>
        <TabsContent value="accounts"><ProviderAccountsSection /></TabsContent>
        <TabsContent value="distributors"><DistributorsSection /></TabsContent>
        <TabsContent value="regions"><RegionsSection /></TabsContent>
        <TabsContent value="terms"><IntlTermsSection /></TabsContent>
        <TabsContent value="portal"><PortalUsersSection /></TabsContent>
      </Tabs>
    </div>
  );
}
