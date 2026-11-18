import { useState } from "react";
import { PricingSection } from "./components/PricingSection.tsx";

function Navbar() {
  return (
    <header className="nav" id="top-nav">
      <div className="brand">
        <span className="brand-dot">✦</span>
        <span>PulseCloud</span>
      </div>
      <nav className="nav-links">
        <a href="#pricing">Pricing</a>
        <a href="#workflow">How to test</a>
        <span className="plugin-chip">agentcue/vite active</span>
      </nav>
    </header>
  );
}

function HeroBanner() {
  const [deployCount, setDeployCount] = useState(12);

  return (
    <section className="hero" id="hero-section">
      <span className="hero-badge" id="hero-badge">
        Vite + React + HMR Playground
      </span>
      <h1 id="hero-title">
        Pick any React component and cue your coding agent in place.
      </h1>
      <p className="hero-lead" id="hero-subtitle">
        This app loads <code>agentcue/vite</code> in{" "}
        <code>vite.config.ts</code> — no separate bridge port or manual{" "}
        <code>&lt;script&gt;</code> tag needed. Press{" "}
        <strong>Cmd/Ctrl + Shift + F</strong> (or click the bottom-right{" "}
        <strong>✦</strong> launcher), hover a card to see its React component
        stack and source line, drop a few Pins, and press <strong>S</strong> (or{" "}
        <strong>Cmd/Ctrl + Enter</strong>).
      </p>

      <div className="hero-actions">
        <button
          type="button"
          className="btn-primary"
          id="deploy-counter-btn"
          onClick={() => setDeployCount((n) => n + 1)}
        >
          Trigger Sample Deploy ({deployCount})
        </button>
        <button
          type="button"
          className="btn-secondary"
          id="toggle-pick-btn"
          onClick={() => window.__AGENTCUE_INSTANCE__?.togglePickMode()}
        >
          Toggle Pick Mode (Cmd/Ctrl + Shift + F)
        </button>
      </div>
    </section>
  );
}

export function App() {
  return (
    <div className="page-shell">
      <Navbar />
      <main>
        <HeroBanner />
        <PricingSection />
      </main>
    </div>
  );
}
