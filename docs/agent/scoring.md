# Bot scoring — simple high-signal model

Status: active. Prefer missing bots over false bots.

## Research takeaway (browser extension constraints)

Full academic detectors use 100+ features (timing, graphs, media). We only get **DOM + passive intercepts + one AI call**. Best ROI signals that farms still struggle to fake *cheaply*:

| Signal | Strength | Notes |
|--------|----------|--------|
| You follow / mutual | Absolute | Never score as bot |
| User override | Absolute | Permanent pin |
| Extreme following/followers ratio | Very high | Follow-to-get-followed farms |
| New account + mass follow + default avatar | High | Shell farms |
| Thread near-duplicate clusters | High | Coordination (status views) |
| Reply text alone | Low–medium | Short chat is human; AI only, conservative |
| Empty bio / crypto buzzwords alone | Low | Too many FPs — do not local-flag |

Sources: Botcheck / honeypot literature (spammers follow more, young accounts), industry metadata checklists (ratio, age, default avatar), FP analysis of LLM tweet-only classifiers.

## Pipeline (order)

```
1. Override / whitelist / hard-trust     → pinned, no AI
2. Local profile gates only             → extreme ratio OR new shell stack
3. Thread near-duplicate (status only)  → bot cluster
4. Account prior (2+ strong bot hits)   → skip AI
5. AI (Haiku)                           → is_bot only if conf ≥ 0.85
6. sanitize + account stabilize         → weak is_bot demoted
```

## Local gates (must stay tiny)

**A — Extreme farm profile**  
`following ≥ 2500` AND `followers < 120` AND `ratio ≥ 30` AND known counts AND not verified.

**B — New shell**  
`age ≤ 45d` AND `following ≥ 1500` AND `followers < 80` AND `ratio ≥ 20` AND default avatar AND known counts.

No local scoring of “gm”, “true”, “great post”, etc.

## AI

Short prompt, human-default. Soft `is_bot` with conf &lt; 0.85 → human (or mild slop only if clearly filler).

## Account chip

Same @user → same chip. Account is bot only with **strong** seed or **≥2 strong hits**. Humans win ties.
