import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, Star, FileText, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

interface Policy {
  id: string;
  name: string;
  description: string | null;
  terms_url: string;
  privacy_url: string;
  terms_text: string | null;
  privacy_text: string | null;
  version: string;
  terms_content_sha256: string;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface PolicyFormData {
  name: string;
  description: string;
  terms_url: string;
  privacy_url: string;
  terms_text: string;
  privacy_text: string;
  version: string;
  is_default: boolean;
  is_active: boolean;
}

const initialFormData: PolicyFormData = {
  name: "",
  description: "",
  terms_url: "",
  privacy_url: "",
  terms_text: "",
  privacy_text: "",
  version: "1.0",
  is_default: false,
  is_active: true,
};

async function computeSha256(text: string): Promise<string> {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return "placeholder-hash";
  }
}

export function PoliciesTab() {
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<Policy | null>(null);
  const [deletePolicy, setDeletePolicy] = useState<Policy | null>(null);
  const [formData, setFormData] = useState<PolicyFormData>(initialFormData);

  const { data: policies = [], isLoading } = useQuery({
    queryKey: ["policies"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("policies")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as Policy[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: PolicyFormData) => {
      const sha256 = await computeSha256(data.terms_text);
      const { error } = await supabase.from("policies").insert({
        name: data.name,
        description: data.description || null,
        terms_url: data.terms_url,
        privacy_url: data.privacy_url,
        terms_text: data.terms_text || null,
        privacy_text: data.privacy_text || null,
        version: data.version,
        terms_content_sha256: sha256,
        is_default: data.is_default,
        is_active: data.is_active,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["policies"] });
      toast.success("Policy created successfully");
      closeModal();
    },
    onError: (error) => {
      toast.error(`Failed to create policy: ${error.message}`);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: PolicyFormData }) => {
      const sha256 = await computeSha256(data.terms_text);
      const { error } = await supabase
        .from("policies")
        .update({
          name: data.name,
          description: data.description || null,
          terms_url: data.terms_url,
          privacy_url: data.privacy_url,
          terms_text: data.terms_text || null,
          privacy_text: data.privacy_text || null,
          version: data.version,
          terms_content_sha256: sha256,
          is_default: data.is_default,
          is_active: data.is_active,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["policies"] });
      toast.success("Policy updated successfully");
      closeModal();
    },
    onError: (error) => {
      toast.error(`Failed to update policy: ${error.message}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("policies").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["policies"] });
      toast.success("Policy deleted successfully");
      setDeletePolicy(null);
    },
    onError: (error) => {
      toast.error(`Failed to delete policy: ${error.message}`);
    },
  });

  const setDefaultMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("policies")
        .update({ is_default: true })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["policies"] });
      toast.success("Default policy updated");
    },
    onError: (error) => {
      toast.error(`Failed to set default: ${error.message}`);
    },
  });

  const openCreateModal = () => {
    setEditingPolicy(null);
    setFormData(initialFormData);
    setIsModalOpen(true);
  };

  const openEditModal = (policy: Policy) => {
    setEditingPolicy(policy);
    setFormData({
      name: policy.name,
      description: policy.description || "",
      terms_url: policy.terms_url,
      privacy_url: policy.privacy_url,
      terms_text: policy.terms_text || "",
      privacy_text: policy.privacy_text || "",
      version: policy.version,
      is_default: policy.is_default,
      is_active: policy.is_active,
    });
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingPolicy(null);
    setFormData(initialFormData);
  };

  const handleSubmit = () => {
    if (!formData.name || !formData.terms_text || !formData.privacy_text || !formData.version) {
      toast.error("Please fill in all required fields (name, terms text, privacy text, version)");
      return;
    }

    if (editingPolicy) {
      updateMutation.mutate({ id: editingPolicy.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Payment Policies</h2>
          <p className="text-sm text-muted-foreground">
            Manage terms and privacy policies for payment links
          </p>
        </div>
        <Button onClick={openCreateModal}>
          <Plus className="h-4 w-4 mr-2" />
          Add Policy
        </Button>
      </div>

      {policies.length === 0 ? (
        <div className="text-center py-12 border rounded-lg bg-muted/20">
          <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium mb-2">No policies yet</h3>
          <p className="text-muted-foreground mb-4">
            Create your first policy to associate with payment links
          </p>
          <Button onClick={openCreateModal}>
            <Plus className="h-4 w-4 mr-2" />
            Create Policy
          </Button>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Links</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {policies.map((policy) => (
                <TableRow key={policy.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{policy.name}</span>
                      {policy.is_default && (
                        <Badge variant="secondary" className="gap-1">
                          <Star className="h-3 w-3" />
                          Default
                        </Badge>
                      )}
                    </div>
                    {policy.description && (
                      <p className="text-sm text-muted-foreground truncate max-w-xs">
                        {policy.description}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">v{policy.version}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={policy.is_active ? "default" : "secondary"}>
                      {policy.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <a
                        href={policy.terms_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                      >
                        Terms
                        <ExternalLink className="h-3 w-3" />
                      </a>
                      <a
                        href={policy.privacy_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                      >
                        Privacy
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {format(new Date(policy.updated_at), "MMM d, yyyy")}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      {!policy.is_default && policy.is_active && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDefaultMutation.mutate(policy.id)}
                          disabled={setDefaultMutation.isPending}
                        >
                          <Star className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEditModal(policy)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeletePolicy(policy)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Create/Edit Modal */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingPolicy ? "Edit Policy" : "Create Policy"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Policy Name *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  placeholder="e.g., Standard Terms v1"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="version">Version *</Label>
                <Input
                  id="version"
                  value={formData.version}
                  onChange={(e) =>
                    setFormData({ ...formData, version: e.target.value })
                  }
                  placeholder="1.0"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                placeholder="Brief description of this policy..."
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="terms_text">Terms of Service Text *</Label>
              <Textarea
                id="terms_text"
                value={formData.terms_text}
                onChange={(e) =>
                  setFormData({ ...formData, terms_text: e.target.value })
                }
                placeholder="Enter the full terms of service text..."
                rows={8}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                This exact text will be shown to users and stored for dispute records
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="privacy_text">Privacy Policy Text *</Label>
              <Textarea
                id="privacy_text"
                value={formData.privacy_text}
                onChange={(e) =>
                  setFormData({ ...formData, privacy_text: e.target.value })
                }
                placeholder="Enter the full privacy policy text..."
                rows={8}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                This exact text will be shown to users and stored for dispute records
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="terms_url">Terms URL (optional)</Label>
                <Input
                  id="terms_url"
                  type="url"
                  value={formData.terms_url}
                  onChange={(e) =>
                    setFormData({ ...formData, terms_url: e.target.value })
                  }
                  placeholder="https://example.com/terms"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="privacy_url">Privacy URL (optional)</Label>
                <Input
                  id="privacy_url"
                  type="url"
                  value={formData.privacy_url}
                  onChange={(e) =>
                    setFormData({ ...formData, privacy_url: e.target.value })
                  }
                  placeholder="https://example.com/privacy"
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Active</Label>
                <p className="text-xs text-muted-foreground">
                  Only active policies can be used
                </p>
              </div>
              <Switch
                checked={formData.is_active}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, is_active: checked })
                }
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Set as Default</Label>
                <p className="text-xs text-muted-foreground">
                  Used when creating new payment links
                </p>
              </div>
              <Switch
                checked={formData.is_default}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, is_default: checked })
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeModal}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {createMutation.isPending || updateMutation.isPending
                ? "Saving..."
                : editingPolicy
                ? "Update Policy"
                : "Create Policy"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog
        open={!!deletePolicy}
        onOpenChange={() => setDeletePolicy(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Policy</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deletePolicy?.name}"? This
              action cannot be undone. Existing payment links using this policy
              will retain their terms data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletePolicy && deleteMutation.mutate(deletePolicy.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
