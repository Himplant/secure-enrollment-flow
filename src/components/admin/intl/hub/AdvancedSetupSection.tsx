import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ShieldAlert } from "lucide-react";
import { ProviderSetupPanel } from "@/components/providers/ProviderSetupPanel";
import { IntlTermsSection } from "../setup/IntlTermsSection";
import { LaunchReadinessSection } from "../setup/LaunchReadinessSection";
import { PortalTestCenter } from "../setup/PortalTestCenter";

/** Everything technical, tucked away from the day-to-day network workflow. */
export function AdvancedSetupSection() {
  return (
    <div className="space-y-4">
      <Alert>
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>Advanced — Himplant admins only</AlertTitle>
        <AlertDescription>
          These settings are configured once per country or provider. You do not need them for day-to-day work.
        </AlertDescription>
      </Alert>

      <Accordion type="single" collapsible className="space-y-3">
        <AccordionItem value="providers" className="rounded-lg border px-4">
          <AccordionTrigger className="text-sm font-medium">Payment provider platform setup</AccordionTrigger>
          <AccordionContent className="pt-2">
            <ProviderSetupPanel scope="admin" />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="terms" className="rounded-lg border px-4">
          <AccordionTrigger className="text-sm font-medium">Terms &amp; policies</AccordionTrigger>
          <AccordionContent className="pt-2">
            <IntlTermsSection />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="readiness" className="rounded-lg border px-4">
          <AccordionTrigger className="text-sm font-medium">Country launch readiness</AccordionTrigger>
          <AccordionContent className="pt-2">
            <LaunchReadinessSection />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="qa" className="rounded-lg border px-4">
          <AccordionTrigger className="text-sm font-medium">Portal Test Center</AccordionTrigger>
          <AccordionContent className="pt-2">
            <PortalTestCenter />
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
