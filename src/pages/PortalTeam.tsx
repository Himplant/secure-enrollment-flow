import { useState } from "react";
import { Loader2, UserPlus } from "lucide-react";
import { PortalLayout } from "@/components/portal/PortalLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { usePortalTeam, usePortalTeamMutation } from "@/hooks/usePortalTeam";
import { usePortalWorkspace } from "@/hooks/usePortalWorkspace";

const ROLES = [
  { value: "surgeon_admin", label: "Admin — full access, can manage the team" },
  { value: "surgeon_staff", label: "Staff — can update consultations" },
  { value: "surgeon_analyst", label: "Analyst — read-only" },
];

/** Practice team management. Only a surgeon_admin can reach the write actions. */
export default function PortalTeam() {
  const { isSurgeonAdmin, isLoading: wsLoading } = usePortalWorkspace();
  const { data, isLoading } = usePortalTeam(isSurgeonAdmin);
  const mutation = usePortalTeamMutation();

  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState("surgeon_staff");
  const [surgeonId, setSurgeonId] = useState("");

  const run = (payload: Record<string, unknown>, successMessage: string) =>
    mutation.mutate(payload, {
      onSuccess: () => {
        toast({ title: successMessage });
        setOpen(false);
        setEmail("");
        setFullName("");
      },
      onError: (e) =>
        toast({ title: "Action failed", description: (e as Error).message, variant: "destructive" }),
    });

  if (wsLoading || (isSurgeonAdmin && isLoading)) {
    return (
      <PortalLayout>
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      </PortalLayout>
    );
  }

  if (!isSurgeonAdmin) {
    return (
      <PortalLayout>
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Only a practice admin can manage team members.
          </CardContent>
        </Card>
      </PortalLayout>
    );
  }

  const surgeons = data?.surgeons ?? [];
  const activeSurgeonId = surgeonId || surgeons[0]?.id || "";

  return (
    <PortalLayout>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Team</h1>
            <p className="text-sm text-muted-foreground">
              Invite office staff to help manage consultations for your practice.
            </p>
          </div>
          <Button onClick={() => setOpen(true)}>
            <UserPlus className="mr-2 h-4 w-4" />
            Invite member
          </Button>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Members</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.members ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                      No team members yet.
                    </TableCell>
                  </TableRow>
                )}
                {(data?.members ?? []).map((m) => (
                  <TableRow key={m.membership_id}>
                    <TableCell className="font-medium">{m.user?.full_name ?? "—"}</TableCell>
                    <TableCell>{m.user?.email}</TableCell>
                    <TableCell>
                      <Select
                        value={m.role}
                        onValueChange={(value) =>
                          run(
                            { action: "set_role", membership_id: m.membership_id, role: value },
                            "Role updated",
                          )
                        }
                      >
                        <SelectTrigger className="h-8 w-[150px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLES.map((r) => (
                            <SelectItem key={r.value} value={r.value}>
                              {r.value.replace("surgeon_", "")}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      {!m.is_active ? (
                        <Badge variant="outline">Revoked</Badge>
                      ) : m.user?.accepted_at ? (
                        <Badge variant="secondary">Active</Badge>
                      ) : (
                        <Badge variant="outline">Invited</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={mutation.isPending}
                        onClick={() =>
                          run(
                            {
                              action: m.is_active ? "deactivate" : "reactivate",
                              membership_id: m.membership_id,
                            },
                            m.is_active ? "Access revoked" : "Access restored",
                          )
                        }
                      >
                        {m.is_active ? "Revoke" : "Restore"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite a team member</DialogTitle>
            <DialogDescription>
              They will receive a sign-in invitation for the surgeon portal.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {surgeons.length > 1 && (
              <div className="space-y-1.5">
                <Label>Practice</Label>
                <Select value={activeSurgeonId} onValueChange={setSurgeonId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {surgeons.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="staff@clinic.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="name">Full name</Label>
              <Input id="name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!email || !activeSurgeonId || mutation.isPending}
              onClick={() =>
                run(
                  {
                    action: "invite",
                    surgeon_id: activeSurgeonId,
                    email,
                    full_name: fullName || null,
                    role,
                  },
                  "Invitation sent",
                )
              }
            >
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Send invite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PortalLayout>
  );
}
