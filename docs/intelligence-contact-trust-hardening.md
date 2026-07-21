# Intelligence and contact trust hardening

This release hardens the market-intelligence waterfall before further source expansion.

## Contractor truth

LLM-only contractor output is stored as an unverified `Predicted` hypothesis. Model confidence cannot create a `Confirmed` contractor. Confirmation continues to require attributable award, tender, Projectory, ICN, public-source or human evidence.

## Contact truth

LinkedIn search results are accepted only when the requested name matches. The first result is never used as a fallback. Email-pattern guesses are no longer written into `contacts.email`; unverified contacts remain `named_unverified` until a provider or human verifies the mailbox.

Hunter `accept_all` results do not become `send_ready`. Only a valid mailbox with sufficient confidence and no disposable/block flags is promoted.

## Project linkage

Second-pass contact creation writes the contact and its `contactProjects` link in one transaction. Existing contacts are linked to every relevant project rather than silently skipped.

Manual contacts are no longer excluded from project contact-state assessment solely because they were entered by a rep. Their trust tier and rejection state determine usability.

## Paid enrichment gate

Automatic Apollo spend uses one shared daily cap and requires an active project plus a credible buying route: a confirmed/awarded contractor or an explicit Direct CAPEX owner. The discovery queue calls the eligibility engine before paid enrichment and no longer invokes the same project-level Apollo search twice.

No CRM workflow, opportunity stage, forecast, quote or C4C write is introduced.
