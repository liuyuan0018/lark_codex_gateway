# Security

Do not include credentials, access tokens, refresh tokens, private keys, private chat transcripts, or production configuration in public issues.

If a Feishu application secret is exposed, rotate it in the Feishu developer console before rewriting Git history. If a user token is exposed, revoke the user authorization and authenticate again. Treat message traffic logs as private data even when they do not contain credentials.

Report a vulnerability privately to the repository owner. Include the affected version and reproduction steps, but replace all business identifiers and message content with synthetic values.
