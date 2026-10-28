---
name: data-retrieval
description: Submit authorized datasets and a structured retrieval outcome to the workbench.
metadata:
  ontomato-runtime-manifest: runtime.json
---

Use submit_dataset after testing a Python file with python_execute, or supply a
DSL/published metric recipe. Never substitute exploration rows for a submitted
dataset. The host executes the recipe with current user permissions.
Use finish_retrieval once, with the returned submission IDs. Material ambiguity
requires needs_input, even without an interactive user. Then end the run.
