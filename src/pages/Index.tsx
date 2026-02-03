import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Shield, CreditCard, Clock, FileCheck, ArrowRight, Building2, CheckCircle2 } from "lucide-react";

const features = [
  {
    icon: Shield,
    title: "Bank-Level Security",
    description: "256-bit SSL encryption with no payment data stored locally. HIPAA compliant and PCI-DSS certified.",
  },
  {
    icon: Clock,
    title: "48-Hour Secure Links",
    description: "Unique, single-use payment links that expire automatically for maximum security.",
  },
  {
    icon: CreditCard,
    title: "Flexible Payments",
    description: "Accept credit cards and bank transfers (ACH) with automatic status tracking.",
  },
  {
    icon: FileCheck,
    title: "Legal Compliance",
    description: "Capture enforceable consent with full audit trails and timestamped acceptance.",
  },
];

const paymentMethods = [
  { icon: CreditCard, label: "Credit Card", time: "Instant" },
  { icon: Building2, label: "Bank Transfer (ACH)", time: "3-5 days" },
];

export default function Index() {
  return (
    <div className="min-h-screen bg-background">
      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-secondary/5" />
        
        <div className="container mx-auto px-6 py-20 relative">
          <div className="max-w-3xl mx-auto text-center space-y-8">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium">
              <Shield className="h-4 w-4" />
              Medical-Grade Payment Security
            </div>
            
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-foreground leading-tight">
              Secure Enrollment{" "}
              <span className="text-gradient-hero">Payments</span>{" "}
              Platform
            </h1>
            
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              A HIPAA-compliant payment platform designed for healthcare enrollment. 
              Accept payments securely with expiring links, legal consent capture, 
              and complete audit trails.
            </p>
            
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Button variant="hero" size="xl" asChild>
                <Link to="/admin" className="gap-2">
                  View Dashboard
                  <ArrowRight className="h-5 w-5" />
                </Link>
              </Button>
              <Button variant="outline" size="lg" asChild>
                <Link to="/enroll/demo-token">
                  Try Patient View
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="container mx-auto px-6 py-20">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-foreground mb-4">
            Built for Healthcare Compliance
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Every feature designed with patient privacy and regulatory compliance in mind.
          </p>
        </div>
        
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((feature) => (
            <Card key={feature.title} className="card-premium group hover:shadow-lg transition-all duration-300">
              <CardContent className="p-6">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                  <feature.icon className="h-6 w-6 text-primary" />
                </div>
                <h3 className="font-semibold text-foreground mb-2">{feature.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {feature.description}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Payment Methods */}
      <section className="bg-muted/30 py-20">
        <div className="container mx-auto px-6">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-3xl font-bold text-foreground mb-4">
                Flexible Payment Options
              </h2>
              <p className="text-muted-foreground">
                Accept the payment methods your patients prefer.
              </p>
            </div>
            
            <div className="grid md:grid-cols-2 gap-6">
              {paymentMethods.map((method) => (
                <Card key={method.label} className="card-premium">
                  <CardContent className="p-6 flex items-center gap-4">
                    <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center">
                      <method.icon className="h-7 w-7 text-primary" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-foreground">{method.label}</h3>
                      <p className="text-sm text-muted-foreground">
                        Processing time: {method.time}
                      </p>
                    </div>
                    <CheckCircle2 className="h-5 w-5 text-success" />
                  </CardContent>
                </Card>
              ))}
            </div>
            
            <p className="text-center text-sm text-muted-foreground mt-6">
              Powered by Stripe for secure, PCI-compliant payment processing
            </p>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="container mx-auto px-6 py-20">
        <Card className="card-premium overflow-hidden">
          <CardContent className="p-0">
            <div className="grid lg:grid-cols-2">
              <div className="p-10 lg:p-14">
                <h2 className="text-3xl font-bold text-foreground mb-4">
                  Ready to Get Started?
                </h2>
                <p className="text-muted-foreground mb-8 leading-relaxed">
                  Set up your secure enrollment payment system in minutes. 
                  Integrate with Zoho CRM and start accepting payments today.
                </p>
                <ul className="space-y-3 mb-8">
                  {[
                    "Zoho CRM integration",
                    "Automatic status updates",
                    "Email notifications",
                    "Complete audit trail",
                  ].map((item) => (
                    <li key={item} className="flex items-center gap-2 text-foreground">
                      <CheckCircle2 className="h-5 w-5 text-success" />
                      {item}
                    </li>
                  ))}
                </ul>
                <Button variant="hero" size="lg" asChild>
                  <Link to="/admin" className="gap-2">
                    Open Admin Dashboard
                    <ArrowRight className="h-5 w-5" />
                  </Link>
                </Button>
              </div>
              <div className="bg-gradient-to-br from-primary/10 via-secondary/10 to-accent/20 p-10 lg:p-14 flex items-center justify-center">
                <div className="text-center">
                  <Shield className="h-20 w-20 text-primary mx-auto mb-4 opacity-50" />
                  <p className="text-sm text-muted-foreground">
                    HIPAA Compliant · PCI-DSS Certified · SOC 2 Type II
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8">
        <div className="container mx-auto px-6">
          <p className="text-sm text-center text-muted-foreground">
            © 2024 Secure Enrollment Payments. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
