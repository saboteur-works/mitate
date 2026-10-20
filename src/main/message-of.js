'use strict';

// The message to show for a caught value, which need not be an Error.
function messageOf(err) {
  return err && err.message ? err.message : String(err);
}

module.exports = { messageOf };
