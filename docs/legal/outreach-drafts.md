# Legal and attribution outreach drafts

These are review drafts. They have not been sent. Replace bracketed identity
fields, verify every factual statement, and approve the final text before any
message leaves the project.

## Paizo licensing clarification

**To:** `licensing@paizo.com`

**Subject:** Free Foundry VTT character-builder: Community Use and attribution clarification

> Hello Paizo Licensing,
>
> I maintain Wayfinder, a free and unofficial Foundry Virtual Tabletop module
> that guides character creation for Pathfinder Second Edition. It requires a
> separately installed PF2E Foundry system, reads installed compendia at
> runtime, and does not package Paizo books or compendium packs.
>
> We are separating Wayfinder's original software license from its rules and
> attribution notices. Release is blocked while we resolve whether every
> retained mechanic can use an ORC source or whether any OGL-only implementation
> must be removed or isolated as a genuinely separate Work. We also intend to use
> the current Community Use Policy notice and keep the project freely accessible
> without a paywall. We do not use the Pathfinder Compatibility Logo or
> Pathfinder-Icons font, and the prior screenshots containing interior artwork
> and long rules previews have been removed.
>
> Could you please clarify two narrow points?
>
> 1. For a free software add-on using limited descriptive Pathfinder/PF2E
>    compatibility references under the August 22, 2024 Community Use Policy,
>    do you require any additional software-specific trademark permission
>    beyond compliance with that policy and the applicable ORC/OGL notices?
> 2. What exact ORC attribution text should downstream users reproduce for
>    Pathfinder Guns & Gears Remastered, Pathfinder Impossible Magic, and
>    Pathfinder Dark Archive (Remastered)? The current PF2E system notice has a
>    `TBD` for the first and does not list the latter two. We can supply the
>    provisional creator strings we found if useful.
>
> Project: https://github.com/bestlux/wayfinder
>
> Foundry listing: https://foundryvtt.com/packages/wayfinder-pf2e
>
> Thank you,
>
> [legal name or entity]
>
> [reply email]

This asks for policy and attribution clarification, not blanket approval or
legal advice.

## PF2E maintainer report

Preferred channel: the PF2E Discord named in the project's contributing guide,
or a concise upstream issue if maintainers request one. Do not submit an
AI-authored pull request; the current PF2E contribution policy disallows it.

**Title:** PF2E 8.4 ORC attribution gaps and Kineticist license mismatch

> While building a downstream rules-source ledger against PF2E 8.4.0 commit
> `90132e99cb2c7617e4f0131b6010c6ee6f8ec5b1`, I found four attribution/data
> inconsistencies:
>
> - `static/licenses/ORCLicense.md` lists Pathfinder Guns & Gears Remastered
>   authors as `TBD`;
> - the notice does not list Pathfinder Impossible Magic;
> - the notice does not list Pathfinder Dark Archive (Remastered); and
> - Kineticist content is marked OGL/remastered in publication metadata while
>   the global ORC notice attributes Pathfinder Rage of Elements.
>
> Is there a canonical upstream attribution string and intended license value
> for these entries? I am happy to provide exact paths/records. I am looking
> for source-of-truth clarification, not permission on behalf of Paizo.

## Foundry package presentation question

This is optional; the published package-development license already covers an
ordinary free module.

**To:** https://foundryvtt.com/contact-us/

**Subject:** Legal-file presentation for package `wayfinder-pf2e`

> We are updating an existing free package to ship a layered legal entry point,
> separate ORC and OGL notices, third-party notices, and a machine-readable
> source ledger. Is `module.json.license` pointing to the bundled `LEGAL.md`
> sufficient for the Foundry package listing, or is any additional manifest or
> in-app presentation expected?

## Attorney review brief

If obtaining a short specialist review, ask only for conclusions the release
process can act on:

1. Is the `LICENSE.md` carve-out sufficient to avoid placing ORC/OGL material
   under Wayfinder's proprietary software terms?
2. Because the ORC defines a single-game product as one Work and its AxE says
   OGL content cannot be relicensed into an ORC product, is any separate-work
   structure viable here, or must every OGL-derived mechanic be removed and
   cleanly reimplemented from ORC sources?
3. Is the OGL Section 8 identification precise enough for mechanics embodied in
   software without unnecessarily licensing the implementation code if any
   genuinely separate OGL Work remains?
4. Should Magus, Summoner, and Psychic remain dual-noticed, or should their
   current implementations be cleanly re-derived from the 2026 ORC books?
5. Does the current free-access model and compatibility naming comply with the
   August 22, 2024 Community Use Policy?
6. Are any current branding elements likely to imply Paizo sponsorship or use
   protected trade dress?
7. Given the active third-party game-software registrations for `WAYFINDER`,
   should the project rename before wider distribution?

The reviewer should receive `LEGAL.md`, `LICENSE.md`, `licenses/`, the packaged
ledger, and representative source diffs—not account credentials or purchased
PDF files.

Do not contact Airship Syndicate or another trademark owner for consent before
focused trademark counsel reviews the search results and recommends whether to
rename, seek coexistence, or pursue another disposition. An unnecessary direct
approach can create avoidable admissions or negotiation pressure.
