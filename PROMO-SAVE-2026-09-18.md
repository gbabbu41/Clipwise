# Promo editor save reliability

Editing an existing promo previously sent `total_uses: 0`, erasing its recorded usage count. The editor also closed and discarded the form after failed writes.

- Initialize usage only when creating a new code; never include it in the edit payload.
- Match both promo and shop IDs and require a returned row for update success.
- Preserve the draft on rejected, zero-row or offline writes; show generic errors rather than database details.
- Guard duplicate clicks synchronously and lock the form while saving.
- Reject an old-location promo editor before submitting to a different shop.

Discount calculation, plan gates, redemption logic, schema and calendar are unchanged. Regression tests execute the actual handler with mocked database results. No live promos were created or redeemed; hands-on smoke testing is deferred.

## Follow-up: nullable fields and stale usage limits

Cleared expiry/limit fields now send null rather than undefined, matching the existing "Never" / "unlimited" behavior. Untouched uses-left values are omitted from edit payloads so editing another field cannot restore a use consumed since the editor opened. Deliberate limit changes match the original counter (including null) and retain the draft if that counter has changed. Zero remains a real limit, not unlimited.

Mocked handler checks cover clearing fields, new unlimited promos, zero limits, preserving intervening redemptions, finite/null conditional updates, and conflicts. This does not fix the separately reported race between concurrent redemptions in the booking/payment engine. Loyalty page read failures/location races also remain separate audit work.
