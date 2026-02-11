import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { 
  MoreHorizontal, 
  Plus, 
  Edit, 
  History, 
  Loader2,
  User,
  Mail,
  Phone,
  Trash2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { CreateEnrollmentModal } from "./CreateEnrollmentModal";
import { PatientHistoryModal } from "./PatientHistoryModal";
import { ImportPatientsModal } from "./ImportPatientsModal";
import { SurgeonSelect } from "./SurgeonSelect";
import { DeleteConfirmationDialog } from "./DeleteConfirmationDialog";

interface Patient {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  surgeon_id: string | null;
  surgeon?: { id: string; name: string } | null;
  created_at: string;
  updated_at: string;
  total_paid: number;
  enrollment_count: number;
}

export function PatientsTab() {
  const [search, setSearch] = useState("");
  const [editPatient, setEditPatient] = useState<Patient | null>(null);
  const [historyPatient, setHistoryPatient] = useState<Patient | null>(null);
  const [createForPatient, setCreateForPatient] = useState<Patient | null>(null);
  const [addPatientOpen, setAddPatientOpen] = useState(false);
  const [newPatient, setNewPatient] = useState({ name: "", email: "", phone: "", surgeon_id: null as string | null });
  const [deletePatient2, setDeletePatient2] = useState<Patient | null>(null);
  const { toast } = useToast();
  const { user } = useAdminAuth();
  const queryClient = useQueryClient();

  // Fetch patients with aggregated enrollment data
  const { data: patients, isLoading } = useQuery({
    queryKey: ["patients"],
    queryFn: async () => {
      // Get all patients with surgeon info
      const { data: patientsData, error: patientsError } = await supabase
        .from("patients")
        .select("*, surgeon:surgeons(id, name)")
        .order("created_at", { ascending: false });

      if (patientsError) throw patientsError;

      // Get enrollment aggregates per patient
      const { data: enrollmentsData, error: enrollmentsError } = await supabase
        .from("enrollments")
        .select("patient_id, amount_cents, status");

      if (enrollmentsError) throw enrollmentsError;

      // Calculate totals per patient
      const patientStats = new Map<string, { total_paid: number; enrollment_count: number }>();
      
      enrollmentsData?.forEach((enrollment) => {
        if (!enrollment.patient_id) return;
        const stats = patientStats.get(enrollment.patient_id) || { total_paid: 0, enrollment_count: 0 };
        stats.enrollment_count++;
        if (enrollment.status === "paid") {
          stats.total_paid += enrollment.amount_cents;
        }
        patientStats.set(enrollment.patient_id, stats);
      });

      return patientsData.map((patient) => ({
        ...patient,
        total_paid: patientStats.get(patient.id)?.total_paid || 0,
        enrollment_count: patientStats.get(patient.id)?.enrollment_count || 0,
      })) as Patient[];
    },
  });

  // Add patient mutation
  const addPatientMutation = useMutation({
    mutationFn: async (patient: { name: string; email: string; phone: string; surgeon_id: string | null }) => {
      const { data, error } = await supabase
        .from("patients")
        .insert({
          name: patient.name,
          email: patient.email || null,
          phone: patient.phone || null,
          surgeon_id: patient.surgeon_id,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patients"] });
      setAddPatientOpen(false);
      setNewPatient({ name: "", email: "", phone: "", surgeon_id: null });
      toast({ title: "Patient added", description: "New patient has been created" });
    },
    onError: (error: Error) => {
      let message = error.message;
      if (message.includes("idx_patients_email_unique")) {
        message = "A patient with this email already exists";
      } else if (message.includes("idx_patients_phone_unique")) {
        message = "A patient with this phone number already exists";
      }
      toast({ title: "Error", description: message, variant: "destructive" });
    },
  });

  // Update patient mutation
  const updatePatientMutation = useMutation({
    mutationFn: async (patient: Patient) => {
      const { error } = await supabase
        .from("patients")
        .update({
          name: patient.name,
          email: patient.email,
          phone: patient.phone,
          notes: patient.notes,
          surgeon_id: patient.surgeon_id,
        })
        .eq("id", patient.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patients"] });
      setEditPatient(null);
      toast({ title: "Patient updated", description: "Patient details have been saved" });
    },
    onError: (error: Error) => {
      let message = error.message;
      if (message.includes("idx_patients_email_unique")) {
        message = "A patient with this email already exists";
      } else if (message.includes("idx_patients_phone_unique")) {
        message = "A patient with this phone number already exists";
      }
      toast({ title: "Error", description: message, variant: "destructive" });
    },
  });

  // Delete patient mutation with audit logging
  const deletePatientMutation = useMutation({
    mutationFn: async (patient: Patient) => {
      // Log to audit trail first
      await supabase.from("admin_audit_log").insert({
        admin_user_id: user?.id || null,
        admin_email: user?.email || null,
        action: "delete",
        resource_type: "patient",
        resource_id: patient.id,
        resource_summary: {
          name: patient.name,
          email: patient.email,
          phone: patient.phone,
        },
      });

      const { error } = await supabase
        .from("patients")
        .delete()
        .eq("id", patient.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patients"] });
      queryClient.invalidateQueries({ queryKey: ["audit-log"] });
      setDeletePatient2(null);
      toast({ title: "Patient deleted", description: "Patient has been removed and logged to audit trail" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const filteredPatients = patients?.filter((patient) => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return (
      patient.name.toLowerCase().includes(searchLower) ||
      patient.email?.toLowerCase().includes(searchLower) ||
      patient.phone?.includes(search)
    );
  }) || [];

  const formatAmount = (cents: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(cents / 100);
  };

  return (
    <div className="space-y-6">
      {/* Search and Add */}
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <Input
            placeholder="Search patients by name, email, or phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-md"
          />
        </div>
        <ImportPatientsModal />
        <Button onClick={() => setAddPatientOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          Add Patient
        </Button>
      </div>

      {/* Patients Table */}
      <Card className="card-premium overflow-hidden">
        <CardHeader className="border-b border-border bg-muted/30">
          <CardTitle className="text-lg">
            Patients
            {filteredPatients.length > 0 && (
              <span className="text-sm font-normal text-muted-foreground ml-2">
                ({filteredPatients.length} total)
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="flex justify-center items-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredPatients.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              {search ? "No patients found matching your search" : "No patients yet. Add your first patient to get started."}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Patient</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Surgeon</TableHead>
                  <TableHead>Enrollments</TableHead>
                  <TableHead>Total Paid</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPatients.map((patient) => (
                  <TableRow key={patient.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                          <User className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <p className="font-medium text-foreground">{patient.name}</p>
                          {patient.notes && (
                            <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                              {patient.notes}
                            </p>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        {patient.email && (
                          <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            <Mail className="h-3 w-3" />
                            {patient.email}
                          </div>
                        )}
                        {patient.phone && (
                          <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            <Phone className="h-3 w-3" />
                            {patient.phone}
                          </div>
                        )}
                        {!patient.email && !patient.phone && (
                          <span className="text-sm text-muted-foreground">No contact info</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {patient.surgeon ? (
                        <span className="text-sm text-foreground">{patient.surgeon.name}</span>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-foreground">{patient.enrollment_count}</span>
                    </TableCell>
                    <TableCell className="font-medium text-success">
                      {formatAmount(patient.total_paid)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {format(new Date(patient.created_at), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setEditPatient(patient)}>
                            <Edit className="h-4 w-4 mr-2" />
                            Edit Patient
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setHistoryPatient(patient)}>
                            <History className="h-4 w-4 mr-2" />
                            View History
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => setCreateForPatient(patient)}>
                            <Plus className="h-4 w-4 mr-2" />
                            Create Payment Link
                          </DropdownMenuItem>
                          {patient.total_paid === 0 && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem 
                                onClick={() => setDeletePatient2(patient)}
                                className="text-destructive focus:text-destructive"
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Delete Patient
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </Card>

      {/* Add Patient Dialog */}
      <Dialog open={addPatientOpen} onOpenChange={setAddPatientOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Patient</DialogTitle>
            <DialogDescription>
              Create a new patient record. You can generate payment links for them afterward.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="new-name">Name *</Label>
              <Input
                id="new-name"
                value={newPatient.name}
                onChange={(e) => setNewPatient({ ...newPatient, name: e.target.value })}
                placeholder="John Doe"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-email">Email</Label>
              <Input
                id="new-email"
                type="email"
                value={newPatient.email}
                onChange={(e) => setNewPatient({ ...newPatient, email: e.target.value })}
                placeholder="patient@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-phone">Phone</Label>
              <Input
                id="new-phone"
                type="tel"
                value={newPatient.phone}
                onChange={(e) => setNewPatient({ ...newPatient, phone: e.target.value })}
                placeholder="+1 (555) 000-0000"
              />
            </div>
            <div className="space-y-2">
              <Label>Consulting Surgeon</Label>
              <SurgeonSelect
                value={newPatient.surgeon_id}
                onValueChange={(v) => setNewPatient({ ...newPatient, surgeon_id: v })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddPatientOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => addPatientMutation.mutate(newPatient)}
              disabled={!newPatient.name.trim() || addPatientMutation.isPending}
            >
              {addPatientMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Add Patient
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Patient Dialog */}
      {editPatient && (
        <Dialog open={!!editPatient} onOpenChange={(open) => !open && setEditPatient(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Patient</DialogTitle>
              <DialogDescription>Update patient information.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="edit-name">Name *</Label>
                <Input
                  id="edit-name"
                  value={editPatient.name}
                  onChange={(e) => setEditPatient({ ...editPatient, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-email">Email</Label>
                <Input
                  id="edit-email"
                  type="email"
                  value={editPatient.email || ""}
                  onChange={(e) => setEditPatient({ ...editPatient, email: e.target.value || null })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-phone">Phone</Label>
                <Input
                  id="edit-phone"
                  type="tel"
                  value={editPatient.phone || ""}
                  onChange={(e) => setEditPatient({ ...editPatient, phone: e.target.value || null })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-notes">Notes</Label>
                <Input
                  id="edit-notes"
                  value={editPatient.notes || ""}
                  onChange={(e) => setEditPatient({ ...editPatient, notes: e.target.value || null })}
                  placeholder="Optional notes..."
                />
              </div>
              <div className="space-y-2">
                <Label>Consulting Surgeon</Label>
                <SurgeonSelect
                  value={editPatient.surgeon_id}
                  onValueChange={(v) => setEditPatient({ ...editPatient, surgeon_id: v })}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditPatient(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => updatePatientMutation.mutate(editPatient)}
                disabled={!editPatient.name.trim() || updatePatientMutation.isPending}
              >
                {updatePatientMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Save Changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Patient History Modal */}
      {historyPatient && (
        <PatientHistoryModal
          isOpen={!!historyPatient}
          onClose={() => setHistoryPatient(null)}
          patient={historyPatient}
        />
      )}

      {/* Create Enrollment for Patient Modal */}
      {createForPatient && (
        <CreateEnrollmentModal
          prefillData={{
            patient_name: createForPatient.name,
            patient_email: createForPatient.email || null,
            patient_phone: createForPatient.phone || null,
          }}
          patientId={createForPatient.id}
          isOpen={!!createForPatient}
          onOpenChange={(open) => !open && setCreateForPatient(null)}
        />
      )}

      {/* Delete Patient Confirmation Dialog */}
      {deletePatient2 && (
        <DeleteConfirmationDialog
          isOpen={!!deletePatient2}
          onClose={() => setDeletePatient2(null)}
          onConfirm={() => deletePatientMutation.mutate(deletePatient2)}
          isPending={deletePatientMutation.isPending}
          resourceType="Patient"
          resourceName={deletePatient2.name}
          warning="This action cannot be undone. The patient record will be permanently removed. This action will be logged to the audit trail."
        />
      )}
    </div>
  );
}
