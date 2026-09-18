# Customer reschedule picker

Incremental fix for first-pass audit finding 4. Owner/barber calendar, booking policies and database schema are unchanged.

- Uses existing duration and occupancy helpers to disable full-window conflicts, including multi-service appointment lengths.
- Excludes the current appointment by ID rather than deleting every booking with the same start time.
- Requires the whole appointment to fit working hours, preserves split-shift gaps, and merges adjacent/overlapping shift rows so continuous hours stay available.
- Includes existing recurring breaks and approved time-off constraints, including shop-wide closures. Keeps shop-local past-time handling and 15/30-minute grids.
- Failed availability reads return an error instead of advertising unknown times as free. The customer sees a retry message.
- The latest selected date owns the slot response; a slower earlier request cannot overwrite it. Closing the picker invalidates pending slot responses.

Verification: actual route and extracted UI-handler tests cover overlaps, closing time, ID exclusion, shifts, breaks, time off, timezone, interval settings, failed reads and reversed request order. Existing booking-save tests remain unchanged in behavior. Full regression suite and targeted lint passed; build/push status recorded in the audit log.

Limits: no live booking or manual/device smoke test performed. Availability can change after loading; the existing submission conflict checks remain authoritative. This fixes the customer management picker only, not all public booking availability paths or the shared booking engine.

Security/Supabase guidance informed fail-closed reads and response fields. Current [Supabase select reference](https://supabase.com/docs/reference/javascript/select) was consulted; its Markdown changelog endpoint remained unavailable. No SDK or database changes.
