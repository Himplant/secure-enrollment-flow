import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowRight, Lock } from "lucide-react";
import himplantLogo from "@/assets/himplant-logo.png";

export default function Index() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <main className="flex-1 flex items-center justify-center">
        <div className="container mx-auto px-6 py-20">
          <div className="max-w-2xl mx-auto text-center space-y-8">
            <img
              src={himplantLogo}
              alt="Himplant - Implant for Men"
              className="h-24 md:h-32 w-auto mx-auto object-contain"
            />

            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium">
              <Lock className="h-4 w-4" />
              Secure Payment Portal
            </div>

            <h1 className="text-4xl md:text-5xl font-bold text-foreground leading-tight">
              Secure Your{" "}
              <span className="text-gradient-hero">Enrollment</span>
            </h1>

            <p className="text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed">
              Complete your procedure enrollment with a secure, one-time payment link. 
              Fast, simple, and protected by Stripe.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Button variant="hero" size="xl" asChild>
                <Link to="/admin" className="gap-2">
                  Admin Dashboard
                  <ArrowRight className="h-5 w-5" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-border py-8">
        <div className="container mx-auto px-6">
          <p className="text-sm text-center text-muted-foreground">
            © {new Date().getFullYear()} Himplant. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
