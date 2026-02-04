import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload, Loader2, CheckCircle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ImportResult {
  created: number;
  linked: number;
  skipped: number;
  errors: string[];
}

export function ImportPatientsModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [preview, setPreview] = useState<{
    enrollmentsWithEmail: number;
    enrollmentsWithoutPatient: number;
    uniqueEmails: string[];
  } | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Preview what will be imported
  const previewMutation = useMutation({
    mutationFn: async () => {
      // Get all enrollments without patient_id that have email
      const { data: enrollments, error } = await supabase
        .from("enrollments")
        .select("id, patient_name, patient_email, patient_phone")
        .is("patient_id", null);

      if (error) throw error;

      const withEmail = enrollments?.filter(e => e.patient_email) || [];
      const uniqueEmails = [...new Set(withEmail.map(e => e.patient_email!.toLowerCase()))];

      return {
        enrollmentsWithEmail: withEmail.length,
        enrollmentsWithoutPatient: enrollments?.length || 0,
        uniqueEmails,
      };
    },
    onSuccess: (data) => {
      setPreview(data);
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to preview",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Perform the import
  const importMutation = useMutation({
    mutationFn: async () => {
      const result: ImportResult = {
        created: 0,
        linked: 0,
        skipped: 0,
        errors: [],
      };

      // Get all enrollments without patient_id
      const { data: enrollments, error: fetchError } = await supabase
        .from("enrollments")
        .select("id, patient_name, patient_email, patient_phone")
        .is("patient_id", null);

      if (fetchError) throw fetchError;
      if (!enrollments || enrollments.length === 0) {
        return result;
      }

      // Group by email (lowercase)
      const byEmail = new Map<string, typeof enrollments>();
      enrollments.forEach(e => {
        if (e.patient_email) {
          const email = e.patient_email.toLowerCase();
          const existing = byEmail.get(email) || [];
          existing.push(e);
          byEmail.set(email, existing);
        }
      });

      // Get existing patients by email
      const { data: existingPatients } = await supabase
        .from("patients")
        .select("id, email, phone");

      const emailToPatient = new Map<string, { id: string; phone: string | null }>();
      existingPatients?.forEach(p => {
        if (p.email) {
          emailToPatient.set(p.email.toLowerCase(), { id: p.id, phone: p.phone });
        }
      });

      const existingPhones = new Set<string>();
      existingPatients?.forEach(p => {
        if (p.phone) existingPhones.add(p.phone);
      });

      // Process each unique email
      for (const [email, emailEnrollments] of byEmail) {
        const firstEnrollment = emailEnrollments[0];
        let patientId: string;

        // Check if patient already exists
        const existingPatient = emailToPatient.get(email);
        
        if (existingPatient) {
          patientId = existingPatient.id;
        } else {
          // Check if phone is already used
          const phone = firstEnrollment.patient_phone;
          if (phone && existingPhones.has(phone)) {
            result.errors.push(`Phone ${phone} already exists for another patient (${email})`);
            result.skipped += emailEnrollments.length;
            continue;
          }

          // Create new patient
          const { data: newPatient, error: createError } = await supabase
            .from("patients")
            .insert({
              name: firstEnrollment.patient_name || "Unknown",
              email: email,
              phone: phone || null,
            })
            .select("id")
            .single();

          if (createError) {
            if (createError.message.includes("duplicate") || createError.message.includes("unique")) {
              result.errors.push(`Duplicate email or phone for ${email}`);
              result.skipped += emailEnrollments.length;
              continue;
            }
            throw createError;
          }

          patientId = newPatient.id;
          result.created++;
          
          if (phone) existingPhones.add(phone);
        }

        // Link all enrollments with this email to the patient
        const enrollmentIds = emailEnrollments.map(e => e.id);
        const { error: updateError } = await supabase
          .from("enrollments")
          .update({ patient_id: patientId })
          .in("id", enrollmentIds);

        if (updateError) {
          result.errors.push(`Failed to link enrollments for ${email}: ${updateError.message}`);
        } else {
          result.linked += enrollmentIds.length;
        }
      }

      return result;
    },
    onSuccess: (data) => {
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ["patients"] });
      queryClient.invalidateQueries({ queryKey: ["enrollments"] });
      toast({
        title: "Import complete",
        description: `Created ${data.created} patients, linked ${data.linked} enrollments`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Import failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleOpen = (open: boolean) => {
    setIsOpen(open);
    if (open) {
      setPreview(null);
      setResult(null);
      previewMutation.mutate();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Upload className="h-4 w-4" />
          Import from Enrollments
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import Patients from Enrollments</DialogTitle>
          <DialogDescription>
            Create patient records from existing enrollments grouped by email.
          </DialogDescription>
        </DialogHeader>

        {previewMutation.isPending && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {preview && !result && (
          <div className="space-y-4 py-4">
            <div className="rounded-lg bg-muted/50 p-4 space-y-2">
              <p className="text-sm">
                <strong>{preview.enrollmentsWithoutPatient}</strong> enrollments without linked patient
              </p>
              <p className="text-sm">
                <strong>{preview.enrollmentsWithEmail}</strong> have email addresses
              </p>
              <p className="text-sm">
                <strong>{preview.uniqueEmails.length}</strong> unique emails will create patients
              </p>
            </div>

            {preview.uniqueEmails.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Emails to import:</p>
                <ScrollArea className="h-32 rounded border p-2">
                  {preview.uniqueEmails.map(email => (
                    <p key={email} className="text-xs text-muted-foreground">{email}</p>
                  ))}
                </ScrollArea>
              </div>
            )}

            {preview.uniqueEmails.length === 0 && (
              <div className="text-center py-4 text-muted-foreground">
                No enrollments with email addresses to import
              </div>
            )}
          </div>
        )}

        {result && (
          <div className="space-y-4 py-4">
            <div className="rounded-lg bg-success/10 border border-success/20 p-4 space-y-2">
              <div className="flex items-center gap-2 text-success">
                <CheckCircle className="h-5 w-5" />
                <span className="font-medium">Import Complete</span>
              </div>
              <p className="text-sm">Created {result.created} new patients</p>
              <p className="text-sm">Linked {result.linked} enrollments</p>
              {result.skipped > 0 && (
                <p className="text-sm text-muted-foreground">Skipped {result.skipped} enrollments</p>
              )}
            </div>

            {result.errors.length > 0 && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-4 space-y-2">
                <div className="flex items-center gap-2 text-destructive">
                  <AlertCircle className="h-5 w-5" />
                  <span className="font-medium">Errors ({result.errors.length})</span>
                </div>
                <ScrollArea className="h-24">
                  {result.errors.map((error, i) => (
                    <p key={i} className="text-xs text-destructive">{error}</p>
                  ))}
                </ScrollArea>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setIsOpen(false)}>
            {result ? "Close" : "Cancel"}
          </Button>
          {!result && preview && preview.uniqueEmails.length > 0 && (
            <Button 
              onClick={() => importMutation.mutate()} 
              disabled={importMutation.isPending}
            >
              {importMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Import {preview.uniqueEmails.length} Patients
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
