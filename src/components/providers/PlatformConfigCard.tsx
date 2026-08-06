import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Check, Copy, Eye, EyeOff, Loader2, ShieldAlert } from "lucide-react";
import { callProviderFn, type PlatformEntry, type ProviderEnvironment } from "./useProviderSetup";

function CopyField({ label, value }: { label: string; value: string }) {
  const { toast } = useToast();
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input readOnly value={value} className="font-mono text-xs" />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => {
            navigator.clipboard.writeText(value);
            toast({ title: "Copied" });
          }}
        >
          <Copy className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

/**
 * Super-admin platform credentials for one provider. Values are write-only:
 * after saving, only the masked indicator returned by the server is shown.
 */
export function PlatformConfigCard({
  entry,
  environment,
  onSaved,
}: {
  entry: PlatformEntry;
  environment: ProviderEnvironment;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [values, setValues] = useState<Record<string, string>>({});
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const config = entry.config;
  const masks = config?.credential_masks ?? {};
  const missing = config?.missing_fields ?? entry.fields.filter((f) => f.required).map((f) => f.key);

  const run = async (fn: () => Promise<void>, setBusy: (v: boolean) => void) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast({ title: "Failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(async () => {
      await callProviderFn("admin-save-provider-platform-config", {
        provider: entry.provider,
        environment,
        credentials: values,
      });
      setValues({});
      setReveal({});
      toast({ title: "Platform configuration saved" });
      onSaved();
    }, setSaving);

  const test = () =>
    run(async () => {
      const res = await callProviderFn<{ ok?: boolean; error?: string }>(
        "admin-save-provider-platform-config",
        { provider: entry.provider, environment, action: "test" },
      );
      toast({
        title: res.ok === false ? "Configuration test failed" : "Configuration looks valid",
        description: res.error,
        variant: res.ok === false ? "destructive" : "default",
      });
      onSaved();
    }, setTesting);

  const disable = () =>
    run(async () => {
      await callProviderFn("admin-save-provider-platform-config", {
        provider: entry.provider,
        environment,
        action: "disable",
      });
      toast({ title: "Platform configuration disabled" });
      onSaved();
    }, setSaving);

  return (
    <Card>
      <CardHeader className="space-y-1">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">Platform setup</CardTitle>
          <Badge variant={config?.is_complete ? "default" : "secondary"}>
            {config?.is_complete ? "Complete" : "Incomplete"}
          </Badge>
        </div>
        <CardDescription>
          Himplant's own developer application. These credentials are encrypted at rest and are never
          shown again after saving.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          {entry.fields.map((field) => (
            <div key={field.key} className="space-y-1.5">
              <Label className="flex items-center gap-2">
                {field.label}
                {!field.required && <span className="text-xs text-muted-foreground">optional</span>}
                {masks[field.key]?.present && (
                  <span className="font-mono text-xs text-muted-foreground">
                    {masks[field.key]?.mask}
                  </span>
                )}
              </Label>
              <div className="flex gap-2">
                <Input
                  type={field.secret && !reveal[field.key] ? "password" : "text"}
                  autoComplete="off"
                  placeholder={masks[field.key]?.present ? "Saved — enter a new value to replace" : ""}
                  value={values[field.key] ?? ""}
                  onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                />
                {field.secret && (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => setReveal({ ...reveal, [field.key]: !reveal[field.key] })}
                  >
                    {reveal[field.key] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <CopyField label="OAuth callback URL" value={entry.callbackUrl} />
          <CopyField label="Payment webhook URL" value={entry.webhookUrl} />
        </div>

        <div className="rounded-md border p-3 text-sm">
          <p className="mb-2 font-medium">Setup checklist</p>
          <ul className="space-y-1">
            {entry.fields
              .filter((f) => f.required)
              .map((f) => {
                const done = !missing.includes(f.key);
                return (
                  <li key={f.key} className="flex items-center gap-2 text-muted-foreground">
                    {done ? (
                      <Check className="h-4 w-4 text-primary" />
                    ) : (
                      <ShieldAlert className="h-4 w-4 text-destructive" />
                    )}
                    {f.label}
                  </li>
                );
              })}
            <li className="flex items-center gap-2 text-muted-foreground">
              <Check className="h-4 w-4 text-primary" />
              Paste the callback and webhook URLs into the provider dashboard
            </li>
          </ul>
          {config?.last_test_error && (
            <p className="mt-2 text-xs text-destructive">Last test error: {config.last_test_error}</p>
          )}
          {config?.last_verified_at && (
            <p className="mt-2 text-xs text-muted-foreground">
              Last verified {new Date(config.last_verified_at).toLocaleString()}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={save} disabled={saving || Object.keys(values).length === 0}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save securely
          </Button>
          <Button variant="outline" onClick={test} disabled={testing || !config}>
            {testing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Test platform configuration
          </Button>
          <Button variant="outline" onClick={disable} disabled={!config || config.status === "disabled"}>
            Disable
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
