# Service deletion failure handling

The existing upcoming-booking check now fails closed: a query error or missing count prevents the delete. Both the appointment check and deletion are shop-scoped. A confirmed returned deleted row is required before removing the service from the UI; errors, missing rows and uncertain network results keep it visible. Overlapping confirmations are guarded, and switching shops before the read completes prevents the write.

Existing date/status/primary-service checks are retained. This does not make checking and deleting atomic, change historical-reference policy, or add multi-service reference checks. Those require further review. No live deletion was performed; regression checks execute the actual handler with mocked read/write results.
