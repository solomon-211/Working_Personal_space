# Simple in-memory cache for GET endpoints.
# Entries expire after a configurable TTL (time-to-live) in seconds.

import time

# Internal store: { cache_key: { 'data': ..., 'expires_at': float } }
_store = {}


def cache_get(key):
    """Return cached data if the entry exists and has not expired, otherwise return None."""
    entry = _store.get(key)
    if entry and time.time() < entry['expires_at']:
        return entry['data']
    return None


def cache_set(key, data, ttl=30):
    """Store data under the given key for ttl seconds."""
    _store[key] = {
        'data':       data,
        'expires_at': time.time() + ttl
    }


def cache_invalidate(prefix):
    """
    Delete all cache entries whose key starts with the given prefix.
    Called after write operations so stale data is not served on the next read.
    Example: cache_invalidate('patients') clears both 'patients:' and 'patients:id:5'.
    """
    keys_to_delete = [key for key in _store if key.startswith(prefix)]
    for key in keys_to_delete:
        del _store[key]
