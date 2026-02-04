import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { RefreshCw, Plus, Pencil, UserCog, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";


interface Surgeon {
  id: string;
  zoho_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  specialty: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface SurgeonFormData {
  name: string;
  email: string;
  phone: string;
  specialty: string;
}

const initialFormData: SurgeonFormData = {
  name: "",
  email: "",
  phone: "",
  specialty: "",
};

export function SurgeonManagement() {
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSurgeon, setEditingSurgeon] = useState<Surgeon | null>(null);
  const [formData, setFormData] = useState<SurgeonFormData>(initialFormData);
  const [isSyncing, setIsSyncing] = useState(false);

  const { data: surgeons = [], isLoading } = useQuery({
    queryKey: ["surgeons-management"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("surgeons")
        .select("*")
        .order("name");

      if (error) throw error;
      return data as Surgeon[];
    },
  });

  const addMutation = useMutation({
    mutationFn: async (data: SurgeonFormData) => {
      const { error } = await supabase.from("surgeons").insert({
        zoho_id: `manual_${Date.now()}`,
        name: data.name,
        email: data.email || null,
        phone: data.phone || null,
        specialty: data.specialty || null,
        is_active: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["surgeons-management"] });
      queryClient.invalidateQueries({ queryKey: ["surgeons"] });
      toast.success("Surgeon added successfully");
      closeModal();
    },
    onError: (error) => {
      toast.error(`Failed to add surgeon: ${error.message}`);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: SurgeonFormData }) => {
      const { error } = await supabase
        .from("surgeons")
        .update({
          name: data.name,
          email: data.email || null,
          phone: data.phone || null,
          specialty: data.specialty || null,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["surgeons-management"] });
      queryClient.invalidateQueries({ queryKey: ["surgeons"] });
      toast.success("Surgeon updated successfully");
      closeModal();
    },
    onError: (error) => {
      toast.error(`Failed to update surgeon: ${error.message}`);
    },
  });

  const handleSyncFromZoho = async () => {
    setIsSyncing(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;

      if (!accessToken) {
        toast.error("Not authenticated");
        return;
      }

      const response = await supabase.functions.invoke("sync-surgeons", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

      const data = response.data as { created: number; updated: number; total: number };
      toast.success(
        `Synced ${data.total} surgeons (${data.created} new, ${data.updated} updated)`
      );
      queryClient.invalidateQueries({ queryKey: ["surgeons-management"] });
      queryClient.invalidateQueries({ queryKey: ["surgeons"] });
    } catch (error) {
      console.error("Sync error:", error);
      toast.error(
        `Failed to sync surgeons: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    } finally {
      setIsSyncing(false);
    }
  };

  const openEditModal = (surgeon: Surgeon) => {
    setEditingSurgeon(surgeon);
    setFormData({
      name: surgeon.name,
      email: surgeon.email || "",
      phone: surgeon.phone || "",
      specialty: surgeon.specialty || "",
    });
    setIsModalOpen(true);
  };

  const openAddModal = () => {
    setEditingSurgeon(null);
    setFormData(initialFormData);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingSurgeon(null);
    setFormData(initialFormData);
  };

  const handleSubmit = () => {
    if (!formData.name.trim()) {
      toast.error("Surgeon name is required");
      return;
    }

    if (editingSurgeon) {
      updateMutation.mutate({ id: editingSurgeon.id, data: formData });
    } else {
      addMutation.mutate(formData);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Surgeons</h2>
          <p className="text-sm text-muted-foreground">
            Manage surgeons from Zoho CRM or add manually
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleSyncFromZoho}
            disabled={isSyncing}
          >
            {isSyncing ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Sync from Zoho
          </Button>
          <Button onClick={openAddModal}>
            <Plus className="h-4 w-4 mr-2" />
            Add Surgeon
          </Button>
        </div>
      </div>

      {surgeons.length === 0 ? (
        <div className="text-center py-12 border rounded-lg bg-muted/20">
          <UserCog className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium mb-2">No surgeons yet</h3>
          <p className="text-muted-foreground mb-4">
            Sync surgeons from Zoho or add them manually
          </p>
          <div className="flex justify-center gap-2">
            <Button variant="outline" onClick={handleSyncFromZoho}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Sync from Zoho
            </Button>
            <Button onClick={openAddModal}>
              <Plus className="h-4 w-4 mr-2" />
              Add Manually
            </Button>
          </div>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Specialty</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {surgeons.map((surgeon) => (
                <TableRow key={surgeon.id}>
                  <TableCell className="font-medium">{surgeon.name}</TableCell>
                  <TableCell>
                    {surgeon.specialty || (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">
                      {surgeon.email && <div>{surgeon.email}</div>}
                      {surgeon.phone && (
                        <div className="text-muted-foreground">
                          {surgeon.phone}
                        </div>
                      )}
                      {!surgeon.email && !surgeon.phone && (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {surgeon.zoho_id.startsWith("manual_") ? "Manual" : "Zoho"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={surgeon.is_active ? "default" : "secondary"}>
                      {surgeon.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEditModal(surgeon)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Add/Edit Modal */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingSurgeon ? "Edit Surgeon" : "Add Surgeon"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="surgeon-name">Name *</Label>
              <Input
                id="surgeon-name"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                placeholder="Dr. John Smith"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="surgeon-specialty">Specialty</Label>
              <Input
                id="surgeon-specialty"
                value={formData.specialty}
                onChange={(e) =>
                  setFormData({ ...formData, specialty: e.target.value })
                }
                placeholder="e.g., Plastic Surgery"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="surgeon-email">Email</Label>
                <Input
                  id="surgeon-email"
                  type="email"
                  value={formData.email}
                  onChange={(e) =>
                    setFormData({ ...formData, email: e.target.value })
                  }
                  placeholder="doctor@example.com"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="surgeon-phone">Phone</Label>
                <Input
                  id="surgeon-phone"
                  type="tel"
                  value={formData.phone}
                  onChange={(e) =>
                    setFormData({ ...formData, phone: e.target.value })
                  }
                  placeholder="+1 (555) 000-0000"
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeModal}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={addMutation.isPending || updateMutation.isPending}
            >
              {(addMutation.isPending || updateMutation.isPending) && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {editingSurgeon ? "Save Changes" : "Add Surgeon"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
