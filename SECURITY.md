# Security

## Reporting a vulnerability

Please report security problems privately, not in a public issue: on GitHub, open the
**Security** tab of this repository and choose **Report a vulnerability**. Only the maintainer
sees the report. You will get an answer within a few days, and credit in the fix if you want it.

This covers Torre itself (the app you install with `pip install torre` or run from this
repository) and torre.sh, the hosted version.

## What helps

- What an attacker could do, and what they need first (an account, a local network, a link
  someone opens).
- Steps or a small proof of concept.
- The Torre version (`torre --version`) or the date you saw it on torre.sh.

Please do not test against other people's accounts or data on torre.sh, and do not run load or
denial-of-service tests against it.

## How Torre is built to be safe

- The studio listens on 127.0.0.1 only and answers local host names unless told otherwise
  (`--allow-host`), which guards against DNS rebinding.
- Requests that change anything need a same-origin JSON request with Torre's own header.
- Hosted, each player gets a separate Torre with its own data folder; installing engines or
  Python packages is limited to admins.
- Outgoing requests go through `torre/net.py`, which opens http and https addresses only.
- API keys you save in Settings > AI go to Prompture's key file in your home folder (readable by
  you only), never to the browser, and are shown back only as their last characters. Hosted,
  each player's keys stay in their own data folder instead.
