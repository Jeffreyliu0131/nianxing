# Privacy

念行 stores tasks and ideas in the browser first. A signed-in user may optionally synchronize that content to a Sites D1 database. Synced records can include task and idea text, timestamps, tags, deletion tombstones, and the account email/display name supplied by the hosting platform.

When the optional AI organizer is configured, the text submitted for organization, the current time, timezone and locale are sent through the same-origin server gateway to the configured model provider. The model response remains a draft until the user confirms it.

The application does not include advertising, analytics, telemetry, contact-book access, or a third-party tracking SDK. Browser storage, D1 retention and model-provider retention should be reviewed before any production deployment. Users can export their local data and delete individual records from the product.
