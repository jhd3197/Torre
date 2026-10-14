"""Asking a model: the one way every Torre feature calls an AI, so they share the key, the
options and the errors.

- ask(): a reply shaped like a pydantic schema (the coach's advice, explanations, reviews).
- driver(): a Prompture driver for code that drives a model itself (the Arena's chess harness).
- options(): the call options, the same everywhere: room for the answer, one timeout, the
  reasoning effort in the one word Prompture takes, and no thinking for local models where
  thinking only makes a short answer slow.
- test(): one tiny call, to check that a model answers.

Errors come back as AiError (a RuntimeError, so callers that catch those keep working), with a
message for the player and never a key.
"""
import re
import time

from torre.ai import keys, runtime

TIMEOUT_S = 300
TEST_TIMEOUT_S = 120


class AiError(RuntimeError):
    """The model could not be asked or did not answer; the message is for the player."""


def options(model, *, max_tokens=2000, timeout=TIMEOUT_S, effort=None, think=None):
    """The call options for `model`. `effort` is passed both as Prompture's neutral "effort" and
    as OpenAI's "reasoning_effort", so an older Prompture still hears it on either provider."""
    out = {'max_tokens': max_tokens, 'timeout': timeout}
    if effort:
        out.update(effort=effort, reasoning_effort=effort)
    if think is None:
        think = not model.startswith(('ollama/', 'lmstudio/'))  # a local reasoning model is far faster without thinking
    if not think and model.startswith('ollama/'):
        out['think'] = False
    return out


def _require(model):
    if not runtime.prompture_installed():
        raise AiError(runtime.MISSING_PROMPTURE)
    if not model:
        raise AiError(runtime.NO_MODEL)


def _clean(error):
    """A provider's error as one short line for the player, without anything that looks like a key."""
    text = str(error).strip().splitlines()[0] if str(error).strip() else type(error).__name__
    return re.sub(r'(sk|key|token)[-_A-Za-z0-9]{12,}', '…', text)[:300]


def ask(schema, model, text, *, data_dir=None, **option_args):
    """`model`'s reply shaped like the pydantic `schema`, as a dict. Raises AiError."""
    _require(model)
    from prompture import extract_with_model
    key = keys.key_for(data_dir or runtime.DATA_DIR, model)
    extra = {'api_key': key} if key else {}
    try:
        result = extract_with_model(schema, text, model, options=options(model, **option_args), max_retries=2, **extra)
    except AiError:
        raise
    except Exception as error:  # a provider's own errors: no credit, refused key, cut off, not JSON...
        raise AiError(_clean(error)) from error
    out = result['model'] if isinstance(result, dict) else result
    return out.model_dump()


def driver(model, data_dir=None):
    """A Prompture driver for `model` with the saved key, or None to let Prompture build its own."""
    _require(model)
    key = keys.key_for(data_dir or runtime.DATA_DIR, model)
    if not key:
        return None
    from prompture.drivers import get_driver_for_model
    return get_driver_for_model(model, api_key=key)


def test(model, data_dir=None):
    """{'ok', 'seconds', 'reply' | 'error'}: one short question, to check the model answers."""
    started = time.monotonic()
    try:
        _require(model)
        from prompture.drivers import get_driver_for_model
        key = keys.key_for(data_dir or runtime.DATA_DIR, model)
        chosen = get_driver_for_model(model, api_key=key) if key else get_driver_for_model(model)
        reply = chosen.generate_messages([{'role': 'user', 'content': 'Reply with the single word: ready'}],
                                         options(model, max_tokens=200, timeout=TEST_TIMEOUT_S))
        text = (reply.get('text') or '').strip()
        if not text:
            raise AiError('The model answered with nothing.')
        return {'ok': True, 'seconds': round(time.monotonic() - started, 1), 'reply': text[:80]}
    except Exception as error:
        return {'ok': False, 'seconds': round(time.monotonic() - started, 1), 'error': _clean(error)}
