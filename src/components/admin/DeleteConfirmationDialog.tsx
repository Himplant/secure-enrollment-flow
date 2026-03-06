import { useState } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, AlertTriangle } from "lucide-react";

interface DeleteConfirmationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isPending: boolean;
  resourceType: string;
  resourceName: string;
  confirmText?: string;
  warning?: string;
  title?: string;
  actionLabel?: string;
  actionVariant?: "destructive" | "default";
}

export function DeleteConfirmationDialog({
  isOpen,
  onClose,
  onConfirm,
  isPending,
  resourceType,
  resourceName,
  confirmText,
  warning = "This action cannot be undone. The record will be permanently removed.",
  title,
  actionLabel,
  actionVariant = "destructive",
}: DeleteConfirmationDialogProps) {
  const [typedConfirmation, setTypedConfirmation] = useState("");
  const requiredText = confirmText || "DELETE";
  const isConfirmed = typedConfirmation === requiredText;

  const handleClose = () => {
    setTypedConfirmation("");
    onClose();
  };

  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            {title || `Delete ${resourceType}`}
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-3">
            <p>
              You are about to {actionLabel ? actionLabel.toLowerCase() : "permanently delete"}{" "}
              <strong className="text-foreground">{resourceName}</strong>.
            </p>
            <p className="text-destructive font-medium">{warning}</p>
            <div className="pt-2">
              <Label htmlFor="confirm-delete" className="text-sm text-muted-foreground">
                Type <strong className="text-foreground">{requiredText}</strong> to confirm:
              </Label>
              <Input
                id="confirm-delete"
                value={typedConfirmation}
                onChange={(e) => setTypedConfirmation(e.target.value)}
                placeholder={requiredText}
                className="mt-1.5"
                autoComplete="off"
              />
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant={actionVariant}
            onClick={onConfirm}
            disabled={!isConfirmed || isPending}
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {actionLabel || "Delete Permanently"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
