---
summary: "Product and technical vision for test-capabilities (formerly testers)."
read_when:
  - "Defining or revisiting project direction."
  - "Understanding why test-capabilities exists and where it's going."
  - "Aligning new features with strategic goals."
system4d:
  container: "Testing infrastructure for the AI-native era."
  compass: "Testing should think, adapt, and evolve—never rot."
  engine: "Curate, integrate, synthesize. Ship leverage, not noise."
  fog: "The convergence of AI, property-based testing, and autonomous agents is still crystallizing."
---

# Vision: test-capabilities (formerly testers)

> *We don't build tests. We build the immune system of software.*

---

## How to Read This Vision in 2026

This document is the north-star narrative, not a shipped-capability inventory.
The current product posture lives in [product_posture.md](product_posture.md), the operator-facing capability contract lives in the repository `README.md`, and live task/direction/evidence truth lives in AK.

As of the current product slice, test-capabilities is deliberately **fail-closed**: supported routes run through real runtime paths; unsupported commands, flags, agents, and intelligence modes error instead of pretending to work.
That boundary is not a retreat from the vision. It is the discipline that lets the vision become real without corrupting operator trust.

Current supported runtime surfaces include the typed operation kernel, `test`, `quantum`, `heal`, `surf explore`, `cli-tester`, Bombadil-backed exploration, and finding correlation.
Prediction, collective learning, self-generation, self-evolution, chaos execution, reporting, visualization, and broad autonomy remain future or research-to-product promotions unless the capability matrix says otherwise.

---

## Prologue: The 3 AM Truth

It always happens at 3 AM.

Production is down. The incident war room assembles. The post-mortem will eventually reveal what you already know in your bones: **the tests passed. All 2,847 of them.**

This is the quiet crisis of modern software. We are drowning in tests while starving for confidence.

Each test you write is a photograph—a frozen moment of what someone believed to be true. But software is cinema, not photography. The system breathes, evolves, metabolizes. The photographs yellow and curl while the living thing outgrows its frame.

The math is merciless:

```
Brittleness = Σ(assertions × coupling_coefficient × time)

As time → ∞, brittleness → ∞
```

We've accepted this as the tax of quality. **It is not a law of nature. It is a failure of imagination.**

---

## Part I: The Ontology of Testing

### What Testing Actually Is

Testing is not verification. Testing is **epistemology**—the study of what we can know about a system's behavior.

Every test is a question. "Does the login work?" "Can users checkout?" "What happens if the network fails?" We ask these questions by sampling from an infinite behavior space, hoping our samples illuminate the dangerous territories.

```
                    The Behavior Manifold
                    
        ┌─────────────────────────────────────────────┐
        │                                              │
        │       ⚠︎                                     │
        │            ○     ○                          │
        │        ○        ⚠︎     ○                    │
        │    ○        ○         ⚠︎                    │
        │         ○        ○                         │
        │              ○      ○                      │
        │    ⚠︎    ○          ⚠︎                      │
        │         ○    ○                            │
        │                                              │
        └─────────────────────────────────────────────┘
        
        ○ = Questions we asked (known paths)
        ⚠︎ = Questions we didn't (where bugs reproduce)
        
        The ratio of ⚠︎ to ○ determines your production stability.
```

The terrifying truth: **The bugs that kill systems live in the regions we didn't think to sample.** Not because we're careless—because the behavior space is effectively infinite and our test coverage is a vanishingly thin slice.

### The Epistemic Modes

| Mode | Question Type | Sampling Strategy | Discovers |
|------|---------------|-------------------|-----------|
| **Deductive** | "Does this specific path work?" | Manual selection | Known-knowns |
| **Inductive** | "What properties always hold?" | Property generation | Known-unknowns |
| **Abductive** | "What's going wrong?" | Anomaly detection | Unknown-knowns |
| **Explorative** | "What happens if I do weird things?" | Autonomous exploration | Unknown-unknowns |

Traditional testing is 90% deductive, 10% inductive. This leaves the two most valuable modes—abductive and explorative—almost entirely uncovered.

**test-capabilities exists to cover all four modes simultaneously.**

### The Conservation of Testing Pain

Testing pain is conserved, but it can be transformed:

```
                    ┌─────────────────────────────────────┐
                    │        CONSERVATION LAW            │
                    │                                     │
                    │   Creation Pain + Maintenance Pain  │
                    │   + Execution Pain + Blindspot Pain │
                    │            = Constant               │
                    │                                     │
                    └─────────────────────────────────────┘
```

Traditional tools minimize creation pain by making tests easy to write. But this maximizes maintenance pain (brittle tests), execution pain (slow suites), and blindspot pain (untested regions).

test-capabilities takes a different approach: **Accept higher creation pain to minimize all other pains.**

A test that generates itself, maintains itself, and explores its own edges is worth ten tests you have to babysit.

---

## Part II: The Nervous System Architecture

### From Tool to Organism

A testing tool detects failures. A testing **nervous system** senses, thinks, and responds.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        THE TESTING NERVOUS SYSTEM                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐   │
│   │                 │      │                 │      │                 │   │
│   │    SENSORY      │      │   COGNITIVE     │      │     MOTOR      │   │
│   │    CORTEX       │─────▶│    CORTEX       │─────▶│    CORTEX      │   │
│   │                 │      │                 │      │                 │   │
│   └────────┬────────┘      └────────┬────────┘      └────────┬────────┘   │
│            │                        │                        │             │
│            │                        │                        │             │
│   ┌────────▼────────┐      ┌────────▼────────┐      ┌────────▼────────┐   │
│   │                 │      │                 │      │                 │   │
│   │  • Bombadil     │      │  • Correlate    │      │  • Self-heal    │   │
│   │  • agent-browser│      │  • Predict      │      │  • Self-generate│   │
│   │  • Stagehand    │      │  • Synthesize   │      │  • Self-evolve  │   │
│   │  • verify.sh    │      │  • Learn        │      │  • Alert        │   │
│   │  • Custom       │      │  • Remember     │      │  • Document     │   │
│   │                 │      │                 │      │                 │   │
│   └─────────────────┘      └─────────────────┘      └─────────────────┘   │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐ │
│   │                        MEMORY & LEARNING                            │ │
│   │  • Pattern library    • Failure memory    • Success patterns       │ │
│   │  • Collective opt-in  • Temporal models   • Behavioral baselines   │ │
│   └─────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Sensory Cortex: The Many Eyes

No single tool perceives all modalities. The sensory cortex is a **parliament of observers**, each voting on system health from its domain of expertise. The table below is the target architecture; today, only the supported runtime paths named in the capability contract should be treated as shipped behavior.

| Sensor | Modality | Perceives |
|--------|----------|-----------|
| **Bombadil** | Behavioral | Property invariants, UI state drift |
| **agent-browser** | Experiential | User journey friction, navigation failures |
| **Stagehand** | Semantic | Intent fulfillment, flow correctness |
| **verify.sh** | Contractual | CLI behavior, exit semantics |
| **API fuzzers** | Structural | Schema violations, edge case handling |
| **Chaos injectors** | Resilience | Failure propagation, recovery time |

The sensory cortex normalizes all observations into a universal **observation protocol**:

```typescript
interface Observation {
  // When and where
  timestamp: Temporal.Instant;
  sensor: SensorIdentity;
  target: SystemComponent;
  
  // What happened
  modality: Modality;
  signal: SignalType;  // pass | fail | degrade | anomaly | recover
  confidence: number;  // 0-1, how sure is the sensor
  
  // Context for correlation
  context: {
    operation?: string;
    parameters?: Record<string, unknown>;
    state?: SystemState;
    duration?: number;
  };
  
  // Evidence for synthesis
  evidence: Evidence[];  // screenshots, logs, traces, diffs
  
  // Semantic enrichment (added by cognitive cortex)
  semantics?: {
    meaning: string;     // "Checkout times out after payment"
    severity: Severity;  // critical | high | medium | low
    scope: Scope;        // user | system | business
  };
}
```

### Cognitive Cortex: The Intelligence Engine

The cognitive cortex is where **raw observation becomes understanding**.

#### Correlation: The Pattern Weaver

Individual observations are noise. Correlation finds the signal.

```typescript
// What the sensory cortex reports:
observations: [
  { sensor: "bombadil", signal: "fail", target: "checkout", symptom: "timeout" },
  { sensor: "api-monitor", signal: "degrade", target: "payment-api", symptom: "latency +2000ms" },
  { sensor: "agent-browser", signal: "fail", target: "checkout", symptom: "stuck at payment" }
]

// What correlation produces:
correlation: {
  pattern: "cascading_timeout",
  rootCause: {
    component: "payment-gateway",
    symptom: "connection_pool_exhaustion",
    trigger: "traffic_spike_3.2x_baseline"
  },
  propagation: [
    { from: "payment-gateway", to: "payment-api", via: "connection_timeout" },
    { from: "payment-api", to: "checkout-ui", via: "response_delay" }
  ],
  affected: ["checkout", "refund", "subscription_renewal"],
  unaffected: ["browse", "search", "auth", "cart"],
  confidence: 0.94,
  recommendedAction: "Scale payment-gateway connections + implement circuit breaker"
}
```

Correlation answers: **"What's actually happening?"**

#### Prediction: The Future Sight

The most valuable bug is the one you prevent. Prediction shifts testing from reactive to proactive. In the current product, prediction is not a supported CLI/orchestrator intelligence mode; this section describes the capability that must earn promotion through data quality, validation thresholds, privacy posture, and operator trust:

```typescript
interface FailurePrediction {
  // What will fail
  component: string;
  failureMode: string;
  
  // When and how likely
  probability: number;        // 0-1
  timeframe: TemporalRange;   // "within 48 hours"
  
  // Why we think so
  signals: Signal[];          // Leading indicators detected
  historicalPattern: string;  // "Similar to incident #847"
  
  // What to do
  preventiveActions: Action[];
  monitoringRecommendations: Metric[];
  
  // How confident we are
  confidence: number;
  evidence: Observation[];
}

// Example:
{
  component: "search_autosuggest",
  failureMode: "latency_spike",
  probability: 0.72,
  timeframe: "within 72 hours",
  signals: [
    { metric: "index_size", trend: "exponential", current: "8.7M", threshold: "10M" },
    { metric: "query_complexity_p95", trend: "increasing", delta: "+34% week-over-week" },
    { metric: "cache_hit_rate", trend: "declining", current: "67%", baseline: "85%" }
  ],
  historicalPattern: "Pre-index-partitioning pattern (incidents #234, #567, #891)",
  preventiveActions: [
    "Pre-emptively scale search cluster to 2x capacity",
    "Implement query complexity budget (reject queries > complexity_threshold)",
    "Add cache warming for top 1000 queries"
  ],
  confidence: 0.81
}
```

Prediction answers: **"What will break next?"**

#### Synthesis: The Meaning Maker

Reports are data. Synthesis is **understanding**.

```typescript
interface Synthesis {
  // The headline
  insight: string;  // "Your authentication contract has drifted from implementation"
  
  // The story
  narrative: string;  // Human-readable explanation
  
  // The evidence
  observations: Observation[];
  correlations: Correlation[];
  
  // The implications
  implications: {
    immediate: string[];   // "Users with SSO can't login"
    nearTerm: string[];    // "Mobile app will break on next release"
    systemic: string[];    // "Contract testing gap in CI/CD"
  };
  
  // The prescription
  recommendations: {
    quickFix: string;      // Immediate mitigation
    properFix: string;     // Root cause resolution
    prevention: string;    // How to prevent recurrence
  };
  
  // The connections
  relatedPatterns: {
    local: string[];       // Similar patterns in this codebase
    collective: string[];  // Similar patterns across test-capabilities users (opt-in)
  };
}
```

Synthesis answers: **"What does this mean and what should I do?"**

### Motor Cortex: The Autonomous Response

Understanding without action is impotent. The motor cortex turns insight into execution. Today, the shipped motor surface is bounded heuristic healing; the stronger self-healing, self-generating, and self-evolving examples below are target-state capabilities that require human-review gates and proof-backed runtime contracts before support promotion.

#### Self-Healing: Tests That Fix Themselves

```typescript
// When a selector breaks, the motor cortex:
{
  trigger: {
    observation: "selector_not_found",
    selector: "#submit-order-btn",
    context: { page: "checkout", step: 3 }
  },
  
  diagnosis: {
    type: "selector_drift",
    cause: "button_id_changed",
    oldSelector: "#submit-order-btn",
    // AI analyzes the page to find the new selector
    candidates: [
      { selector: "button[data-testid='submit-order']", confidence: 0.94 },
      { selector: "button:contains('Submit Order')", confidence: 0.87 },
      { vision: "button_with_text_Submit_Order", coords: { x: 432, y: 618 }, confidence: 0.91 }
    ]
  },
  
  action: {
    strategy: "update_selector",
    newSelector: "button[data-testid='submit-order']",
    verifyBy: "click_and_assert_navigation",
    createPR: true,
    prTitle: "test: update checkout button selector",
    prBody: "Selector auto-healed by test-capabilities motor cortex.\n\nConfidence: 94%\nVerified: Yes"
  },
  
  outcome: {
    prCreated: "#1423",
    ciStatus: "passing",
    humanReviewRequired: true
  }
}
```

#### Self-Generating: Tests That Write Themselves

```typescript
// When new behavior is detected:
{
  trigger: {
    source: "code_change",
    diff: "+ Added: src/features/geo_filtering.ts",
    semantic: "Users can now filter search results by geography"
  },
  
  generation: {
    understood: {
      feature: "geographic_filtering",
      parameters: ["country", "region", "city", "radius"],
      interactions: ["search", "filter", "sort", "paginate"]
    },
    
    generated: [
      {
        type: "property",
        name: "filter_results_respect_geo_scope",
        spec: "∀ results in filtered set: result.geo within scope",
        generator: "geo_scope_generator"
      },
      {
        type: "flow",
        name: "filter_then_sort_maintains_filter",
        steps: ["search", "apply_geo_filter", "sort_by_price", "verify_all_in_scope"]
      },
      {
        type: "edge",
        name: "invalid_geo_graceful_degradation",
        cases: ["nonexistent_country", "invalid_radius", "cross_timezone_query"]
      }
    ],
    
    coverage: {
      before: "78%",
      after: "89%",
      delta: "+11%"
    },
    
    review: {
      required: true,
      suggested: ["verify_business_rules", "confirm_ux_expectations"]
    }
  }
}
```

#### Self-Evolving: Tests That Adapt to System Changes

```typescript
// When the system undergoes paradigm shift:
{
  trigger: {
    type: "architectural_change",
    change: "REST → GraphQL migration",
    scope: "47% of API surface"
  },
  
  evolution: {
    analysis: {
      affected: ["rest_contract_tests", "api_flow_tests", "integration_tests"],
      preserved: ["business_logic", "auth_tests", "data_validation"]
    },
    
    adaptation: {
      deprecated: [
        "tests/api/rest/checkout_contract.test.ts",
        "tests/api/rest/user_crud.test.ts"
      ],
      
      transformed: [
        {
          from: "tests/api/rest/auth_flow.test.ts",
          to: "tests/api/graphql/auth_operations.test.ts",
          transformation: "rest_to_graphql",
          confidence: 0.87,
          manualReview: true
        }
      ],
      
      generated: [
        "tests/api/graphql/operation_composition.test.ts",
        "tests/api/graphql/fragment_reuse.test.ts",
        "tests/api/graphql/n_plus_one_detection.test.ts"
      ]
    },
    
    humanInTheLoop: {
      required: ["security_implications", "authorization_model"],
      suggested: ["performance_baseline", "caching_strategy"]
    }
  }
}
```

### Memory & Learning: The Institutional Knowledge

The nervous system remembers. Every observation, correlation, prediction, and action feeds into a learning loop:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          LEARNING LOOP                                  │
│                                                                         │
│    ┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐    │
│    │ Observe  │────▶│ Correlate│────▶│  Predict │────▶│   Act    │    │
│    └──────────┘     └──────────┘     └──────────┘     └──────────┘    │
│         ▲                                                  │           │
│         │                                                  │           │
│         │               ┌──────────┐                       │           │
│         └───────────────│  Learn   │◀──────────────────────┘           │
│                         └──────────┘                                   │
│                              │                                         │
│                              ▼                                         │
│                    ┌─────────────────┐                                 │
│                    │     Memory      │                                 │
│                    │  • Patterns     │                                 │
│                    │  • Baselines    │                                 │
│                    │  • Models       │                                 │
│                    │  • Collective*  │                                 │
│                    └─────────────────┘                                 │
│                                                                         │
│    * Collective memory is opt-in with enforced anonymization            │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Part III: The Convergence Singularity

### Three Waves, One Tide

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│     Property-Based          AI-Powered           Autonomous             │
│        Testing        +      Automation     =       Agents              │
│          (2015)               (2022)                (2024)              │
│            │                    │                     │                 │
│            │                    │                     │                 │
│            ▼                    ▼                     ▼                 │
│                                                                         │
│        EXPLORE              UNDERSTAND             EXECUTE              │
│       systematically       semantically          purposefully           │
│            │                    │                     │                 │
│            └────────────────────┼─────────────────────┘                 │
│                                 │                                       │
│                                 ▼                                       │
│                        ┌───────────────┐                               │
│                        │   TEST-CAP    │                               │
│                        │               │                               │
│                        │  • Self-heal  │                               │
│                        │  • Self-gen   │                               │
│                        │  • Self-evolve│                               │
│                        │  • Self-learn │                               │
│                        └───────────────┘                               │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### The Singularity Threshold

Testing becomes autonomous when:

```
    Adaptation Velocity ≥ Change Velocity
```

Below this threshold, testing is always falling behind the system it tests. Above it, testing **leads** the system—anticipating changes, adapting before they're needed, evolving faster than entropy can accumulate.

We are approaching this threshold. test-capabilities is the infrastructure being built to carry us across it without pretending the threshold has already been crossed.

---

## Part IV: Strategic Trajectory

### Phase 1: Consolidation (2026)

**"One config. One truthful capability contract. One mental model."**

Deliverables:
- Unified `test-capabilities.yaml` specification
- Fail-closed capability matrix for commands, flags, agents, and intelligence modes
- Typed operation kernel with thin CLI wrappers and structured result envelopes
- Supported bounded paths for CLI smoke, Bombadil exploration, quantum simulation, surf exploration, heuristic healing, and finding correlation
- Generated capability passport that distinguishes implemented, parked, unsupported, and future surfaces
- Normalized observation/finding protocol sufficient for cross-signal correlation
- The definitive LLM testing knowledge base, kept separate from unsupported runtime claims

Success: An engineer configures testing once, sees exactly what is supported, receives clear errors for everything else, and can trust every report because no capability is faked.

### Phase 2: Intelligence (2027)

**"Tests that think."**

Deliverables:
- Cross-domain correlation (web + API + CLI synthesized)
- Evidence-backed synthesis that explains why failures matter, not just that they occurred
- Failure prediction promoted only after measured precision, calibration, and false-positive budgets are explicit
- Living documentation (tests document themselves)
- Collective intelligence only with explicit opt-in, enforced anonymization, and auditable local control

Success: First operator-trusted prediction of production failure before it happens, with enough calibration evidence that acting on it is rational.

### Phase 3: Autonomy (2028+)

**"Tests that act."**

Deliverables:
- Self-healing with 95%+ accuracy on bounded, reviewed change classes
- Self-generating tests from natural language intent with human approval and deterministic verification
- Self-evolving suites that track architectural changes without erasing auditability
- Full testing autonomy with human oversight, an external checkpoint/restore authority plus Replay Fabric-style recovery ledger for rollback posture, and no hidden auto-merge authority

Success: Test suite grows and adapts without routine human maintenance while humans remain sovereign over risk-bearing changes.

---

## Part V: Design Philosophy

### The Five Tenets

#### I. Instrument, Don't Replace

test-capabilities is not a test runner. It's a **meta-layer** that makes existing tools smarter.

- You run Playwright → test-capabilities adds correlation and synthesis once the integration is wired
- You run Bombadil → test-capabilities adds bounded exploration and finding correlation today, with prediction as a later promotion
- You run BATS → test-capabilities should preserve the runner while adding cross-signal meaning

We meet you where you are. No rewrites. No lock-in.

#### II. Intelligence Has A Budget

LLM calls are expensive. We spend them only where they create leverage:

```
┌─────────────────────────────────────────────────────────────┐
│                 INTELLIGENCE ALLOCATION                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Deterministic (regex/AST/shell)  ████████████  70%         │
│  - Pattern matching                                         │
│  - Contract verification                                    │
│  - Structural analysis                                      │
│                                                             │
│  AI-Enhanced (LLM augmentation)   ████          20%         │
│  - Semantic understanding                                   │
│  - Self-healing decisions                                   │
│  - Correlation inference                                    │
│                                                             │
│  AI-Native (LLM-required)         ██            10%         │
│  - Test generation from intent                             │
│  - Natural language assertions                             │
│  - Exploratory behavior synthesis                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### III. Privacy Is Non-Negotiable

- Correlation runs locally, always
- Collective insights require explicit, auditable opt-in
- Anonymization enforced at the protocol level
- Your testing data never leaves your control

#### IV. The Human Remains Sovereign

AI proposes. Humans dispose.

- Self-healing creates PRs, doesn't merge
- Self-generating flags for review, doesn't ship
- Predictions inform decisions, don't make them

#### V. Testing Is a Continuum, Not a Checkpoint

Quality isn't binary. It's a spectrum from "broken" to "robust" through "antifragile."

test-capabilities treats testing as continuous sensing, not discrete verification.

---

## Part VI: The World We're Building

### A User's Journey (2029)

```
Engineer: "Users should be able to checkout without friction."

test-capabilities:
  ├─ Understanding intent...
  │   └─ "Checkout flow: cart → payment → confirmation"
  │
  ├─ Mapping to behaviors...
  │   ├─ Happy path: complete checkout
  │   ├─ Payment failures: retry, fallback
  │   ├─ Edge cases: empty cart, invalid address
  │   └─ Resilience: network failure, timeout
  │
  ├─ Generating tests...
  │   ├─ Property: checkout_idempotency
  │   ├─ Flow: guest_checkout, user_checkout
  │   ├─ Edge: international_payment, currency_conversion
  │   └─ Chaos: payment_gateway_latency, network_partition
  │
  ├─ Running exploration...
  │   └─ Bombadil: 1,247 paths explored in 10 minutes
  │
  ├─ Correlating findings...
  │   └─ "Checkout fails for users with non-ASCII names"
  │       Root cause: validation regex doesn't handle unicode
  │
  ├─ Creating fix PR...
  │   └─ PR #1847: "fix: support unicode in name validation"
  │
  └─ Setting up monitoring...
      └─ Prediction: "Checkout latency will spike during Black Friday"
          Recommendation: "Scale payment cluster 4x on Nov 28"
```

### The Testing Paradox, Resolved

> *The best test suite is the one you don't have to write.*

This sounds like heresy. But consider:

| Test Type | Creation Cost | Maintenance Cost | Value |
|-----------|---------------|------------------|-------|
| Written manually | High | High | Decays |
| Generated by test-capabilities | Zero | Zero | Appreciates |

A test that generates itself, maintains itself, and explores its own edges has **negative cost**—it creates more value than it consumes.

The goal is not more tests. It's **more confidence with less effort**.

---

## Epilogue: Why This Matters

Software is eating the world. Every system that matters—healthcare, finance, transportation, communication—runs on code.

The quality of that code determines whether these systems serve us or fail us.

Testing is the immune system of software. When it works, we take it for granted. When it fails, the consequences cascade.

We've accepted testing as a cost center—a necessary drag on velocity. This acceptance is a failure of imagination. Testing can be an accelerator. A competitive advantage. A source of confidence that enables bold moves rather than cautious ones.

test-capabilities exists to make this real.

The future of testing is:
- **Intelligent** — Understanding what to test, not just how
- **Adaptive** — Evolving with the systems it tests
- **Autonomous** — Requiring human oversight, not human maintenance
- **Predictive** — Preventing failures, not just detecting them

This isn't science fiction. It's the roadmap.

---

*The best time to start building the future of testing was twenty years ago. The second best time is now.*

---

*Last updated: 2026-04-30*
*Version: 2.1*
