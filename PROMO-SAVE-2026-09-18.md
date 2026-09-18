# Promo editor save reliability

Editing an existing promo previously sent `total_uses: 0`, erasing its recorded usage count. The editor also closed and discarded the form after failed writes.

- Initialize usage only when creating a new code; never include it in the edit payload.
- Match both promo and shop IDs and require a returned row for update success.
- Preserve the draft on rejected, zero-row or offline writes; show generic errors rather than database details.
- Guard duplicate clicks synchronously and lock the form while saving.
- Reject an old-location promo editor before submitting to a different shop.

Discount calculation, plan gates, redemption logic, schema and calendar are unchanged. Regression tests execute the actual handler with mocked database results. No live promos were created or redeemed; hands-on smoke testing is deferred.

Remaining separate audit work: loyalty page read failures/location races; nullable promo expiry/limits cannot currently be cleared; editing a stale uses-left value can overwrite intervening redemptions. These are not claimed fixed by this batch.
