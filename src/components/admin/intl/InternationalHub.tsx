import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { OverviewSection } from "./hub/OverviewSection";
import { NetworkSection } from "./hub/NetworkSection";
import { PortalAccessSection, type InviteTarget } from "./hub/PortalAccessSection";
import { AdvancedSetupSection } from "./hub/AdvancedSetupSection";
import { ConsultationsTab } from "./ConsultationsTab";

interface Props {
  /** Himplant admin role — only super admins may change the network. */
  adminRole?: string | null;
}

export function InternationalHub({ adminRole }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState("overview");
  const [syncing, setSyncing] = useState(false);
  const [inviteTarget, setInviteTarget] = useState<InviteTarget | null>(null);

  const canManage = adminRole === "super_admin";

  /** Calls the existing CRM sync function unchanged, then refreshes the hub. */
  const syncFromZoho = useCallback(async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("sync-surgeons", { body: {} });
      if (error) throw error;
      const res = (data ?? {}) as { created?: number; updated?: number; error?: string };
      if (res.error) throw new Error(res.error);
      toast({
        title: "Synced with Zoho",
        description:
          res.created === undefined && res.updated === undefined
            ? "Surgeon records are up to date."
            : `${res.created ?? 0} added, ${res.updated ?? 0} updated.`,
      });
      qc.invalidateQueries({ queryKey: ["intl-network"] });
    } catch (e) {
      toast({
        title: "Sync failed",
        description: e instanceof Error ? e.message : "Unexpected error",
        variant: "destructive",
      });
    } finally {
      setSyncing(false);
    }
  }, [qc, toast]);

  const openInvite = useCallback((target: InviteTarget) => {
    setInviteTarget(target);
    setTab("access");
  }, []);

  return (
    <Tabs value={tab} onValueChange={setTab} className="space-y-4">
      <TabsList className="h-auto flex-wrap">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="consultations">Consultations</TabsTrigger>
        <TabsTrigger value="network">Network</TabsTrigger>
        <TabsTrigger value="access">Portal access</TabsTrigger>
        <TabsTrigger value="advanced">Advanced setup</TabsTrigger>
      </TabsList>

      <TabsContent value="overview">
        <OverviewSection onNavigate={setTab} onSync={syncFromZoho} syncing={syncing} />
      </TabsContent>
      <TabsContent value="consultations">
        <ConsultationsTab />
      </TabsContent>
      <TabsContent value="network">
        <NetworkSection onSync={syncFromZoho} syncing={syncing} canManage={canManage} onInvite={openInvite} />
      </TabsContent>
      <TabsContent value="access">
        <PortalAccessSection inviteTarget={inviteTarget} onInviteHandled={() => setInviteTarget(null)} />
      </TabsContent>
      <TabsContent value="advanced">
        <AdvancedSetupSection />
      </TabsContent>
    </Tabs>
  );
}
