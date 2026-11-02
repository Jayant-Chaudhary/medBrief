/**
 * Offline provider for tests. `reply` is a string, an Error to throw, or a
 * function of the request returning either.
 */

const { LlmProvider } = require('./provider.interface');

class FakeProvider extends LlmProvider {
  constructor(reply = '{"action":"unsupported","page":"none","options":[]}') {
    super();
    this.reply = reply;
    this.calls = [];
  }

  async complete(request) {
    this.calls.push(request);
    const result = typeof this.reply === 'function' ? this.reply(request, this.calls.length) : this.reply;
    if (result instanceof Error) throw result;
    return result;
  }
}

module.exports = FakeProvider;
