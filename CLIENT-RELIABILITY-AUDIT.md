# Client identity and loyalty audit — 2026-09-27

## Confirmed incident

Read-only investigation confirmed the reported VIP client still exists. A recent
redemption reduced that row to zero; cancellation did not restore it. Historical
appointments contain crossed contact details. The old union-find display merged
the saved clients through those contacts, then selected the largest points balance
as representative. Spending points therefore changed the visible name and email.
No production records were changed during this investigation or implementation.
Record identifiers and customer contacts are intentionally omitted here.

## This review branch

- Saved client IDs remain separate. Each retains its own name, VIP tag, notes and
  actual balance; linked appointments cannot transfer history through old contacts.
- Historical contact/name aliases remain searchable. Unlinked history attaches
  only to a unique current-contact match; ambiguous history stays separate.
- Shared creation lookup uses exact case-insensitive email, then normalized phone
  only without conflicting email. Multiple candidates or database errors stop
  resolution instead of selecting the first row or inserting after a failed read.
- Manual add and public upsert already shared this lookup; POS now uses it too.
  Name-only lookup cannot borrow a contact-bearing client's identity.
- Client profile history now actually selects client_id, which its identity filter
  needs. No-show attribution uses that same permanent ID and avoids ambiguous picks.
- Marketing's separate phone lookup no longer arbitrarily chooses among clients
  or borrows a conflicting email's identity/consent. Existing consent gates remain.

Prior implementation history (459a9ed and existing client profile/history tests)
was reviewed. This preserves the later main-branch page-cache behavior (7f04833).
Separating saved rows may increase the displayed client count. That is intentional:
this does not merge balances or delete duplicate records to make the count smaller.
No accounting arithmetic, booking state transition or loyalty deduction changed.

## Entry points and remaining limits

Manual Clients/add-appointment/POS client creation goes through clients/create.
Public registration and synthetic materialization use clients/upsert; online
finalization, in-person booking and waitlist use ensureClientRow. POS sale recording
uses clients-server. Marketing has its own consent-bound materialization path.
No separate client import insertion path was found in the source search.

This prevents sequential duplicate registration for unambiguous normalized contact
matches, not simultaneous inserts. Existing duplicate emails now fail resolution
rather than borrowing an arbitrary balance. The portal add endpoint returns its
409 message asking to select an existing client or provide a unique email; public upsert returns a failed save. Booking's
existing best-effort client-link behavior remains: a failed link may leave an
appointment unlinked, but does not insert a duplicate after a failed lookup.
Changing booking failure/rollback semantics needs a coordinated booking change.

Loyalty lookup still has a separate email/exact-phone resolver, and its deductions
are read-modify-write, not atomic. Completion earning/review lookup also warrants
the same appointment-bound identity treatment in the financial follow-up. This
branch must not be described as completing loyalty correctness or restoring points.

## Proposed migration and follow-up — approval required, NOT applied

1. Add nullable appointment_id (FK to appointments, deletion restricted) and an
   operation key to loyalty_rewards. Keep legacy rows unchanged/unlinked: never
   infer ownership from timing. Add a partial unique index on appointment_id/action
   for new booking redemption and cancellation-restoration operations. Confirm the
   live action constraint before choosing action names.
2. Add a server-only database transaction/RPC that locks the appointment and client,
   validates their shop/client relationship, reserves/deducts once and records the
   linked ledger entry in the same transaction. Snapshot redeemed points and value
   at booking; later settings changes must not change the refund amount.
3. Cancellation transaction restores exactly the linked deduction once and updates
   booking status atomically. Concurrent/retried cancellation must not credit twice;
   legacy bookings without a linked deduction require manual review, never a guess.
   Wire owner calendar, appointments page and customer cancellation through it;
   preserve existing Stripe refund/hold semantics separately.
4. For race-free client creation, use a shop-scoped resolver RPC taking transaction
   advisory locks on normalized contact keys in deterministic order. Recheck matches
   under lock, fail on ambiguous identities, then insert. Do not add a unique phone
   constraint: families may legitimately share a number. Do not retroactively merge
   existing rows or invent a single canonical person without owner review.

Owner applies approved migration through the established manual process. Before
approval, review exact SQL, rollback/compatibility behavior and transaction tests.
Acceptance: repeated/concurrent redemption and cancellation; rollback on ledger
failure; insufficient points; cross-shop rejection; settings changes after booking;
legacy unlinked rows; shared-phone conflicting emails; concurrent creates from all
entry points. Any historical point restoration is a separate explicitly approved
repair after confirming identity and amount.

## Reproduced before/after fixture

Two saved clients: A is VIP with 423 points; B is Returning with 213 points.
One completed $20 booking belongs to A, one $30 booking to B, and old contacts
cross-link them. A cancelled booking contributes no visit/spend.

| State | Old grouping | This branch |
|---|---|---|
| Before redemption | A shown, combined 2 visits/$50 | A: VIP,423pts,1/$20; B:Returning,213pts,1/$30 |
| After A reaches zero | B shown as VIP,combined 2/$50; A hidden | A:VIP,0pts,1/$20; B:Returning,213pts,1/$30 |

Foreign-shop rows and unknown explicit client links are excluded, never used to
fabricate a synthetic client or attach history through a matching contact.
Rollback: revert this branch's application commit; no schema/data rollback needed.

## Validation

Focused regression executes real identity/search/create-resolver modules using
isolated mocked database responses. Covers the incident's crossed historical
contacts, balance changes, cancellation, VIP preservation, per-client history,
aliases, normalized repeat registration, family phone conflicts, ambiguous matches,
failed reads and authorization. Existing history and marketing regressions retained.
Full flow suite and production build results are reported with the review delivery.
No live bookings, email sends, point adjustments or data merges were tested.
