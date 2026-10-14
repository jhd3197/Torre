"""Torre's AI, in one place: every feature that talks to a language model goes through here.

- keys: the API keys that unlock cloud providers. On your own computer they live in Prompture's
  shared store, so a key saved in Torre works in every app built on Prompture.
- catalogue: the providers you can use (cloud keys, servers on this computer, and the Claude
  Code and Codex logins) and their models, from Prompture's catalogue.
- config: which model Torre uses, one default with an optional model per feature.
- calls: asking a model, with the same options, key and errors for every feature.
- runtime: whether Prompture is installed (and installing it), Prompture Desk, and usage.

Prompture does the provider work; this package decides what Torre offers and remembers.
"""
