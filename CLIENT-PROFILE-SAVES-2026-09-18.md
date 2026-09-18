# Late client-profile save responses

Reproduced with an automated test: a notes save for client A could complete after opening client B, replacing B's displayed ID and notes with A's. The same callback pattern existed for hair profile, birthday, contact fields and manual points.

All five callbacks now check the currently displayed client ID against the original/materialized target before updating the open profile. A completed contact save only closes the same unchanged contact draft; it cannot close another client's editor or discard newer typing.

Database queries, client materialization, point calculations, message sending and write policies are unchanged. This is response-targeting protection, not a fix for the separately recorded accounting or zero-row-save issues.

Tests execute the actual handlers for current, switched and closed profiles and newer contact drafts. The test failed against the old notes handler and passes with the guards. No live client records were modified for testing.
