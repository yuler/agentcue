import { useState } from "react";

export type BillingCycle = "monthly" | "annual";

interface PlanSpec {
  id: string;
  name: string;
  tagline: string;
  monthlyPrice: number;
  featured?: boolean;
  perks: string[];
  ctaLabel: string;
}

const PLANS: PlanSpec[] = [
  {
    id: "starter",
    name: "Starter",
    tagline: "For solo builders shipping side projects.",
    monthlyPrice: 0,
    perks: [
      "3 active environments",
      "Instant preview URLs",
      "Community support",
    ],
    ctaLabel: "Start Free",
  },
  {
    id: "pro",
    name: "Pro Team",
    tagline: "For fast-moving product teams iterating daily.",
    monthlyPrice: 24,
    featured: true,
    perks: [
      "Unlimited preview environments",
      "Zero-downtime rollbacks",
      "SSO & role permissions",
    ],
    ctaLabel: "Upgrade to Pro",
  },
  {
    id: "scale",
    name: "Scale",
    tagline: "Dedicated regions and custom compliance controls.",
    monthlyPrice: 79,
    perks: [
      "Multi-region edge routing",
      "Audit logs & SOC2 reports",
      "24/7 Slack engineering support",
    ],
    ctaLabel: "Contact Sales",
  },
];

export function PlanCard({
  plan,
  billing,
  selected,
  onSelect,
}: {
  plan: PlanSpec;
  billing: BillingCycle;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const unitPrice =
    billing === "annual"
      ? Math.round(plan.monthlyPrice * 0.8)
      : plan.monthlyPrice;

  return (
    <article
      className={`plan-card${plan.featured ? " featured" : ""}${selected ? " selected" : ""}`}
      data-testid={`plan-${plan.id}`}
    >
      <div className="plan-top">
        <div className="plan-title-row">
          <h3>{plan.name}</h3>
          {plan.featured && <span className="plan-pill">Most Popular</span>}
        </div>
        <p className="plan-tagline">{plan.tagline}</p>

        <div className="plan-price">
          <span className="price-amount">${unitPrice}</span>
          <span className="price-period">/ seat / mo</span>
        </div>
      </div>

      <ul className="plan-perks">
        {plan.perks.map((perk) => (
          <li key={perk}>{perk}</li>
        ))}
      </ul>

      <button
        type="button"
        className={plan.featured ? "btn-primary full" : "btn-secondary full"}
        onClick={() => onSelect(plan.id)}
      >
        {selected ? `Selected: ${plan.name} ✓` : plan.ctaLabel}
      </button>
    </article>
  );
}

export function PricingSection() {
  const [billing, setBilling] = useState<BillingCycle>("annual");
  const [selectedPlan, setSelectedPlan] = useState<string>("pro");

  return (
    <section className="pricing-section" id="pricing">
      <div className="pricing-toolbar">
        <div>
          <h2>Simple, predictable pricing</h2>
          <p className="muted">
            Toggle billing normally, or press <code>Cmd/Ctrl + Shift + F</code>{" "}
            to annotate these React components without triggering click
            handlers.
          </p>
        </div>

        <div className="billing-toggle" role="group" aria-label="Billing cycle">
          <button
            type="button"
            className={billing === "monthly" ? "seg active" : "seg"}
            onClick={() => setBilling("monthly")}
          >
            Monthly
          </button>
          <button
            type="button"
            className={billing === "annual" ? "seg active" : "seg"}
            onClick={() => setBilling("annual")}
          >
            Annual <span className="save-tag">-20%</span>
          </button>
        </div>
      </div>

      <div className="plans-grid">
        {PLANS.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            billing={billing}
            selected={selectedPlan === plan.id}
            onSelect={setSelectedPlan}
          />
        ))}
      </div>
    </section>
  );
}
