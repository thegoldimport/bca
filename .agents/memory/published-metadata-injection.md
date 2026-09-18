---
name: Published metadata injection
description: Why project SEO, social tags, and favicon settings are applied at the managed publishing gateway.
---

Apply saved project metadata to branded-domain HTML responses at the gateway. Keep KV route values backward-compatible with legacy plain script names and current JSON records containing a script name plus metadata.

**Why:** The VibeSDK session exposes generated workspace files for reading but not direct file mutation. Gateway injection updates published metadata immediately without asking the generation agent to rewrite source files.

**How to apply:** Preserve generated head elements when a saved field is empty. Replace only explicitly configured fields, always supply the BuildCustom default favicon, and let a validated project favicon override it.