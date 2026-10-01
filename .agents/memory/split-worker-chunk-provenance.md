---
name: Split Worker chunk provenance
description: Distinguish auxiliary JavaScript build-output churn from executable changes before a Worker release.
---

An unchanged auxiliary JavaScript module can have different bytes and a different hashed filename when rebuilt from another source root. Do not infer a dependency or behavior change from that difference alone, and do not relax a release gate without evidence.

**Why:** A narrow runtime change passed complete source reconstruction but failed a main-module-only upload preflight. Read-only comparison found identical auxiliary executable ASTs after normalizing known hashed import references and dropping source-root comments. WASM and the bundler runtime remained byte-identical.

**How to apply:** Compare complete module sets against the accepted live version. Establish a one-to-one mapping for corresponding hashed chunk references, compare executable ASTs without comments or locations, retain all other identifiers and literal values, and record exact old/new hashes. Verify WASM bytes and main export pairs separately. Unexplained differences must still block deployment.