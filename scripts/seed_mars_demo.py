"""Seed a fully-populated demo project: 'Mars Migration — Phase 1: First Colony'.

Two phases:
  1. BASELINE — insert workspace, project, tasks, artifacts, decisions,
     meetings, task notes via direct SQL. Instant.
  2. AI PHASE — drive task_generation, backlog_optimizer, info_discovery,
     meeting_pre_brief, meeting_post_summary against the seeded state using
     real LLM calls. Simulates accept/reject feedback so the audit trail
     in manager_actions looks lived-in.

Usage:
  cd /Users/xieziyi/Downloads/ai-pm
  python scripts/seed_mars_demo.py                  # full run (baseline + AI)
  python scripts/seed_mars_demo.py --no-ai          # baseline only
  python scripts/seed_mars_demo.py --force          # delete existing demo and rebuild

The script is idempotent at the workspace level — if a workspace named
'Mars Migration Demo' exists, it bails unless --force is given.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import textwrap
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import UUID

# Make the backend importable when running from repo root.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from sqlalchemy import text  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine  # noqa: E402

from app.llm import manager as llm  # noqa: E402
from app.llm.prompts import load as load_prompt  # noqa: E402
from app.settings import get_settings  # noqa: E402
from app.workers.discover_findings import run_discovery  # noqa: E402


WORKSPACE_NAME = "Mars Migration Demo"
PROJECT_NAME = "Mars Migration — Phase 1: First Colony"
PROJECT_VISION = (
    "Establish a 100-person self-sustaining colony on Mars by 2040. "
    "Phase 1 covers planning, regulatory approval, and the first cargo "
    "+ habitat deliveries before the first crewed transit window in 2032."
)


# ─── BASELINE CONTENT ────────────────────────────────────────────────

# 24 tasks distributed across all 6 status columns.
TASKS: list[dict[str, Any]] = [
    # ─── done (5) — completed milestones
    {
        "title": "Complete orbital mechanics study for 2032 transit window",
        "description": "Hohmann transfer analysis, delta-v budget, optimal launch dates. Output: a 12-page reference doc that constrains the launch schedule downstream.",
        "status": "done",
        "estimated_hours": 40,
        "actual_hours": 52,
        "days_ago_completed": 28,
        "priority": 90,
    },
    {
        "title": "Initial site selection — Jezero Crater region confirmed",
        "description": "Compared 8 candidate sites against water access, dust-storm exposure, terrain, and ISRU feasibility. Jezero wins (NASA Mars 2020 baseline already mapped).",
        "status": "done",
        "estimated_hours": 24,
        "actual_hours": 28,
        "days_ago_completed": 21,
        "priority": 95,
    },
    {
        "title": "Starship payload + cadence baseline analysis",
        "description": "Establish 100t payload assumption and 4 launches per 26-month window as the planning baseline. Sensitivity-tested for ±30%.",
        "status": "done",
        "estimated_hours": 16,
        "actual_hours": 14,
        "days_ago_completed": 18,
        "priority": 80,
    },
    {
        "title": "Life-support system requirements v0.3 drafted",
        "description": "Closed-loop bioregenerative target: 95% O2 + 90% H2O recycling. Imported reserve specs for first 2 years.",
        "status": "done",
        "estimated_hours": 32,
        "actual_hours": 36,
        "days_ago_completed": 14,
        "priority": 85,
    },
    {
        "title": "Per-colonist cost projection v1 — $250M baseline",
        "description": "Five-year fully-loaded cost (transit + habitat + life support + contingency). Used to seed the funding model decision.",
        "status": "done",
        "estimated_hours": 20,
        "actual_hours": 18,
        "days_ago_completed": 10,
        "priority": 75,
    },
    # ─── in_progress (4)
    {
        "title": "Write colonist selection criteria v1",
        "description": "Physical, psychological, and skills matrices. Goal: 100-person manifest with redundancy in each critical skill (medical, engineering, agriculture, comms, etc.). Draft due end of month.",
        "status": "in_progress",
        "estimated_hours": 48,
        "actual_hours": 22,
        "priority": 90,
    },
    {
        "title": "Negotiate Starship slot reservations for 2032 window",
        "description": "Lock in 4 launch slots (2 cargo, 2 crew) with SpaceX. Currently in third round of contract review; expecting term sheet next week.",
        "status": "in_progress",
        "estimated_hours": 60,
        "actual_hours": 38,
        "priority": 100,
    },
    {
        "title": "Build pressurized-habitat module prototype (Mars-1)",
        "description": "Earth-side prototype of the first habitat module. Pressure test to 1.5x rated load. Output: mechanical drawings + a working pressurized shell for simulation week.",
        "status": "in_progress",
        "estimated_hours": 200,
        "actual_hours": 80,
        "priority": 85,
    },
    {
        "title": "Draft regulatory whitepaper — FAA + UN obligations",
        "description": "Article VI of the Outer Space Treaty makes the launching state liable. Whitepaper explains how Phase 1 satisfies US Commercial Space Launch Act + UN obligations.",
        "status": "in_progress",
        "estimated_hours": 32,
        "actual_hours": 12,
        "priority": 70,
    },
    # ─── blocked (2)
    {
        "title": "File FAA pre-launch review for Mars-1 cargo manifest",
        "description": "Submission ready but blocked on the regulatory whitepaper. Once whitepaper lands, file within 5 business days.",
        "status": "blocked",
        "estimated_hours": 8,
        "priority": 65,
    },
    {
        "title": "Close Series A funding round ($400M target)",
        "description": "Lead investor LOI signed; waiting on syndicate close. Blocking 6 downstream tasks that need budget commitments.",
        "status": "blocked",
        "estimated_hours": 80,
        "actual_hours": 60,
        "priority": 95,
    },
    # ─── ready (4)
    {
        "title": "RFP for habitat module manufacturing — 12 units",
        "description": "Solicit bids for 12 production modules following Mars-1 prototype validation. Target: 3 finalists by quarter end.",
        "status": "ready",
        "estimated_hours": 40,
        "priority": 80,
    },
    {
        "title": "Run Mars-1 simulation week (analog mission)",
        "description": "5 crew, 7 days, sealed habitat at the Utah analog site. Test life support, comms, mental-load protocols.",
        "status": "ready",
        "estimated_hours": 56,
        "priority": 75,
    },
    {
        "title": "Senate Subcommittee briefing — Phase 1 timeline + risks",
        "description": "30-minute briefing to the Subcommittee on Space and Aeronautics. Pre-clear questions with the committee staff director.",
        "status": "ready",
        "estimated_hours": 16,
        "priority": 70,
    },
    {
        "title": "Sign cooperation memo with Chang Zheng for cargo flexibility",
        "description": "Memorandum of cooperation with CASC for backup cargo delivery using 长征 launchers. Risk-mitigates Starship-only dependency.",
        "status": "ready",
        "estimated_hours": 24,
        "priority": 60,
    },
    # ─── backlog (8)
    {
        "title": "Closed-loop life-support R&D — algae-based oxygen module",
        "description": "Long-horizon research with NCSU collaborators. Algae bioreactor producing 80% of habitat O2. 18-month research timeline.",
        "status": "backlog",
        "estimated_hours": 600,
        "priority": 50,
    },
    {
        "title": "Radiation shielding research — water-wall vs regolith",
        "description": "Two shielding strategies, both partially modeled. Need empirical validation at the Brookhaven NSRL beamline.",
        "status": "backlog",
        "estimated_hours": 240,
        "priority": 55,
    },
    {
        "title": "Mars soil chemistry experiments for ISRU greenhouse",
        "description": "Perchlorate removal protocols, hydroponic vs in-regolith trials. Required input for the food-production module.",
        "status": "backlog",
        "estimated_hours": 320,
        "priority": 50,
    },
    {
        "title": "ISRU automation systems — methane production from CO2",
        "description": "Sabatier reactor sized for 4 metric tons of methane per Earth year. Critical for return-fuel production.",
        "status": "backlog",
        "estimated_hours": 480,
        "priority": 55,
    },
    {
        "title": "Mental-health protocols for 26-month isolation",
        "description": "Develop intervention playbook with NASA HRP collaborators. Includes screening, in-mission monitoring, intervention escalation.",
        "status": "backlog",
        "estimated_hours": 200,
        "priority": 45,
    },
    {
        "title": "Settlement governance charter draft",
        "description": "Legal + sociological framework for decision-making on Mars. Engages MIT Media Lab and an external constitutional scholar.",
        "status": "backlog",
        "estimated_hours": 160,
        "priority": 40,
    },
    {
        "title": "Terraforming 50-year feasibility extension study",
        "description": "Follow-up on the 50-year feasibility doc with quantitative modeling of greenhouse gas release scenarios. Lower priority — informs Phase 3+.",
        "status": "backlog",
        "estimated_hours": 280,
        "priority": 30,
    },
    {
        "title": "Crew training curriculum design (24-month program)",
        "description": "Curriculum spans engineering, medical, agriculture, comms, mental resilience. Partners: Johnson Space Center, Mayo Clinic.",
        "status": "backlog",
        "estimated_hours": 320,
        "priority": 50,
    },
    # ─── dropped (1)
    {
        "title": "Nuclear thermal propulsion exploration",
        "description": "Dropped — DOE export-control review made human-payload nuclear propulsion infeasible within Phase 1 timeline. Revisit Phase 3 if regulatory landscape shifts.",
        "status": "dropped",
        "estimated_hours": 40,
        "priority": 0,
    },
]


# 7 artifacts with substantive content (long enough to embed meaningfully).
ARTIFACTS: list[dict[str, Any]] = [
    {
        "title": "Mars surface conditions — environmental primer",
        "type": "doc",
        "linked_task_idx": None,  # unlinked — discovery should find cross-task uses
        "content": textwrap.dedent("""\
            # Mars surface conditions — environmental primer

            ## Atmosphere
            - Pressure: 0.6% of Earth sea-level (≈610 Pa at datum)
            - Composition: 95.3% CO2, 2.7% N2, 1.6% Ar, trace O2 + H2O
            - Implication: full pressure suits required outside habitat; ISRU CO2 is abundant feedstock for methane / oxygen production

            ## Radiation
            - Surface dose: ~230 µSv/day (typical day); 690 µSv/day during solar events
            - Comparable to ISS exposure but no magnetosphere shielding
            - 5-year mission cumulative dose: ~0.65 Sv (within NASA career limit for 35-yo male)
            - Requires habitat shielding equivalent to ≥30 g/cm² of low-Z material (water, regolith)

            ## Temperature
            - Average: −63 °C
            - Diurnal swing at equator: −80 °C night, +20 °C day
            - Implications: thermal cycling stress on materials; nighttime power demand spikes

            ## Dust
            - Particle size: 1-3 µm (fine)
            - Composition: silicates + iron oxides + perchlorates (toxic)
            - Major dust events: hemispheric or global, lasting weeks; reduce solar generation 80%
            - Habitat ingress is a known failure mode — airlock protocols and filtration are non-negotiable

            ## Gravity
            - 0.376 g
            - Long-term physiological impact partially known (bone density loss, vestibular adaptation)
            - Exercise + countermeasure protocols required, similar to ISS but for permanent residency
        """).strip(),
    },
    {
        "title": "Life support system requirements v0.3",
        "type": "doc",
        "linked_task_idx": 3,  # linked to "Life-support requirements v0.3 drafted" (done)
        "content": textwrap.dedent("""\
            # Life support system requirements v0.3

            ## Targets (per 100-person colony, steady state)
            - Oxygen: 84 kg/day generated (1.84 kg/person × safety factor)
            - Water: 5000 L/day recycled; 500 L/day makeup from ISRU
            - CO2 scrubbing: 100 kg/day (1.0 kg/person)
            - Food: 3500 kcal/person/day → 350 MJ/day → ~2 hectares equivalent

            ## Architecture
            - **Primary**: closed-loop bioregenerative
              - Algae bioreactor for O2 (target 80% of demand)
              - Hydroponic greenhouses for ~60% of caloric needs
              - Solid-waste composting to soil amendment
            - **Secondary**: chemical/imported reserves
              - Sabatier reactor for backup O2 from CO2
              - 2-year emergency oxygen + water cache on-site
              - Imported dehydrated food + vitamin supplements

            ## Risk model
            - Single-fault tolerance: 30-day operational margin for any one system failure
            - Two-fault tolerance: 7-day survival margin
            - Beyond two-fault: emergency evacuation to backup habitat (5 km separation)

            ## Open questions
            - Bioreactor yield variance across ±50% solar input — see radiation shielding R&D
            - Crew training requirements for system repair without resupply
        """).strip(),
    },
    {
        "title": "SpaceX Starship launch capacity analysis",
        "type": "doc",
        "linked_task_idx": 2,  # linked to "Starship payload + cadence baseline" (done)
        "content": textwrap.dedent("""\
            # SpaceX Starship launch capacity analysis

            ## Payload assumption (planning baseline)
            - 100 metric tons to Mars surface, fully reusable
            - Single-stage transit + powered landing
            - Refueling in low Earth orbit required (4-6 tanker flights per Mars mission)

            ## Cadence (per 26-month window)
            - Baseline: 4 launches per window (2 cargo, 2 crewed)
            - Stretch: 8 launches per window (Phase 2+)
            - Constraints: tanker turnaround, manifest readiness, regulatory pre-clearance

            ## Cost per kg to Mars surface (modeled)
            - 2032 window: ~$2,500/kg (declining)
            - 2034 window: ~$1,800/kg
            - 2036 window: ~$1,200/kg
            - Sensitive to refueling cadence + launch site availability

            ## Risk factors
            - SpaceX as single launch provider — see Chang Zheng backup memo
            - FAA license renewal timing (every 5 years)
            - Boca Chica site weather dispersion (10-15% loss per window)

            ## What this constrains
            - Per-colonist mass budget (transit): ~1000 kg fully-loaded
            - Cargo manifest: 6500 kg of habitat modules + 3500 kg life support per cargo flight
            - First 100-colonist arrival not earlier than 2034 (needs 2032 cargo precursor)
        """).strip(),
    },
    {
        "title": "Regulatory landscape: FAA + UN Outer Space Treaty",
        "type": "doc",
        "linked_task_idx": None,
        "content": textwrap.dedent("""\
            # Regulatory landscape: FAA + UN obligations

            ## US Commercial Space Launch Act (CSLA)
            - FAA AST issues launch + reentry licenses
            - Pre-launch safety review: ~6-9 months typical timeline
            - Mars Phase 1 needs: cargo manifest pre-approval, crew certification, return contingency plan

            ## UN Outer Space Treaty (1967), Article VI
            - Launching state is internationally liable for damage
            - US bears liability for SpaceX-launched payloads
            - Implication: any colony governance structure must satisfy US sovereignty obligations

            ## Outer Space Treaty, Article II (non-appropriation)
            - No national appropriation of celestial bodies
            - Private use is not directly addressed — Artemis Accords are the working interpretation
            - Settlement implications: ambiguous; consult with State Department before charter publication

            ## NEPA + environmental review (Earth-side)
            - Launch site environmental impact assessment required
            - Boca Chica baseline is established for Starship cadence
            - Additional review needed for Mars-1 cargo manifest if hazardous materials change

            ## Crew certification (FAA AST + AAM coordination)
            - Spaceflight participant rules apply; differ from astronaut certification
            - Informed consent disclosures mandatory
            - Medical fitness criteria still being finalized for >1-year missions

            ## Risk
            - Regulatory timeline (~18 months from full submission to launch clearance) is the schedule pacing item, NOT engineering. The whitepaper task is critical-path.
        """).strip(),
    },
    {
        "title": "Colonist selection criteria draft v0",
        "type": "doc",
        "linked_task_idx": 5,  # linked to "Write colonist selection criteria v1" (in_progress)
        "content": textwrap.dedent("""\
            # Colonist selection criteria — draft v0

            ## Composition target (100 people)
            - 35 engineers (mechanical, electrical, software, structural)
            - 15 medical professionals (physicians, surgeons, mental-health, dentistry)
            - 15 agricultural / biological scientists
            - 10 systems operators (life support, comms, power)
            - 10 construction + manufacturing specialists
            - 5 scientists (geology, exobiology)
            - 5 educators / community functions
            - 5 leadership / governance / legal

            ## Redundancy rule
            - Every critical function must have ≥3 qualified individuals (resilience to fatality)
            - Cross-training mandatory: every colonist competent in 2 functions beyond their primary

            ## Physical baseline
            - Age: 28-45 at launch
            - Height ≤ 188 cm (habitat constraint)
            - Mass ≤ 88 kg (life support sizing baseline)
            - Cardiovascular fitness: top quartile age-adjusted
            - No chronic medical conditions requiring biologics (cold chain limitations)

            ## Psychological baseline
            - 26-month isolation simulation completion
            - Big Five: low neuroticism (< 30th percentile), high conscientiousness (> 70th)
            - Family / partner separation tolerance assessed
            - No history of substance dependency in past 7 years

            ## Skills validation
            - 24-month training program completion required (Johnson Space Center + Mayo + analog missions)
            - Mars-1 simulation week pass mandatory before final selection
        """).strip(),
    },
    {
        "title": "Mars terraforming 50-year feasibility study",
        "type": "doc",
        "linked_task_idx": None,
        "content": textwrap.dedent("""\
            # Mars terraforming 50-year feasibility study

            ## Conclusion
            Material-scale terraforming on a 50-year horizon is **not feasible** with currently understood technology and resource availability. Localized habitat-zone modification is feasible and is the realistic Phase 1-3 strategy.

            ## Greenhouse gas release scenarios modeled
            - Released CO2 from polar caps + regolith: insufficient atmospheric pressure increase (max ~7 mbar from full polar sublimation)
            - Engineered super-greenhouse gases (CF4, C2F6): would need megaton-scale industrial production on Mars; ISRU implications speculative

            ## Magnetic shielding
            - L1 magnetic dipole proposal (NASA 2017): possible, but power + structure requirements remain unsolved
            - Alternative: habitat-local shielding via water walls + regolith berm — much more tractable

            ## Biome seeding
            - Extremophile microbe introductions: possible but contamination protocols (planetary protection) currently forbid

            ## Phase 1 implication
            - Habitat envelope and shielding is the path. No terraforming activities in Phase 1.
            - Recommend deferring this line of research to Phase 3 (post-2040).
        """).strip(),
    },
    {
        "title": "Per-colonist cost projection v1: $250M baseline",
        "type": "doc",
        "linked_task_idx": 4,  # linked to "cost projection v1" (done)
        "content": textwrap.dedent("""\
            # Per-colonist cost projection v1 — $250M baseline

            ## Breakdown (5-year fully-loaded, per colonist)
            - Transit (mass + share of vehicle cost): $60M
            - Habitat module share + assembly: $45M
            - Life support hardware + 2yr reserves: $35M
            - Medical + food (5-year provisioning): $25M
            - Crew training (24-mo program share): $15M
            - Regulatory + insurance + overhead allocation: $30M
            - Contingency (15%): $40M
            - **Total: $250M / colonist**

            ## Sensitivity
            - Starship launch cost: ±$30M / colonist (high impact)
            - In-situ resource utilization scale-up: −$40M / colonist by 2036 (if ISRU hits targets)
            - Regulatory delays: +$15M / quarter of delay

            ## Aggregate (Phase 1, 100 colonists)
            - **$25B total**, of which:
              - $12B by launch
              - $8B during 5-year operational phase
              - $5B contingency + Phase 2 prep
            - Implication for funding model: $400M Series A covers Phase 1 prep; subsequent rounds + government partnership cover the bulk

            ## Critical assumption
            - SpaceX maintains pricing trajectory. If Starship cost-per-kg flattens, total Phase 1 cost rises to ~$32B and the funding plan needs revision.
        """).strip(),
    },
]


# 5 decisions
DECISIONS: list[dict[str, Any]] = [
    {
        "question": "Which launch vehicle for Phase 1 primary transit?",
        "decision": "SpaceX Starship as primary launch vehicle for all Phase 1 cargo and crew transit.",
        "reasoning": "Starship is the only vehicle with sufficient payload (100t to Mars surface) and projected cadence (4+ launches per 26-month window) to support 100-colonist Phase 1. SLS is cost-prohibitive ($2B/launch vs $50M); Blue Origin's New Glenn lacks Mars-surface architecture. Chang Zheng backup (separate decision) mitigates single-provider risk.",
        "alternatives_considered": "SLS Block 2 (rejected: cost + cadence), Blue Origin New Glenn (rejected: no Mars architecture), multi-launch ISS-style assembly (rejected: complexity + Starship superseded the assembly need)",
        "days_ago_decided": 24,
        "review_weeks": 26,
    },
    {
        "question": "Phase 1 colony size: 50, 100, or 250 colonists?",
        "decision": "Phase 1 target: 100 colonists.",
        "reasoning": "50 lacks redundancy depth — losing 3 medical professionals would be catastrophic. 250 exceeds 2032-2034 launch capacity and creates governance complexity before social norms are established. 100 is the sensitivity-tested sweet spot: enough redundancy in every critical function, fits 4 launches per window, manageable governance.",
        "alternatives_considered": "50 colonists (rejected: insufficient redundancy in medical + engineering), 250 colonists (rejected: 2032 launch capacity ceiling)",
        "days_ago_decided": 21,
        "review_weeks": 26,
    },
    {
        "question": "Landing site for Phase 1 colony?",
        "decision": "Jezero Crater region. Specific landing zone within 20 km of NASA's Perseverance baseline.",
        "reasoning": "Three deciding factors: (1) water access via subsurface ice deposits already mapped; (2) NASA Mars 2020 already characterized terrain, dust, and radiation environment in detail; (3) ISRU pre-staging from Perseverance / Ingenuity legacy reduces unknowns. Trade: not the highest-volume ice deposit (that's at Korolev) but the best-characterized.",
        "alternatives_considered": "Korolev Crater (more ice, less terrain data), Utopia Planitia (flat but no subsurface water proximity), Hellas Basin (low elevation = denser atmosphere, but extreme weather and remote from existing baseline)",
        "days_ago_decided": 18,
        "review_weeks": 52,
    },
    {
        "question": "Life support architecture — closed-loop or imported?",
        "decision": "Closed-loop bioregenerative as primary system; imported reserves as 2-year secondary backup.",
        "reasoning": "Imported-only is mass-prohibitive (≥3500 kg/colonist over 5 years). Closed-loop is mass-efficient but failure-mode-sensitive. Hybrid gives a 30-day single-fault margin without requiring 100% reliability on the bioregenerative system. Imported reserves degrade to emergency-only after year 2; by then the system is proven or the colony evacuates.",
        "alternatives_considered": "Fully closed-loop from day 1 (rejected: insufficient ground testing), fully imported (rejected: launch mass), nuclear-thermal life support (rejected with the nuclear propulsion task)",
        "days_ago_decided": 12,
        "review_weeks": 26,
    },
    {
        "question": "Funding model for Phase 1?",
        "decision": "70% government partnership (NASA contract + DARPA + appropriations) / 30% private capital. Series A is private bridge funding to qualify for the larger government commitments.",
        "reasoning": "Pure-private is not credible at this cost ($25B) without dilution that breaks founder economics. Pure-government creates schedule risk (appropriations cycles). 70/30 mirrors Apollo-era cooperative model. Series A unlocks the 'shovel-ready' demonstration that triggers larger government commitments at the FY27 budget cycle.",
        "alternatives_considered": "100% private (rejected: unachievable at scale), 100% government (rejected: appropriations risk), 50/50 (rejected: government partners insist on majority involvement for liability reasons)",
        "days_ago_decided": 7,
        "review_weeks": 13,
    },
]


# 3 meetings
MEETINGS: list[dict[str, Any]] = [
    {
        "type": "biweekly_planning",
        "days_offset": 1,  # +1 day from now
        "attendees_count": 4,
        "notes": None,  # pre-brief will be AI-generated; no notes yet
    },
    {
        "type": "weekly_retro",
        "days_offset": -6,
        "attendees_count": 4,
        "notes": textwrap.dedent("""\
            ## Week recap

            Pretty heavy week on the regulatory side. Ziyi spent most of it on the FAA whitepaper draft — he says it's about 60% done. The blocker is that we want to cite the cost-projection numbers but those are still v1, and we're not sure if v1 is the right anchor for the regulators.

            Chen finished the colonist criteria v0 and circulated it. Big debate in the team chat about whether we're under-weighting medical redundancy. Lana made the call that we want ≥3 in every critical function and Chen will update v0 → v1 by Friday.

            Habitat prototype: prototype shell is now under pressure test at Stennis. First leak detected at 0.9x rated load — Ziyi says probably a gasket and not structural, but he wants to run it again Monday before declaring.

            Series A: we got Sequoia's term sheet. It's competitive but they want a board observer seat, which we previously said no to. Will discuss next planning meeting.

            ## Action items mentioned (for post-summary to pick up)

            - Chen will update colonist criteria from v0 to v1 by Friday
            - Ziyi will rerun the habitat pressure test Monday and either declare pass or escalate the leak finding
            - Lana to brief Senator Padilla's office on the FAA timeline before Thursday — she committed to the call
            - We decided to drop the nuclear propulsion exploration completely — DOE export-control made it infeasible

            Out of scope this meeting:
            - Funding model details (next time, after Sequoia term sheet review)
            - Phase 2 planning (way too early)
        """).strip(),
    },
    {
        "type": "daily_ops",
        "days_offset": -1,
        "attendees_count": 3,
        "notes": textwrap.dedent("""\
            ## Async standup

            **Ziyi**: FAA whitepaper 60% → 70%. Pressure test scheduled Monday morning.

            **Chen**: Colonist v0 circulated, working on v1 with redundancy expansion.

            **Lana**: Padilla's office responded — call set for Wednesday 11am PT.

            No blockers, no decisions needed.
        """).strip(),
    },
]


# 8 task notes — messages with task_id non-null
TASK_NOTES: list[dict[str, Any]] = [
    # Indexed against TASKS list above
    {"task_idx": 5, "content": "Big Five psychological test calibration meeting with Mayo Clinic — Tuesday 2pm PT. Bringing the v0 criteria + 3 case studies.", "days_ago": 2},
    {"task_idx": 5, "content": "Chen called out that we're under-weighting medical redundancy. Increasing ≥3 medical professionals per critical specialty (currently 2). Updating selection matrix.", "days_ago": 1},
    {"task_idx": 6, "content": "SpaceX legal sent revised term sheet — slot pricing is locked but they want first-right-of-refusal on cargo manifest reveal. Need to discuss internally before counter.", "days_ago": 4},
    {"task_idx": 6, "content": "Term sheet revision circulated. Internal review meeting Thursday 10am.", "days_ago": 1},
    {"task_idx": 7, "content": "First leak detected at 0.9x rated pressure. Visual inspection suggests gasket failure not structural. Rerun scheduled Monday.", "days_ago": 0},
    {"task_idx": 8, "content": "Outline approved by external counsel. Section on Article VI liability is the trickiest — need to coordinate with State Department before publication.", "days_ago": 3},
    {"task_idx": 10, "content": "Sequoia term sheet received. Competitive but they want board observer. Counter-offering: information rights without observer seat.", "days_ago": 2},
    {"task_idx": 11, "content": "Padilla's office confirmed Wednesday 11am for briefing call. Preparing 1-pager.", "days_ago": 0},
]


# ─── HELPERS ─────────────────────────────────────────────────────────


def now_utc() -> datetime:
    return datetime.now(UTC)


async def _fetch_oldest_user_id(session: AsyncSession) -> UUID | None:
    """Find a user to assign as founder + owner of seeded tasks/decisions."""
    row = (
        await session.execute(
            text("select id from public.users order by id limit 1")
        )
    ).first()
    return UUID(str(row[0])) if row else None


async def _workspace_exists(session: AsyncSession) -> UUID | None:
    row = (
        await session.execute(
            text("select id from public.workspaces where name = :n"),
            {"n": WORKSPACE_NAME},
        )
    ).first()
    return UUID(str(row[0])) if row else None


async def _drop_demo(session: AsyncSession, ws_id: UUID) -> None:
    """--force path: remove the demo workspace + cascade."""
    # First detach any users still pointing at this workspace.
    await session.execute(
        text("update public.users set workspace_id = null where workspace_id = :ws"),
        {"ws": str(ws_id)},
    )
    await session.execute(
        text("delete from public.workspaces where id = :ws"),
        {"ws": str(ws_id)},
    )


# ─── BASELINE INSERT ─────────────────────────────────────────────────


async def insert_baseline(
    session: AsyncSession, founder_id: UUID | None
) -> dict[str, Any]:
    """Insert workspace + project + tasks + artifacts + decisions + meetings + notes.

    Returns dict with workspace_id, project_id, and ordered task_ids /
    artifact_ids / meeting_ids for the AI phase to reference.
    """
    print("  Creating workspace + project...")
    ws_row = (
        await session.execute(
            text("insert into public.workspaces (name) values (:n) returning id"),
            {"n": WORKSPACE_NAME},
        )
    ).first()
    assert ws_row is not None
    ws_id = UUID(str(ws_row[0]))

    prj_row = (
        await session.execute(
            text(
                """
                insert into public.projects
                  (workspace_id, name, vision, current_stage, preferences)
                values (:ws, :n, :v, 'validation', cast(:prefs as jsonb))
                returning id
                """
            ),
            {
                "ws": str(ws_id),
                "n": PROJECT_NAME,
                "v": PROJECT_VISION,
                "prefs": json.dumps({"speed": 0.2, "quality": 0.6, "cost": 0.2}),
            },
        )
    ).first()
    assert prj_row is not None
    prj_id = UUID(str(prj_row[0]))

    # Tasks
    print(f"  Inserting {len(TASKS)} tasks...")
    task_ids: list[UUID] = []
    for t in TASKS:
        completed_at = None
        if t["status"] == "done" and "days_ago_completed" in t:
            completed_at = now_utc() - timedelta(days=t["days_ago_completed"])
        row = (
            await session.execute(
                text(
                    """
                    insert into public.tasks
                      (project_id, title, description, status, priority,
                       estimated_hours, actual_hours, owner_id, created_by,
                       completed_at)
                    values (:pid, :title, :desc, :status, :priority,
                            :est, :actual, :owner, 'human', :done_at)
                    returning id
                    """
                ),
                {
                    "pid": str(prj_id),
                    "title": t["title"],
                    "desc": t["description"],
                    "status": t["status"],
                    "priority": t["priority"],
                    "est": t["estimated_hours"],
                    "actual": t.get("actual_hours"),
                    "owner": str(founder_id) if founder_id else None,
                    "done_at": completed_at,
                },
            )
        ).first()
        assert row is not None
        task_ids.append(UUID(str(row[0])))

    # Artifacts
    print(f"  Inserting {len(ARTIFACTS)} artifacts...")
    artifact_ids: list[UUID] = []
    for a in ARTIFACTS:
        linked_task = (
            task_ids[a["linked_task_idx"]] if a.get("linked_task_idx") is not None else None
        )
        row = (
            await session.execute(
                text(
                    """
                    insert into public.artifacts
                      (project_id, task_id, type, title, content)
                    values (:pid, :tid, :type, :title, :content)
                    returning id
                    """
                ),
                {
                    "pid": str(prj_id),
                    "tid": str(linked_task) if linked_task else None,
                    "type": a["type"],
                    "title": a["title"],
                    "content": a["content"],
                },
            )
        ).first()
        assert row is not None
        artifact_ids.append(UUID(str(row[0])))

    # Decisions
    print(f"  Inserting {len(DECISIONS)} decisions...")
    for d in DECISIONS:
        decided_at = now_utc() - timedelta(days=d["days_ago_decided"])
        review_at = decided_at + timedelta(weeks=d["review_weeks"])
        await session.execute(
            text(
                """
                insert into public.decisions
                  (project_id, question, decision, reasoning,
                   alternatives_considered, decided_by, decided_at, review_at)
                values (:pid, :q, :d, :r, :alt, :who, :da, :ra)
                """
            ),
            {
                "pid": str(prj_id),
                "q": d["question"],
                "d": d["decision"],
                "r": d["reasoning"],
                "alt": d["alternatives_considered"],
                "who": str(founder_id) if founder_id else None,
                "da": decided_at,
                "ra": review_at,
            },
        )

    # Meetings
    print(f"  Inserting {len(MEETINGS)} meetings...")
    meeting_ids: list[UUID] = []
    for m in MEETINGS:
        scheduled = now_utc() + timedelta(days=m["days_offset"])
        attendees = [founder_id] if founder_id else []
        row = (
            await session.execute(
                text(
                    """
                    insert into public.meetings
                      (project_id, type, scheduled_at, attendees, notes)
                    values (:pid, :type, :sa, :att, :notes)
                    returning id
                    """
                ),
                {
                    "pid": str(prj_id),
                    "type": m["type"],
                    "sa": scheduled,
                    "att": attendees,
                    "notes": m.get("notes"),
                },
            )
        ).first()
        assert row is not None
        meeting_ids.append(UUID(str(row[0])))

    # Task notes (messages)
    print(f"  Inserting {len(TASK_NOTES)} task notes...")
    for n in TASK_NOTES:
        task_id = task_ids[n["task_idx"]]
        created_at = now_utc() - timedelta(days=n["days_ago"])
        await session.execute(
            text(
                """
                insert into public.messages
                  (project_id, task_id, sender_type, sender_id, content,
                   channel, created_at)
                values (:pid, :tid, 'user', :sid, :content, 'in_app', :ca)
                """
            ),
            {
                "pid": str(prj_id),
                "tid": str(task_id),
                "sid": str(founder_id) if founder_id else None,
                "content": n["content"],
                "ca": created_at,
            },
        )

    return {
        "workspace_id": ws_id,
        "project_id": prj_id,
        "task_ids": task_ids,
        "artifact_ids": artifact_ids,
        "meeting_ids": meeting_ids,
        "founder_id": founder_id,
    }


# ─── AI PHASE ────────────────────────────────────────────────────────


async def _build_project_state_snapshot(
    session: AsyncSession, project_id: UUID
) -> str:
    """Mirrors the live endpoints' project-state builder; condensed."""
    project = (
        await session.execute(
            text(
                "select name, vision, current_stage, preferences from public.projects where id = :pid"
            ),
            {"pid": str(project_id)},
        )
    ).first()
    assert project is not None

    teammates = (
        await session.execute(
            text(
                """
                select coalesce(u.name, u.email) as name, u.email, u.role
                from public.users u
                """
            )
        )
    ).all()

    active_tasks = (
        await session.execute(
            text(
                """
                select id, title, status, estimated_hours, priority
                from public.tasks
                where project_id = :pid
                  and status in ('ready','in_progress','blocked','backlog')
                order by priority desc, created_at desc
                limit 30
                """
            ),
            {"pid": str(project_id)},
        )
    ).all()

    recent_decisions = (
        await session.execute(
            text(
                """
                select decision, reasoning, decided_at
                from public.decisions
                where project_id = :pid
                order by decided_at desc
                limit 8
                """
            ),
            {"pid": str(project_id)},
        )
    ).all()

    lines = [
        "# Project state snapshot",
        f"Name: {project[0]}",
        f"Vision: {project[1] or '—'}",
        f"Current stage: {project[2]}",
        f"Preferences: {project[3]}",
        "",
        "## Teammates",
    ]
    for tm in teammates:
        lines.append(f"- {tm[0]} <{tm[1]}> ({tm[2]})")

    lines.append("")
    lines.append("## Active tasks (id · title · status · priority · est hours)")
    for t in active_tasks:
        lines.append(f"- {t[0]} · {t[1]} · {t[2]} · pri {t[4]} · est {t[3] or '—'}h")

    lines.append("")
    lines.append("## Recent decisions")
    for d in recent_decisions:
        lines.append(
            f"- {d[2].date().isoformat()}: {d[0]} — {d[1] or 'no reasoning'}"
        )

    return "\n".join(lines)


async def _run_task_generation(
    session: AsyncSession, context: dict[str, Any]
) -> None:
    """Real task_generation call + simulated accept/reject feedback."""
    print("  AI: task_generation...")
    brainstorm = (
        "We need to think about the long-term sustainability of the 100-colonist Phase 1. "
        "Specifically: what redundancy do we need in non-obvious places (mental health, "
        "education for colonist children if any, governance dispute resolution)? Surface 5-8 "
        "concrete tasks that we should have on the backlog but probably don't think about often enough."
    )

    stable_system = load_prompt("task_generation_system")
    project_state = await _build_project_state_snapshot(session, context["project_id"])

    user_query = f"## User brainstorm\n{brainstorm}"
    messages = llm.build_messages(
        stable_system=stable_system,
        project_state=project_state,
        user_query=user_query,
    )

    try:
        content, _usage = await llm.generate(
            task_type="task_generation",
            messages=messages,
            session=session,
            project_id=context["project_id"],
            workspace_id=context["workspace_id"],
            response_format={"type": "json_object"},
            temperature=0.4,
            max_tokens=4096,
            audit_input={"brainstorm_len": len(brainstorm), "demo_seed": True},
        )
    except Exception as exc:
        print(f"    ⚠️  task_generation skipped: {exc}")
        return

    try:
        parsed = json.loads(content)
        proposed = parsed.get("tasks") or []
    except json.JSONDecodeError:
        print("    ⚠️  task_generation: non-JSON response, skipping persist")
        return

    if not proposed:
        print("    (no tasks proposed — leaving manager_action as-is)")
        return

    # Simulate accept/reject: keep first N-2 as-is, edit one, reject one
    action_id_row = (
        await session.execute(
            text(
                "select id from public.manager_actions where project_id = :pid "
                "and action_type = 'task_generation' order by created_at desc limit 1"
            ),
            {"pid": str(context["project_id"])},
        )
    ).first()
    if not action_id_row:
        return
    ma_id = action_id_row[0]

    summary = {"accepted": 0, "edited": 0, "rejected": 0}
    feedback: list[dict[str, Any]] = []
    new_task_ids: list[UUID] = []

    for i, prop in enumerate(proposed):
        if i == len(proposed) - 1 and len(proposed) > 2:
            # Reject the last one
            summary["rejected"] += 1
            feedback.append({
                "index": i,
                "proposed_title": prop.get("title"),
                "action": "reject",
                "reason_chip": "wrong_stage",
                "reason_free": "Phase 1 validation — we're not ready for this until Phase 2 prep starts.",
            })
            continue

        title = prop.get("title", "(untitled)")
        desc = prop.get("description")
        est = prop.get("estimated_hours")
        edited = i == 1  # edit the second one
        if edited:
            title = f"[refined] {title}"

        new_row = (
            await session.execute(
                text(
                    """
                    insert into public.tasks
                      (project_id, title, description, estimated_hours,
                       owner_id, created_by, status)
                    values (:pid, :title, :desc, :est, :owner, 'ai', 'backlog')
                    returning id
                    """
                ),
                {
                    "pid": str(context["project_id"]),
                    "title": title,
                    "desc": desc,
                    "est": est,
                    "owner": str(context["founder_id"]) if context["founder_id"] else None,
                },
            )
        ).first()
        assert new_row is not None
        new_task_ids.append(UUID(str(new_row[0])))

        if edited:
            summary["edited"] += 1
        else:
            summary["accepted"] += 1
        feedback.append({
            "index": i,
            "task_id": str(new_row[0]),
            "action": "edit" if edited else "accept",
            "original": {"title": prop.get("title"), "description": prop.get("description")},
            "final": {"title": title, "description": desc},
        })

    await session.execute(
        text(
            """
            update public.manager_actions
              set accepted_by_human = :acc,
                  human_feedback = cast(:fb as text)
              where id = :id
            """
        ),
        {
            "acc": summary["accepted"] + summary["edited"] > 0,
            "fb": json.dumps({"summary": summary, "decisions": feedback}, ensure_ascii=False),
            "id": str(ma_id),
        },
    )
    print(f"    ✓ {summary['accepted']} accepted, {summary['edited']} edited, {summary['rejected']} rejected")


async def _run_optimizer(session: AsyncSession, context: dict[str, Any]) -> None:
    """Real backlog_optimizer call + simulated mixed feedback."""
    print("  AI: backlog_optimizer...")

    stable_system = load_prompt("backlog_optimizer_system")
    project_state = await _build_project_state_snapshot(session, context["project_id"])

    user_query = "Please scan the backlog and produce a weekly review."

    messages = llm.build_messages(
        stable_system=stable_system,
        project_state=project_state,
        user_query=user_query,
    )

    try:
        content, _usage = await llm.generate(
            task_type="backlog_optimizer",
            messages=messages,
            session=session,
            project_id=context["project_id"],
            workspace_id=context["workspace_id"],
            response_format={"type": "json_object"},
            temperature=0.3,
            max_tokens=2048,
            audit_input={"trigger": "demo_seed"},
        )
    except Exception as exc:
        print(f"    ⚠️  optimizer skipped: {exc}")
        return

    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        print("    ⚠️  optimizer: non-JSON, skipping persist")
        return

    action_id_row = (
        await session.execute(
            text(
                "select id from public.manager_actions where project_id = :pid "
                "and action_type = 'backlog_optimizer' order by created_at desc limit 1"
            ),
            {"pid": str(context["project_id"])},
        )
    ).first()
    if not action_id_row:
        return
    ma_id = action_id_row[0]

    summary = {"accepted": 0, "edited": 0, "rejected": 0}
    applied = {"reorders": 0, "drops": 0, "adds": 0}
    decisions: list[dict[str, Any]] = []

    # Accept first 2 reorders, reject any add (demo: shows mixed signal)
    for i, r in enumerate((parsed.get("reorder") or [])[:2]):
        tid = r.get("task_id")
        if not tid:
            continue
        try:
            await session.execute(
                text("update public.tasks set priority = :p where id = cast(:tid as uuid) and project_id = :pid"),
                {"p": int(r.get("new_priority", 50)), "tid": str(tid), "pid": str(context["project_id"])},
            )
            applied["reorders"] += 1
            summary["accepted"] += 1
            decisions.append({"kind": "reorder", "target_index": i, "action": "accept", "original": r, "final": r})
        except Exception:
            continue

    for i, add in enumerate((parsed.get("adds") or [])[:1]):
        summary["rejected"] += 1
        decisions.append({
            "kind": "add",
            "target_index": i,
            "action": "reject",
            "reject_reason_chip": "wrong_timing",
            "reject_reason_free": "Good catch but we're not ready to staff this — Phase 1 capacity is committed elsewhere.",
        })

    await session.execute(
        text(
            """
            update public.manager_actions
              set accepted_by_human = :acc,
                  human_feedback = cast(:fb as text)
              where id = :id
            """
        ),
        {
            "acc": summary["accepted"] > 0,
            "fb": json.dumps({"summary": summary, "applied": applied, "decisions": decisions}, ensure_ascii=False),
            "id": str(ma_id),
        },
    )
    print(f"    ✓ {applied['reorders']} reorders applied, {summary['rejected']} rejected with reason")


async def _run_discovery(session: AsyncSession, context: dict[str, Any]) -> None:
    """Real cross-task discovery via the existing standalone worker."""
    print("  AI: info_discovery (embeds artifacts + finds)...")
    try:
        result = await run_discovery(session, context["project_id"], context["workspace_id"])
    except Exception as exc:
        print(f"    ⚠️  discovery skipped: {exc}")
        return

    print(f"    ✓ {result['written']} findings written from {result['candidate_count']} candidate pairs")

    # Mix the findings statuses: acknowledge first, link second, dismiss third
    if result["finding_ids"]:
        statuses = ["acknowledged", "linked", "dismissed"]
        chips = [None, None, "not_relevant"]
        notes = [None, "Promoted into a sub-task on the colonist criteria.", None]
        for i, fid in enumerate(result["finding_ids"][:3]):
            await session.execute(
                text(
                    """
                    update public.findings
                      set status = :st,
                          dismiss_reason = :ds,
                          feedback_note = :note,
                          resolved_at = now()
                      where id = cast(:fid as uuid)
                    """
                ),
                {
                    "st": statuses[i],
                    "ds": chips[i],
                    "note": notes[i],
                    "fid": str(fid),
                },
            )


async def _run_pre_brief(session: AsyncSession, context: dict[str, Any]) -> None:
    """Real meeting pre-brief on the biweekly_planning meeting."""
    print("  AI: meeting_pre_brief on Q1 Planning...")
    meeting_id = context["meeting_ids"][0]  # biweekly_planning

    meeting = (
        await session.execute(
            text(
                "select type, scheduled_at, attendees from public.meetings where id = :mid"
            ),
            {"mid": str(meeting_id)},
        )
    ).first()
    if not meeting:
        return

    stable_system = load_prompt("meeting_pre_brief_system")
    project_state = await _build_project_state_snapshot(session, context["project_id"])

    user_query = (
        f"## This meeting\n"
        f"Type: {meeting[0]}\n"
        f"Scheduled: {meeting[1].isoformat() if meeting[1] else 'TBD'}\n"
        f"Attendee count: {len(meeting[2] or [])}\n\n"
        f"Please draft the pre-brief markdown."
    )

    messages = llm.build_messages(
        stable_system=stable_system,
        project_state=project_state,
        user_query=user_query,
    )

    try:
        content, _usage = await llm.generate(
            task_type="meeting_pre_brief",
            messages=messages,
            session=session,
            project_id=context["project_id"],
            workspace_id=context["workspace_id"],
            temperature=0.3,
            max_tokens=2048,
            audit_input={"meeting_id": str(meeting_id), "demo_seed": True},
        )
    except Exception as exc:
        print(f"    ⚠️  pre_brief skipped: {exc}")
        return

    # Save as both ai_pre_brief (audit copy) and agenda.markdown (final accepted)
    await session.execute(
        text(
            """
            update public.meetings
              set ai_pre_brief = :md,
                  agenda = jsonb_set(coalesce(agenda, cast('{}' as jsonb)),
                                     '{markdown}',
                                     to_jsonb(cast(:md as text)))
              where id = :mid
            """
        ),
        {"md": content, "mid": str(meeting_id)},
    )

    # Update manager_action to show accepted
    action_id_row = (
        await session.execute(
            text(
                "select id from public.manager_actions where project_id = :pid "
                "and action_type = 'meeting_pre_brief' order by created_at desc limit 1"
            ),
            {"pid": str(context["project_id"])},
        )
    ).first()
    if action_id_row:
        await session.execute(
            text(
                """
                update public.manager_actions
                  set accepted_by_human = true,
                      human_feedback = cast(:fb as text)
                  where id = :id
                """
            ),
            {
                "fb": json.dumps({"action": "accept", "final_markdown": content, "reason": None}),
                "id": str(action_id_row[0]),
            },
        )
    print("    ✓ pre-brief accepted as-is")


async def _run_post_summary(session: AsyncSession, context: dict[str, Any]) -> None:
    """Real meeting post-summary on the weekly_retro meeting (which has notes)."""
    print("  AI: meeting_post_summary on Weekly Retro...")
    meeting_id = context["meeting_ids"][1]  # weekly_retro
    meeting = (
        await session.execute(
            text(
                "select type, notes from public.meetings where id = :mid"
            ),
            {"mid": str(meeting_id)},
        )
    ).first()
    if not meeting or not meeting[1]:
        return

    stable_system = load_prompt("meeting_post_summary_system")
    project_state = await _build_project_state_snapshot(session, context["project_id"])

    user_query = (
        f"## This meeting\n"
        f"Type: {meeting[0]}\n"
        f"## Notes\n{meeting[1]}"
    )

    messages = llm.build_messages(
        stable_system=stable_system,
        project_state=project_state,
        user_query=user_query,
    )

    try:
        content, _usage = await llm.generate(
            task_type="meeting_post_summary",
            messages=messages,
            session=session,
            project_id=context["project_id"],
            workspace_id=context["workspace_id"],
            response_format={"type": "json_object"},
            temperature=0.2,
            max_tokens=2048,
            audit_input={"meeting_id": str(meeting_id), "demo_seed": True},
        )
    except Exception as exc:
        print(f"    ⚠️  post_summary skipped: {exc}")
        return

    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        print("    ⚠️  post_summary: non-JSON, skipping")
        return

    action_items = parsed.get("action_items") or []
    summary_text = parsed.get("summary") or "Weekly retro summary"

    action_id_row = (
        await session.execute(
            text(
                "select id from public.manager_actions where project_id = :pid "
                "and action_type = 'meeting_post_summary' order by created_at desc limit 1"
            ),
            {"pid": str(context["project_id"])},
        )
    ).first()
    if not action_id_row:
        return
    ma_id = action_id_row[0]

    counts = {"accepted": 0, "edited": 0, "rejected": 0}
    feedback: list[dict[str, Any]] = []

    # Accept 2, reject last (if 3+)
    for i, item in enumerate(action_items):
        if i >= 2 and i == len(action_items) - 1:
            counts["rejected"] += 1
            feedback.append({
                "index": i,
                "proposed_title": item.get("title"),
                "action": "reject",
                "reason_chip": "duplicate",
                "reason_free": "Already covered by existing task.",
            })
            continue
        title = item.get("title", "(untitled)")
        new_row = (
            await session.execute(
                text(
                    """
                    insert into public.tasks
                      (project_id, title, description, estimated_hours,
                       owner_id, created_by, status)
                    values (:pid, :title, :desc, :est, :owner, 'ai', 'backlog')
                    returning id
                    """
                ),
                {
                    "pid": str(context["project_id"]),
                    "title": title,
                    "desc": item.get("description"),
                    "est": item.get("estimated_hours"),
                    "owner": str(context["founder_id"]) if context["founder_id"] else None,
                },
            )
        ).first()
        counts["accepted"] += 1
        feedback.append({
            "index": i,
            "task_id": str(new_row[0]) if new_row else None,
            "action": "accept",
            "original": item,
            "final": item,
        })

    tally = f"{counts['accepted']} accepted, {counts['edited']} edited, {counts['rejected']} rejected"
    await session.execute(
        text(
            """
            update public.meetings set ai_post_summary = :s where id = :mid
            """
        ),
        {"s": tally, "mid": str(meeting_id)},
    )
    await session.execute(
        text(
            """
            update public.manager_actions
              set accepted_by_human = :acc,
                  human_feedback = cast(:fb as text)
              where id = :id
            """
        ),
        {
            "acc": counts["accepted"] > 0,
            "fb": json.dumps({"summary": counts, "decisions": feedback, "ai_summary": summary_text}, ensure_ascii=False),
            "id": str(ma_id),
        },
    )
    print(f"    ✓ {counts['accepted']} action items accepted → tasks, {counts['rejected']} rejected")


# ─── MAIN ────────────────────────────────────────────────────────────


async def main(args: argparse.Namespace) -> None:
    settings = get_settings()
    if not settings.database_url:
        print("ERROR: DATABASE_URL is empty. Check .env.")
        sys.exit(1)

    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    async with engine.begin() as conn:
        # Idempotency / force handling
        existing = await _workspace_exists(conn)
        if existing and not args.force:
            print(
                f"Workspace '{WORKSPACE_NAME}' already exists (id={existing}). "
                "Pass --force to drop and rebuild."
            )
            return
        if existing and args.force:
            print(f"--force: dropping existing workspace {existing}...")
            await _drop_demo(conn, existing)

        founder_id = await _fetch_oldest_user_id(conn)
        if not founder_id:
            print(
                "ERROR: no users in public.users — sign in to the app first so an account exists, then re-run."
            )
            return

        print(f"Founder user: {founder_id}")
        print(f"\n=== Phase 1 — baseline insert ===")
        context = await insert_baseline(conn, founder_id)
        print(f"\nBaseline complete:")
        print(f"  Workspace: {context['workspace_id']}")
        print(f"  Project:   {context['project_id']}")
        print(f"  Tasks:     {len(context['task_ids'])}")
        print(f"  Artifacts: {len(context['artifact_ids'])}")
        print(f"  Meetings:  {len(context['meeting_ids'])}")

        if args.no_ai:
            print("\n--no-ai: skipping AI orchestration phase.")
        else:
            print(f"\n=== Phase 2 — AI orchestration ===")
            print("(This calls Moonshot + Qwen — ~2-3 min, ~$1 in tokens)")
            await _run_task_generation(conn, context)
            await _run_optimizer(conn, context)
            await _run_discovery(conn, context)
            await _run_pre_brief(conn, context)
            await _run_post_summary(conn, context)

        print(f"\n=== Done ===")
        print(f"Visit: https://ai-product-manager-self.vercel.app/projects/{context['project_id']}")

    await engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed the Mars Migration demo project.")
    parser.add_argument(
        "--force",
        action="store_true",
        help="Drop and rebuild the existing demo workspace if present",
    )
    parser.add_argument(
        "--no-ai",
        action="store_true",
        help="Skip the AI orchestration phase (faster iteration on baseline content)",
    )
    args = parser.parse_args()
    asyncio.run(main(args))
