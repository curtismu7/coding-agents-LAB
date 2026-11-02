# Shared corpora

`leaks.json` and `ordinary.json` are copied unchanged from shared-masker 1.4.0 (commit 9bc664a), `test/corpus/`. Every probe is stored as short
fragments (at most 4 code points) and joined at run time, so no scanner sees a credential-shaped literal. `leaks.json`: the `secret` must not survive
masking. `ordinary.json`: the text must come out unchanged. Do not edit these files here; fixes go to the shared-masker repo and the files are copied again.
