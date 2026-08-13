import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Copy, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const origin = () => (typeof window === "undefined" ? "" : window.location.origin);

function LinkRow({ title, path, note }: { title: string; path: string | null; note: string }) {
  const { toast } = useToast();
  const url = path ? `${origin()}${path}` : null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="truncate text-xs text-muted-foreground">{url ?? note}</p>
        {url && <p className="text-xs text-muted-foreground">{note}</p>}
      </div>
      {url && (
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              navigator.clipboard.writeText(url);
              toast({ title: "Link copied" });
            }}
          >
            <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href={path!} target="_blank" rel="noreferrer">
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Open
            </a>
          </Button>
        </div>
      )}
    </div>
  );
}

/** Who signs in where — the question new operators ask first. */
export function AccessCard() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Who signs in where</CardTitle>
        <CardDescription>Three different audiences, three different doors.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <LinkRow title="Himplant team" path="/admin/login" note="This dashboard." />
        <LinkRow
          title="Surgeons & distributors"
          path="/portal/login"
          note="One shared portal login. Their invitation decides what they can see."
        />
        <LinkRow
          title="Patients"
          path={null}
          note="No login. Each patient receives a private, expiring payment link by email."
        />
      </CardContent>
    </Card>
  );
}
